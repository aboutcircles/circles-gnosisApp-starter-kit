import { NextResponse } from "next/server";

import {
  getSoloEconomics,
  getSoloOrgBalanceCRC,
  getSoloPayoutConfiguration
} from "@/lib/server/solo-payout";
import {
  createSoloRound,
  getSoloRoundWithLifecycle,
  listSoloRoundsWithLifecycle,
  normalizeMove,
  SoloGameError
} from "@/lib/server/solo-service";

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

    if (roundId) {
      const round = await getSoloRoundWithLifecycle(roundId);

      if (!round) {
        return NextResponse.json({ error: "Round not found" }, { status: 404 });
      }

      return NextResponse.json({ round });
    }

    const [rounds, payoutConfig, orgBalanceCRC] = await Promise.all([
      listSoloRoundsWithLifecycle(40),
      Promise.resolve(getSoloPayoutConfiguration()),
      getSoloOrgBalanceCRC()
    ]);

    const economics = getSoloEconomics();

    return NextResponse.json({
      rounds,
      config: {
        payout: {
          ...payoutConfig,
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
