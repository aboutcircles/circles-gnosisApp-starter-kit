import { NextResponse } from "next/server";

import { getSoloRoundWithLifecycle } from "@backend/coinflip/service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const round = await getSoloRoundWithLifecycle(params.id);

  if (!round) {
    return NextResponse.json({ error: "Round not found" }, { status: 404 });
  }

  return NextResponse.json({ round });
}
