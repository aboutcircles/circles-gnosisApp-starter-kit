import { randomInt, randomUUID } from "node:crypto";

import { isAddress, parseUnits, type Address } from "viem";

import { checkPaymentReceived, generatePaymentLink } from "./circles";
import { buildMiniappCompatiblePayment } from "./payment-builder";
import {
  createSoloRoundRecord,
  findActiveSoloRoundByPlayer,
  getSoloRound,
  listSoloRoundsByPlayer,
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
const createRoundLocks = new Map<string, Promise<void>>();

function normalizeAddressKey(value: string): string {
  return value.trim().toLowerCase();
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

async function resolveRound(roundId: string, txHash: string): Promise<SoloRound | null> {
  const claimToken = randomUUID();
  const nowIso = new Date().toISOString();

  const claimed = await updateSoloRound(roundId, (round) => {
    if (round.status !== "awaiting_payment") {
      return round;
    }

    return {
      ...round,
      status: "resolving" as const,
      updatedAt: nowIso,
      processingToken: claimToken,
      payment: {
        ...round.payment,
        status: "paid" as const,
        transactionHash: txHash,
        paidAt: nowIso
      },
      payout: {
        ...round.payout,
        status: "processing" as const,
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

  const isWin = randomInt(0, 2) === 0;
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

export async function reportSoloTxHash(params: {
  roundId: string;
  playerAddress: string;
  txHash: string;
}): Promise<SoloRound> {
  if (!isAddress(params.playerAddress)) {
    throw new SoloGameError("playerAddress is invalid", 400);
  }

  const current = await getSoloRound(params.roundId);
  if (!current) {
    throw new SoloGameError("Round not found", 404);
  }

  if (normalizeAddressKey(current.playerAddress) !== normalizeAddressKey(params.playerAddress)) {
    throw new SoloGameError("Address mismatch", 403);
  }

  if (current.status !== "awaiting_payment") {
    return current;
  }

  const resolved = await resolveRound(params.roundId, params.txHash);
  return resolved ?? current;
}

export async function getSoloRoundWithLifecycle(roundId: string): Promise<SoloRound | null> {
  const current = await getSoloRound(roundId);
  if (!current) return null;

  // Auto-detect on-chain payment for rounds awaiting payment
  if (current.status === "awaiting_payment") {
    try {
      const event = await checkPaymentReceived(
        current.payment.expectedData,
        0,
        current.payment.recipientAddress
      );

      if (event?.transactionHash) {
        const resolved = await resolveRound(roundId, event.transactionHash);
        if (resolved) return resolved;
      }
    } catch {
      // Payment check failed — return current state, caller can retry
    }

    return current;
  }

  if (current.status === "completed" && shouldRetryLegacyPayout(current)) {
    const payout = await payoutSoloWinner({
      roundId,
      winnerAddress: current.playerAddress,
      amountCRC: current.payout.amountCRC
    });

    const retried = await updateSoloRound(roundId, (round) => {
      if (!shouldRetryLegacyPayout(round)) return round;
      return {
        ...round,
        updatedAt: new Date().toISOString(),
        payout: { ...payout, retryCount: (round.payout.retryCount ?? 0) + 1 }
      };
    });

    return retried ?? current;
  }

  return current;
}

export async function listSoloRoundsWithLifecycle(limit: number = 40): Promise<SoloRound[]> {
  return listSoloRounds(limit);
}

export async function listSoloRoundsByPlayerWithLifecycle(params: {
  playerAddress: string;
  limit?: number;
  pendingOnly?: boolean;
}): Promise<SoloRound[]> {
  const limit = params.limit ?? 100;
  const rounds = await listSoloRoundsByPlayer(params.playerAddress, limit);

  if (params.pendingOnly) {
    return rounds.filter((round) => round.status !== "completed");
  }

  return rounds;
}

export async function abandonSoloRound(params: {
  roundId: string;
  playerAddress: string;
}): Promise<SoloRound> {
  if (!isAddress(params.playerAddress)) {
    throw new SoloGameError("playerAddress is invalid", 400);
  }

  const current = await getSoloRound(params.roundId);
  if (!current) {
    throw new SoloGameError("Round not found", 404);
  }

  if (normalizeAddressKey(current.playerAddress) !== normalizeAddressKey(params.playerAddress)) {
    throw new SoloGameError("You can only abandon your own round", 403);
  }

  if (current.status === "completed") {
    return current;
  }

  if (current.status === "resolving" || current.payment.status === "paid") {
    throw new SoloGameError("Round is already processing and cannot be abandoned", 409);
  }

  const nowIso = new Date().toISOString();
  const updated = await updateSoloRound(params.roundId, (round) => {
    if (round.status !== "awaiting_payment") {
      return round;
    }

    return {
      ...round,
      status: "completed",
      updatedAt: nowIso,
      processingToken: undefined,
      payout: {
        ...round.payout,
        status: "skipped",
        error: "Round abandoned by player before payment confirmation.",
        processedAt: nowIso
      }
    };
  });

  if (!updated) {
    throw new SoloGameError("Round not found", 404);
  }

  return updated;
}
