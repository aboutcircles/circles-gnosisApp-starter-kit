import { randomInt, randomUUID } from "node:crypto";

import { CirclesRpc } from "@aboutcircles/sdk-rpc";
import type { TransactionHistoryRow } from "@aboutcircles/sdk-rpc";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";

import { checkPaymentReceived, eventMatchesData, generatePaymentLink } from "./circles";
import { buildMiniappCompatiblePayment } from "./payment-builder";
import {
  createSoloRoundRecord,
  findActiveSoloRoundByPlayer,
  getSoloRound,
  listSoloRounds,
  SoloStoreConflictError,
  updateSoloRound
} from "./store";
import { getSoloEconomics, payoutSoloWinner } from "./payout";
import type { SoloMove, SoloRound } from "./types";

export class SoloGameError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,18})?$/;
const DEFAULT_CIRCLES_RPC_URL = "https://rpc.aboutcircles.com/";
const createRoundLocks = new Map<string, Promise<void>>();

function normalizeAddressKey(value: string): string {
  return value.trim().toLowerCase();
}

function matchesPlayer(round: SoloRound, playerAddress: string): boolean {
  return normalizeAddressKey(round.playerAddress) === normalizeAddressKey(playerAddress);
}

async function withPlayerCreateLock<T>(playerAddress: string, task: () => Promise<T>): Promise<T> {
  const key = normalizeAddressKey(playerAddress);
  const previous = createRoundLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(
    () => gate,
    () => gate
  );
  createRoundLocks.set(key, tail);

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
    if (createRoundLocks.get(key) === tail) {
      createRoundLocks.delete(key);
    }
  }
}

function parseAmount(value: string, field: string): number {
  if (!AMOUNT_PATTERN.test(value)) {
    throw new SoloGameError(`${field} must be a decimal string with up to 18 decimals`, 500);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new SoloGameError(`${field} must be greater than 0`, 500);
  }

  return parsed;
}

function parseAmountToAtto(value: string, field: string): bigint {
  if (!AMOUNT_PATTERN.test(value)) {
    throw new SoloGameError(`${field} must be a decimal string with up to 18 decimals`, 500);
  }

  const atto = parseUnits(value, 18);
  if (atto <= 0n) {
    throw new SoloGameError(`${field} must be greater than 0`, 500);
  }

  return atto;
}

function formatCrcAmount(valueAtto: bigint): string {
  const amount = formatUnits(valueAtto, 18);
  const [whole, fraction = ""] = amount.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function createCirclesRpc(): CirclesRpc {
  return new CirclesRpc(
    process.env.CIRCLES_RPC_URL ||
      process.env.NEXT_PUBLIC_CIRCLES_RPC_URL ||
      DEFAULT_CIRCLES_RPC_URL
  );
}

async function ensurePlayerCanPayEntryFee(params: {
  playerAddress: Address;
  recipientAddress: Address;
  entryFeeAtto: bigint;
}): Promise<void> {
  try {
    const rpc = createCirclesRpc();
    const [playerAvatarInfo, recipientAvatarInfo] = await Promise.all([
      rpc.avatar.getAvatarInfo(params.playerAddress),
      rpc.avatar.getAvatarInfo(params.recipientAddress)
    ]);

    if (!playerAvatarInfo) {
      throw new SoloGameError(
        `Player address is not a Circles avatar: ${params.playerAddress}. Use the player's Circles avatar/safe address (the one holding CRC), not an EOA signer address.`,
        400
      );
    }

    if (!recipientAvatarInfo) {
      throw new SoloGameError(
        `Recipient is not a Circles avatar: ${params.recipientAddress}. Check CIRCLES_ORG_AVATAR_ADDRESS.`,
        400
      );
    }

    const maxTransferable = await rpc.pathfinder.findMaxFlow({
      from: params.playerAddress.toLowerCase() as Address,
      to: params.recipientAddress.toLowerCase() as Address
    });

    if (maxTransferable < params.entryFeeAtto) {
      throw new SoloGameError(
        `No valid transfer path for this move. Required ${formatCrcAmount(params.entryFeeAtto)} CRC to ${params.recipientAddress}, but max transferable is ${formatCrcAmount(maxTransferable)} CRC.`,
        400
      );
    }
  } catch (error) {
    if (error instanceof SoloGameError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown pathfinder error";

    throw new SoloGameError(
      `Could not verify transfer path to recipient. ${message}`,
      400
    );
  }
}

function toUnixSeconds(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return 0;
  }
  return Math.floor(ms / 1000);
}

type TransferDataMatchState = "match" | "mismatch" | "missing";

function parseTransactionEvents(rawEvents: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(rawEvents)) {
    return rawEvents.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")
    );
  }

  if (typeof rawEvents !== "string" || !rawEvents.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawEvents);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")
    );
  } catch {
    return [];
  }
}

function transferDataMatchState(rawEvents: unknown, expectedData: string): TransferDataMatchState {
  const events = parseTransactionEvents(rawEvents);
  const transferDataEvents = events.filter((event) => {
    const eventType = String(event.$type ?? event.event ?? "").trim();
    return eventType === "CrcV2_TransferData";
  });

  if (!transferDataEvents.length) {
    return "missing";
  }

  for (const event of transferDataEvents) {
    const dataField = String(event.Data ?? event.data ?? "");
    if (eventMatchesData(dataField, expectedData)) {
      return "match";
    }
  }

  return "mismatch";
}

async function findPaymentFromTransferHistory(params: {
  playerAddress: string;
  recipientAddress: string;
  minAmountAtto: bigint;
  createdAtIso: string;
  expectedData?: string;
}) {
  const rpc = createCirclesRpc();
  const query = rpc.transaction.getTransactionHistory(params.recipientAddress as Address, 50, "DESC");
  const createdAtSeconds = toUnixSeconds(params.createdAtIso);
  const targetFrom = params.playerAddress.toLowerCase();
  const targetTo = params.recipientAddress.toLowerCase();

  let scannedPages = 0;
  while (scannedPages < 5 && (await query.queryNextPage())) {
    scannedPages += 1;
    const rows = (query.currentPage?.results ?? []) as TransactionHistoryRow[];

    for (const row of rows) {
      const from = row.from.toLowerCase();
      const to = row.to.toLowerCase();
      const txHash = row.transactionHash;
      const timestamp = row.timestamp;
      const amountAtto = row.attoCircles ?? BigInt(row.value);

      if (!txHash || from !== targetFrom || to !== targetTo) {
        continue;
      }

      if (timestamp < createdAtSeconds || amountAtto < params.minAmountAtto) {
        continue;
      }

      if (params.expectedData) {
        const rawEvents = (row as TransactionHistoryRow & { events?: unknown }).events;
        const matchState = transferDataMatchState(rawEvents, params.expectedData);
        if (matchState === "mismatch") {
          continue;
        }
      }

      return {
        transactionHash: txHash,
        from,
        to,
        data: "",
        blockNumber: String(row.blockNumber),
        timestamp: String(timestamp),
        transactionIndex: String(row.transactionIndex),
        logIndex: String(row.logIndex)
      };
    }

    if (!query.currentPage?.hasMore) {
      break;
    }
  }

  return null;
}

function buildMoveData(roundId: string, move: SoloMove, playerAddress: string): string {
  return `solo-move:${roundId}:${move}:${playerAddress.toLowerCase()}`;
}

function shouldRetryLegacyPayout(round: SoloRound): boolean {
  if (round.status !== "completed" || round.result?.outcome !== "win") {
    return false;
  }

  if (round.payout.status !== "failed" || round.payout.txHash) {
    return false;
  }

  const retryCount = round.payout.retryCount ?? 0;
  if (retryCount >= 1) {
    return false;
  }

  const payoutError = (round.payout.error ?? "").toLowerCase();
  return (
    payoutError.includes("direct transfer") ||
    payoutError.includes("execution reverted for an unknown reason")
  );
}

export function normalizeMove(value: string): SoloMove {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "heads" && normalized !== "tails") {
    throw new SoloGameError("Move must be 'heads' or 'tails'", 400);
  }
  return normalized;
}

export async function createSoloRound(params: {
  playerAddress: string;
  move: SoloMove;
}): Promise<SoloRound> {
  const orgAddress = process.env.CIRCLES_ORG_AVATAR_ADDRESS?.trim();
  if (!orgAddress || !isAddress(orgAddress)) {
    throw new SoloGameError("CIRCLES_ORG_AVATAR_ADDRESS must be configured for payouts", 400);
  }

  if (!isAddress(params.playerAddress)) {
    throw new SoloGameError("playerAddress is invalid", 400);
  }

  return withPlayerCreateLock(params.playerAddress, async () => {
    const activeRound = await findActiveSoloRoundByPlayer(params.playerAddress);

    if (activeRound) {
      throw new SoloGameError(
        `You already have a pending round (${activeRound.id.slice(0, 8)}). Complete it before creating a new move.`,
        409
      );
    }

    const economics = getSoloEconomics();
    const entryFee = parseAmount(economics.entryFeeCRC, "SOLO_ENTRY_FEE_CRC");
    const entryFeeAtto = parseAmountToAtto(economics.entryFeeCRC, "SOLO_ENTRY_FEE_CRC");
    const entryRecipientAddress = orgAddress;

    await ensurePlayerCanPayEntryFee({
      playerAddress: params.playerAddress as Address,
      recipientAddress: entryRecipientAddress as Address,
      entryFeeAtto
    });

    const roundId = randomUUID();
    const nowIso = new Date().toISOString();
    const expectedData = buildMoveData(roundId, params.move, params.playerAddress);
    const paymentLink = generatePaymentLink(entryRecipientAddress, entryFee, expectedData);
    let paymentDraft;

    try {
      paymentDraft = await buildMiniappCompatiblePayment({
        playerAddress: params.playerAddress as Address,
        recipientAddress: entryRecipientAddress as Address,
        amountAtto: entryFeeAtto,
        expectedData
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown construction error";
      throw new SoloGameError(`Could not construct payment transaction. ${message}`, 400);
    }

    const round: SoloRound = {
      id: roundId,
      createdAt: nowIso,
      updatedAt: nowIso,
      playerAddress: params.playerAddress,
      move: params.move,
      status: "awaiting_payment",
      payment: {
        status: "pending",
        recipientAddress: entryRecipientAddress,
        paymentLink,
        expectedData,
        amountCRC: economics.entryFeeCRC,
        transactions: paymentDraft.transactions,
        hostTransactions: paymentDraft.hostTransactions
      },
      payout: {
        status: "pending",
        fromAddress: orgAddress,
        toAddress: params.playerAddress,
        amountCRC: economics.winnerPayoutCRC
      }
    };

    try {
      await createSoloRoundRecord(round);
    } catch (error) {
      if (error instanceof SoloStoreConflictError) {
        const latestActiveRound = await findActiveSoloRoundByPlayer(params.playerAddress).catch(
          () => null
        );

        if (latestActiveRound) {
          throw new SoloGameError(
            `You already have a pending round (${latestActiveRound.id.slice(0, 8)}). Complete it before creating a new move.`,
            409
          );
        }

        throw new SoloGameError(
          "A pending round already exists for this player. Refresh and try again.",
          409
        );
      }

      throw error;
    }

    return round;
  });
}

export async function processSoloRoundLifecycle(roundId: string): Promise<SoloRound | null> {
  const current = await getSoloRound(roundId);

  if (!current) {
    return null;
  }

  if (current.status === "completed") {
    if (!shouldRetryLegacyPayout(current)) {
      return current;
    }

    const payout = await payoutSoloWinner({
      roundId,
      winnerAddress: current.playerAddress,
      amountCRC: current.payout.amountCRC
    });

    const retried = await updateSoloRound(roundId, (round) => {
      if (!shouldRetryLegacyPayout(round)) {
        return round;
      }

      return {
        ...round,
        updatedAt: new Date().toISOString(),
        payout: {
          ...payout,
          retryCount: (round.payout.retryCount ?? 0) + 1
        }
      };
    });

    return retried ?? { ...current, updatedAt: new Date().toISOString(), payout };
  }

  if (current.status === "resolving") {
    return current;
  }

  const minAmount = parseAmount(current.payment.amountCRC, "payment.amountCRC");
  const minAmountAtto = parseAmountToAtto(current.payment.amountCRC, "payment.amountCRC");

  let payment = null;
  try {
    payment = await checkPaymentReceived(
      current.payment.expectedData,
      minAmount,
      current.payment.recipientAddress
    );
  } catch {
    payment = null;
  }

  if (!payment) {
    try {
      payment = await findPaymentFromTransferHistory({
        playerAddress: current.playerAddress,
        recipientAddress: current.payment.recipientAddress,
        minAmountAtto,
        createdAtIso: current.createdAt,
        expectedData: current.payment.expectedData
      });
    } catch {
      payment = null;
    }
  }

  if (!payment) {
    return current;
  }

  const claimToken = randomUUID();
  const nowIso = new Date().toISOString();

  const claimed = await updateSoloRound(roundId, (round) => {
    if (round.status !== "awaiting_payment") {
      return round;
    }

    return {
      ...round,
      status: "resolving",
      updatedAt: nowIso,
      processingToken: claimToken,
      payment: {
        ...round.payment,
        status: "paid",
        transactionHash: payment!.transactionHash,
        paidAt: nowIso
      },
      payout: {
        ...round.payout,
        status: "processing",
        processedAt: nowIso
      }
    };
  });

  if (!claimed) {
    return null;
  }

  if (claimed.processingToken !== claimToken) {
    return claimed;
  }

  const isWin = randomInt(0, 10) === 0;
  const outcome = isWin ? "win" : "lose";
  const coin: SoloMove = isWin
    ? claimed.move
    : claimed.move === "heads"
      ? "tails"
      : "heads";

  let payout = claimed.payout;

  if (outcome === "win") {
    payout = await payoutSoloWinner({
      roundId,
      winnerAddress: claimed.playerAddress,
      amountCRC: claimed.payout.amountCRC
    });
  } else {
    payout = {
      ...claimed.payout,
      status: "skipped",
      error: "Round lost. No payout.",
      processedAt: new Date().toISOString()
    };
  }

  const completed = await updateSoloRound(roundId, (round) => {
    if (round.processingToken !== claimToken) {
      return round;
    }

    return {
      ...round,
      status: "completed",
      updatedAt: new Date().toISOString(),
      processingToken: undefined,
      result: {
        coin,
        outcome,
        resolvedAt: new Date().toISOString()
      },
      payout
    };
  });

  return completed ?? { ...claimed, result: { coin, outcome, resolvedAt: nowIso }, payout };
}

export async function listSoloRoundsWithLifecycle(limit: number = 40): Promise<SoloRound[]> {
  const rounds = await listSoloRounds(limit);

  for (const round of rounds) {
    if (round.status !== "completed") {
      await processSoloRoundLifecycle(round.id);
    }
  }

  return listSoloRounds(limit);
}

export async function listSoloRoundsByPlayerWithLifecycle(params: {
  playerAddress: string;
  limit?: number;
  pendingOnly?: boolean;
}): Promise<SoloRound[]> {
  const limit = params.limit ?? 100;
  const initialRounds = await listSoloRounds(limit);
  const matchingRounds = initialRounds.filter((round) => matchesPlayer(round, params.playerAddress));

  for (const round of matchingRounds) {
    if (round.status !== "completed") {
      await processSoloRoundLifecycle(round.id);
    }
  }

  const refreshedRounds = await listSoloRounds(limit);
  const matchingRefreshed = refreshedRounds.filter((round) =>
    matchesPlayer(round, params.playerAddress)
  );

  if (params.pendingOnly) {
    return matchingRefreshed.filter((round) => round.status !== "completed");
  }

  return matchingRefreshed;
}

export async function getSoloRoundWithLifecycle(roundId: string): Promise<SoloRound | null> {
  const processed = await processSoloRoundLifecycle(roundId);
  if (processed) {
    return processed;
  }

  return getSoloRound(roundId);
}
