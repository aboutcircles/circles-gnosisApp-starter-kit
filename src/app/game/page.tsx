"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
  Swords,
  Wallet
} from "lucide-react";

import { AppNav } from "@/components/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { shortAddress } from "@/lib/ui-format";
import type { SoloMove, SoloRound } from "@/types/solo";

const TX_BASE_URL = "https://gnosisscan.io/tx/";

type BadgeVariant = "neutral" | "waiting" | "success" | "error";

interface SoloRoundsResponse {
  rounds: SoloRound[];
  config: {
    payout: {
      orgAvatarAddress?: string;
      entryRecipientAddress?: string;
      isConfigured: boolean;
      entryFeeCRC: string;
      winnerPayoutCRC: string;
    };
  };
}

interface SoloRoundResponse {
  round: SoloRound;
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

function upsertRound(list: SoloRound[], updated: SoloRound): SoloRound[] {
  const merged = [updated, ...list.filter((item) => item.id !== updated.id)];
  return merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export default function GamePage() {
  const [rounds, setRounds] = useState<SoloRound[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [selectedRound, setSelectedRound] = useState<SoloRound | null>(null);

  const [playerAddress, setPlayerAddress] = useState("");
  const [move, setMove] = useState<SoloMove>("heads");

  const [entryFeeCRC, setEntryFeeCRC] = useState("1");
  const [winnerPayoutCRC, setWinnerPayoutCRC] = useState("2");
  const [orgAddress, setOrgAddress] = useState("");
  const [entryRecipientAddress, setEntryRecipientAddress] = useState("");

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [openQrRoundId, setOpenQrRoundId] = useState<string | null>(null);
  const [qrByRoundId, setQrByRoundId] = useState<Record<string, string>>({});
  const [qrLoadingRoundId, setQrLoadingRoundId] = useState<string | null>(null);
  const [qrErrorRoundId, setQrErrorRoundId] = useState<string | null>(null);

  const fetchRounds = useCallback(async () => {
    const response = await fetch("/api/solo/rounds", { cache: "no-store" });
    const payload = (await response.json()) as SoloRoundsResponse & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load rounds");
    }

    setRounds(payload.rounds ?? []);
    setEntryFeeCRC(payload.config?.payout?.entryFeeCRC ?? "1");
    setWinnerPayoutCRC(payload.config?.payout?.winnerPayoutCRC ?? "2");
    setOrgAddress(payload.config?.payout?.orgAvatarAddress ?? "");
    setEntryRecipientAddress(payload.config?.payout?.entryRecipientAddress ?? "");

    setSelectedRound((previous) => {
      if (!payload.rounds?.length) {
        setSelectedRoundId(null);
        return null;
      }

      const preferredId = selectedRoundId ?? previous?.id;
      const nextSelected = payload.rounds.find((item) => item.id === preferredId) ?? payload.rounds[0];
      setSelectedRoundId(nextSelected.id);
      return nextSelected;
    });
  }, [selectedRoundId]);

  const fetchRound = useCallback(async (roundId: string) => {
    const response = await fetch(`/api/solo/rounds/${roundId}`, { cache: "no-store" });
    const payload = (await response.json()) as SoloRoundResponse & { error?: string };

    if (!response.ok || !payload.round) {
      throw new Error(payload.error || "Failed to load round");
    }

    setSelectedRound(payload.round);
    setRounds((previous) => upsertRound(previous, payload.round));
    return payload.round;
  }, []);

  const refresh = useCallback(async (forceSelected: boolean = false) => {
    setLoading(true);
    setError(null);

    try {
      await fetchRounds();

      if (selectedRoundId && forceSelected) {
        await fetchRound(selectedRoundId);
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }, [fetchRounds, fetchRound, selectedRoundId]);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (selectedRoundId) {
        void fetchRound(selectedRoundId).catch(() => undefined);
      }
      void fetchRounds().catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [fetchRound, fetchRounds, selectedRoundId]);

  const createMoveRound = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch("/api/solo/rounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerAddress, move })
      });

      const payload = (await response.json()) as SoloRoundResponse & { error?: string };

      if (!response.ok || !payload.round) {
        throw new Error(payload.error || "Could not create move");
      }

      setSelectedRound(payload.round);
      setSelectedRoundId(payload.round.id);
      setRounds((previous) => upsertRound(previous, payload.round));
      setInfo("Move prepared. Scan or open the payment link to execute it.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create move");
    } finally {
      setCreating(false);
    }
  };

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setInfo(message);
      window.setTimeout(() => setInfo((current) => (current === message ? null : current)), 1800);
    } catch {
      setError("Copy failed");
    }
  };

  const toggleQr = async (round: SoloRound) => {
    if (openQrRoundId === round.id) {
      setOpenQrRoundId(null);
      return;
    }

    setOpenQrRoundId(round.id);
    setQrErrorRoundId(null);

    if (qrByRoundId[round.id]) {
      return;
    }

    setQrLoadingRoundId(round.id);

    try {
      const { toDataURL } = await import("qrcode");
      const image = await toDataURL(round.payment.paymentLink, { width: 220, margin: 1 });
      setQrByRoundId((previous) => ({ ...previous, [round.id]: image }));
    } catch {
      setQrErrorRoundId(round.id);
    } finally {
      setQrLoadingRoundId(null);
    }
  };

  const verifyRound = async (roundId: string) => {
    setActioning(roundId);
    setError(null);
    setInfo(null);

    try {
      const round = await fetchRound(roundId);
      await fetchRounds();

      if (round.status === "awaiting_payment" && round.payment.status !== "paid") {
        setInfo("Payment not detected yet. If you just paid, wait 15-60 seconds and verify again.");
      }
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Verification failed");
    } finally {
      setActioning(null);
    }
  };

  const recentRounds = useMemo(() => rounds.slice(0, 20), [rounds]);

  return (
    <main className="px-4 py-10 md:py-14">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-ink/10 bg-white/75 p-5 shadow-[0_22px_40px_-28px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.26em] text-ink/65">
                <Swords className="h-4 w-4" />
                Solo Game
              </p>
              <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
                Heads or Tails
              </h1>
              <p className="max-w-3xl text-sm text-ink/70">
                Pick `heads` or `tails`, generate a move transaction, then scan the QR in Gnosis.
                After payment confirmation, the round resolves and winner payout is automatic.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <AppNav />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void refresh(true);
                }}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 rounded-2xl border border-ink/10 bg-white/70 p-4 text-xs text-ink/70 md:grid-cols-4">
            <div className="flex items-center justify-between gap-2">
              <span>Move recipient</span>
              <span className="font-mono">{shortAddress(entryRecipientAddress)}</span>
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
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>New Move</CardTitle>
              <CardDescription>Create a QR-backed move transaction.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={createMoveRound}>
                <div className="space-y-2">
                  <label htmlFor="player" className="text-sm font-medium text-ink">
                    Player address
                  </label>
                  <Input
                    id="player"
                    value={playerAddress}
                    onChange={(event) => setPlayerAddress(event.target.value)}
                    placeholder="0x..."
                    spellCheck={false}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink">Move</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["heads", "tails"] as SoloMove[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                          move === option
                            ? "bg-marine text-white"
                            : "border border-ink/15 bg-white text-ink/70 hover:border-ink/30"
                        }`}
                        onClick={() => setMove(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <Button className="w-full" type="submit" disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                  {creating ? "Preparing move" : "Create move transaction"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current Round</CardTitle>
              <CardDescription>Pay to submit move, then wait for auto-resolution.</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedRound ? (
                <p className="text-sm text-ink/70">No round selected yet.</p>
              ) : (
                <div className="space-y-4 text-xs text-ink/70">
                  <div className="rounded-2xl border border-ink/10 bg-white/70 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">#{selectedRound.id.slice(0, 8)}</span>
                      <Badge variant={roundBadge(selectedRound.status)}>{selectedRound.status}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span>Player</span>
                      <span className="font-mono">{shortAddress(selectedRound.playerAddress)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span>Move</span>
                      <span className="font-mono uppercase">{selectedRound.move}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span>Move fee</span>
                      <span className="font-mono">{selectedRound.payment.amountCRC} CRC</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-ink/10 bg-sand/55 p-3">
                    <div className="flex items-center justify-between">
                      <span>Entry payment</span>
                      <Badge variant={selectedRound.payment.status === "paid" ? "success" : "waiting"}>
                        {selectedRound.payment.status}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" asChild>
                        <a href={selectedRound.payment.paymentLink} target="_blank" rel="noreferrer">
                          <Wallet className="h-4 w-4" />
                          Open in Gnosis App
                        </a>
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() => {
                          void copyText(selectedRound.payment.paymentLink, "Copied move payment link");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                        Copy
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() => {
                          void toggleQr(selectedRound);
                        }}
                      >
                        <QrCode className="h-4 w-4" />
                        QR
                      </Button>
                    </div>

                    {openQrRoundId === selectedRound.id && (
                      <div className="mt-3 rounded-xl border border-ink/10 bg-white/70 p-3 text-xs">
                        {qrLoadingRoundId === selectedRound.id ? (
                          <p className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Generating QR...
                          </p>
                        ) : qrErrorRoundId === selectedRound.id ? (
                          <p className="text-red-600">Could not generate QR.</p>
                        ) : qrByRoundId[selectedRound.id] ? (
                          <div className="flex flex-col items-center gap-2">
                            <Image
                              src={qrByRoundId[selectedRound.id]}
                              alt="Move transaction QR code"
                              width={220}
                              height={220}
                              className="h-[220px] w-[220px] rounded-xl border border-ink/10 bg-white p-2"
                              unoptimized
                            />
                            <span>Scan this to execute move payment</span>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {selectedRound.payment.transactionHash && (
                      <a
                        href={`${TX_BASE_URL}${selectedRound.payment.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 font-mono text-marine hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {shortAddress(selectedRound.payment.transactionHash)}
                      </a>
                    )}

                    <div className="mt-3 flex items-center justify-between rounded-lg border border-ink/10 bg-white/60 px-2 py-1">
                      <span>Recipient</span>
                      <span className="font-mono">{shortAddress(selectedRound.payment.recipientAddress)}</span>
                    </div>

                    <Button
                      className="mt-3 w-full"
                      onClick={() => {
                        void verifyRound(selectedRound.id);
                      }}
                      disabled={actioning === selectedRound.id}
                    >
                      {actioning === selectedRound.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Verify payment & resolve
                    </Button>
                  </div>

                  {selectedRound.result && (
                    <div className="rounded-2xl border border-ink/10 bg-white/70 p-3">
                      <div className="flex items-center justify-between">
                        <span>Coin</span>
                        <span className="font-mono uppercase">{selectedRound.result.coin}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span>Outcome</span>
                        <span className="font-mono uppercase">{selectedRound.result.outcome}</span>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-ink/10 bg-white/70 p-3">
                    <div className="flex items-center justify-between">
                      <span>Payout</span>
                      <Badge variant={payoutBadge(selectedRound.payout.status)}>
                        {selectedRound.payout.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span>Amount</span>
                      <span className="font-mono">{selectedRound.payout.amountCRC} CRC</span>
                    </div>
                    {selectedRound.payout.txHash && (
                      <a
                        href={`${TX_BASE_URL}${selectedRound.payout.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 font-mono text-marine hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {shortAddress(selectedRound.payout.txHash)}
                      </a>
                    )}
                    {selectedRound.payout.error && (
                      <p className="mt-2 text-red-600">{selectedRound.payout.error}</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Rounds</CardTitle>
            <CardDescription>Select any round to inspect payment and payout details.</CardDescription>
          </CardHeader>
          <CardContent>
            {!recentRounds.length ? (
              <p className="text-sm text-ink/70">No rounds yet.</p>
            ) : (
              <div className="space-y-2">
                {recentRounds.map((round) => (
                  <button
                    key={round.id}
                    type="button"
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      selectedRoundId === round.id
                        ? "border-marine/35 bg-marine/10"
                        : "border-ink/10 bg-white/70 hover:border-ink/20"
                    }`}
                    onClick={() => {
                      setSelectedRoundId(round.id);
                      setSelectedRound(round);
                      void fetchRound(round.id).catch(() => undefined);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-ink/65">#{round.id.slice(0, 8)}</span>
                      <Badge variant={roundBadge(round.status)}>{round.status}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-ink/70">
                      <p>Player: {shortAddress(round.playerAddress)}</p>
                      <p className="mt-1">Move: {round.move}</p>
                      <p className="mt-1">Outcome: {round.result?.outcome ?? "pending"}</p>
                      <p className="mt-1">Payout: {round.payout.status}</p>
                    </div>
                  </button>
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

        {info && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {info}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
