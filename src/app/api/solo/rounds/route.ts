import { NextResponse } from "next/server";
import { isAddress } from "viem";

import {
  getSoloEconomics,
  getSoloOrgBalanceCRC,
  getSoloOrgName,
  getSoloPayoutConfiguration
} from "@backend/coinflip/payout";
import {
  createSoloRound,
  getSoloRoundWithLifecycle,
  listSoloRoundsByPlayerWithLifecycle,
  listSoloRoundsWithLifecycle,
  normalizeMove,
  SoloGameError
} from "@backend/coinflip/service";

function toErrorResponse(error: unknown) {
  if (error instanceof SoloGameError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "Unexpected solo game error"
    },
    { status: 500 }
  );
}

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const roundId = url.searchParams.get("roundId")?.trim();
    const playerAddress = url.searchParams.get("playerAddress")?.trim();
    const pendingOnly =
      url.searchParams.get("pendingOnly")?.trim().toLowerCase() === "1" ||
      url.searchParams.get("pendingOnly")?.trim().toLowerCase() === "true";

    if (roundId) {
      const round = await getSoloRoundWithLifecycle(roundId);

      if (!round) {
        return NextResponse.json({ error: "Round not found" }, { status: 404 });
      }

      return NextResponse.json({ round });
    }

    if (playerAddress) {
      if (!isAddress(playerAddress)) {
        throw new SoloGameError("playerAddress is invalid", 400);
      }

      const [rounds, payoutConfig, orgBalanceCRC, orgName] = await Promise.all([
        listSoloRoundsByPlayerWithLifecycle({
          playerAddress,
          limit: 120,
          pendingOnly
        }),
        Promise.resolve(getSoloPayoutConfiguration()),
        getSoloOrgBalanceCRC(),
        getSoloOrgName()
      ]);

      const economics = getSoloEconomics();

      return NextResponse.json({
        rounds,
        config: {
          payout: {
            ...payoutConfig,
            orgName,
            orgBalanceCRC,
            entryFeeCRC: economics.entryFeeCRC,
            winnerPayoutCRC: economics.winnerPayoutCRC,
            entryRecipientAddress: economics.entryRecipientAddress
          }
        }
      });
    }

    const [rounds, payoutConfig, orgBalanceCRC, orgName] = await Promise.all([
      listSoloRoundsWithLifecycle(40),
      Promise.resolve(getSoloPayoutConfiguration()),
      getSoloOrgBalanceCRC(),
      getSoloOrgName()
    ]);

    const economics = getSoloEconomics();

    return NextResponse.json({
      rounds,
      config: {
        payout: {
          ...payoutConfig,
          orgName,
          orgBalanceCRC,
          entryFeeCRC: economics.entryFeeCRC,
          winnerPayoutCRC: economics.winnerPayoutCRC,
          entryRecipientAddress: economics.entryRecipientAddress
        }
      }
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const playerAddress = String(body.playerAddress ?? "").trim();
    const move = normalizeMove(String(body.move ?? ""));

    if (!playerAddress) {
      throw new SoloGameError("playerAddress is required", 400);
    }

    const round = await createSoloRound({
      playerAddress,
      move
    });

    return NextResponse.json({ round }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
