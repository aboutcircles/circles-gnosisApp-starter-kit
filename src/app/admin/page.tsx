"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw
} from "lucide-react";

import { AppNav } from "@/components/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { shortAddress } from "@/lib/ui-format";
import type { SoloRound } from "@/types/solo";

const TX_BASE_URL = "https://gnosisscan.io/tx/";

type BadgeVariant = "neutral" | "waiting" | "success" | "error";

interface SoloRoundsResponse {
  rounds: SoloRound[];
  config: {
    payout: {
      orgAvatarAddress?: string;
      orgName?: string | null;
      orgBalanceCRC?: string | null;
      entryRecipientAddress?: string;
      isConfigured: boolean;
      entryFeeCRC: string;
      winnerPayoutCRC: string;
    };
  };
}

function roundBadge(status: SoloRound["status"]): BadgeVariant {
  switch (status) {
    case "awaiting_payment":
      return "waiting";
    case "resolving":
      return "waiting";
    case "completed":
      return "success";
    default:
      return "neutral";
  }
}

function payoutBadge(status: SoloRound["payout"]["status"]): BadgeVariant {
  switch (status) {
    case "pending":
    case "processing":
      return "waiting";
    case "paid":
      return "success";
    case "failed":
      return "error";
    case "skipped":
    default:
      return "neutral";
  }
}

export default function AdminPage() {
  const [rounds, setRounds] = useState<SoloRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgAddress, setOrgAddress] = useState("");
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgBalanceCRC, setOrgBalanceCRC] = useState<string | null>(null);
  const [entryRecipientAddress, setEntryRecipientAddress] = useState("");
  const [entryFeeCRC, setEntryFeeCRC] = useState("1");
  const [winnerPayoutCRC, setWinnerPayoutCRC] = useState("2");
  const [configured, setConfigured] = useState(false);

  const fetchRounds = useCallback(async () => {
    const response = await fetch("/api/solo/rounds", { cache: "no-store" });
    const payload = (await response.json()) as SoloRoundsResponse & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load rounds");
    }

    setRounds(payload.rounds ?? []);
    setOrgAddress(payload.config?.payout?.orgAvatarAddress ?? "");
    setOrgName(payload.config?.payout?.orgName ?? null);
    setOrgBalanceCRC(payload.config?.payout?.orgBalanceCRC ?? null);
    setEntryRecipientAddress(payload.config?.payout?.entryRecipientAddress ?? "");
    setEntryFeeCRC(payload.config?.payout?.entryFeeCRC ?? "1");
    setWinnerPayoutCRC(payload.config?.payout?.winnerPayoutCRC ?? "2");
    setConfigured(Boolean(payload.config?.payout?.isConfigured));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await fetchRounds();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }, [fetchRounds]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchRounds().catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [fetchRounds]);

  const summary = useMemo(() => {
    const total = rounds.length;
    const paidMoves = rounds.filter((round) => round.payment.status === "paid").length;
    const wins = rounds.filter((round) => round.result?.outcome === "win").length;
    const losses = rounds.filter((round) => round.result?.outcome === "lose").length;
    const payoutsPaid = rounds.filter((round) => round.payout.status === "paid").length;

    return { total, paidMoves, wins, losses, payoutsPaid };
  }, [rounds]);

  return (
    <main className="px-4 py-10 md:py-14">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-ink/10 bg-white/75 p-5 shadow-[0_22px_40px_-28px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.26em] text-ink/65">
                <BarChart3 className="h-4 w-4" />
                Solo Game Admin
              </p>
              <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
                Monitor rounds and payouts.
              </h1>
              <p className="max-w-3xl text-sm text-ink/70">
                This page is read-only operations visibility for the one-player game and automated
                payout pipeline.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <AppNav />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void refresh();
                }}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 rounded-2xl border border-ink/10 bg-white/70 p-4 text-xs text-ink/70 md:grid-cols-5">
            <div className="flex items-center justify-between gap-2">
              <span>Move recipient</span>
              <span className="font-mono">{shortAddress(entryRecipientAddress)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Org name</span>
              <span className="font-mono">{orgName ?? "-"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Payout source</span>
              <span className="font-mono">{shortAddress(orgAddress)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Move fee</span>
              <span className="font-mono">{entryFeeCRC} CRC</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Win payout</span>
              <span className="font-mono">{winnerPayoutCRC} CRC</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Automation</span>
              <Badge variant={configured ? "success" : "error"}>{configured ? "ready" : "missing env"}</Badge>
            </div>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-5">
          <Card className="border-marine/20 bg-gradient-to-br from-marine/10 to-white md:col-span-5">
            <CardHeader>
              <CardDescription>Org Overview</CardDescription>
              <div className="flex flex-wrap items-baseline gap-4">
                <CardTitle className="font-display text-4xl tracking-tight text-ink md:text-5xl">
                  {orgName ?? shortAddress(orgAddress)}
                </CardTitle>
                <CardTitle className="font-display text-4xl tracking-tight text-ink md:text-5xl">
                  {orgBalanceCRC ?? "-"} <span className="text-ink/70">CRC</span>
                </CardTitle>
              </div>
              <p className="text-xs text-ink/60">Source avatar: {shortAddress(orgAddress)}</p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Total rounds</CardDescription>
              <CardTitle>{summary.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Paid moves</CardDescription>
              <CardTitle>{summary.paidMoves}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Wins</CardDescription>
              <CardTitle>{summary.wins}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Losses</CardDescription>
              <CardTitle>{summary.losses}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Payouts sent</CardDescription>
              <CardTitle>{summary.payoutsPaid}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Round Ledger</CardTitle>
            <CardDescription>Latest one-player rounds with payment and payout receipts.</CardDescription>
          </CardHeader>
          <CardContent>
            {!rounds.length ? (
              <p className="text-sm text-ink/70">No rounds yet.</p>
            ) : (
              <div className="space-y-3">
                {rounds.map((round) => (
                  <div key={round.id} className="rounded-2xl border border-ink/10 bg-white/70 p-3 text-xs text-ink/70">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono">#{round.id.slice(0, 8)}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={roundBadge(round.status)}>{round.status}</Badge>
                        <Badge variant={payoutBadge(round.payout.status)}>payout {round.payout.status}</Badge>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 md:grid-cols-4">
                      <div>
                        <p className="text-ink/50">Player</p>
                        <p className="font-mono">{shortAddress(round.playerAddress)}</p>
                      </div>
                      <div>
                        <p className="text-ink/50">Move</p>
                        <p className="font-mono uppercase">{round.move}</p>
                      </div>
                      <div>
                        <p className="text-ink/50">Result</p>
                        <p className="font-mono uppercase">{round.result?.outcome ?? "pending"}</p>
                      </div>
                      <div>
                        <p className="text-ink/50">Coin</p>
                        <p className="font-mono uppercase">{round.result?.coin ?? "pending"}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div className="rounded-xl border border-ink/10 bg-sand/55 p-2">
                        <p className="text-ink/50">Move payment tx</p>
                        {round.payment.transactionHash ? (
                          <a
                            href={`${TX_BASE_URL}${round.payment.transactionHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-marine hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {shortAddress(round.payment.transactionHash)}
                          </a>
                        ) : (
                          <p className="font-mono">pending</p>
                        )}
                      </div>

                      <div className="rounded-xl border border-ink/10 bg-sand/55 p-2">
                        <p className="text-ink/50">Payout tx</p>
                        {round.payout.txHash ? (
                          <a
                            href={`${TX_BASE_URL}${round.payout.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-marine hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {shortAddress(round.payout.txHash)}
                          </a>
                        ) : (
                          <p className="font-mono">{round.payout.error || "pending"}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </p>
          </div>
        )}

        {!error && configured && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Payout automation is configured and active.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
