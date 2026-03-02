import { NextResponse } from "next/server";

import {
  abandonSoloRound,
  getSoloRoundWithLifecycle,
  reportSoloTxHash,
  SoloGameError
} from "@backend/coinflip/service";

export const runtime = "nodejs";

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

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const round = await getSoloRoundWithLifecycle(params.id);

    if (!round) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }

    return NextResponse.json({ round });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "").trim().toLowerCase();
    const playerAddress = String(body.playerAddress ?? "").trim();

    if (action === "report_tx") {
      const txHash = String(body.txHash ?? "").trim();
      if (!txHash || !playerAddress) {
        throw new SoloGameError("txHash and playerAddress are required", 400);
      }
      const round = await reportSoloTxHash({
        roundId: params.id,
        playerAddress,
        txHash
      });
      return NextResponse.json({ round });
    }

    if (action !== "abandon") {
      throw new SoloGameError("Unsupported action", 400);
    }

    if (!playerAddress) {
      throw new SoloGameError("playerAddress is required", 400);
    }

    const round = await abandonSoloRound({
      roundId: params.id,
      playerAddress
    });

    return NextResponse.json({ round });
  } catch (error) {
    return toErrorResponse(error);
  }
}
