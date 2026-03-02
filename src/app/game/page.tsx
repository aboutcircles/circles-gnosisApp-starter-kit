"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleX, Loader2, Trophy } from "lucide-react";

import type { SoloMove, SoloRound } from "@/types/solo";

type MiniappSdk = {
  onWalletChange: (callback: (address: string | null) => void) => void | (() => void);
  sendTransactions: (
    txs: Array<{ to: string; data: `0x${string}`; value: `0x${string}` }>
  ) => Promise<string[]>;
};

interface SoloRoundResponse {
  round?: SoloRound;
  error?: string;
}

interface SoloRoundsResponse {
  rounds?: SoloRound[];
  error?: string;
}

function upsertRoundInList(rounds: SoloRound[], updated: SoloRound): SoloRound[] {
  const next = new Map<string, SoloRound>();
  for (const item of rounds) {
    next.set(item.id, item);
  }

  const existing = next.get(updated.id);
  if (!existing || updated.updatedAt >= existing.updatedAt) {
    next.set(updated.id, updated);
  }

  return Array.from(next.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function reportTxHash(roundId: string, playerAddress: string, txHash: string): Promise<SoloRound | null> {
  try {
    const res = await fetch(`/api/solo/rounds/${roundId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "report_tx", playerAddress, txHash })
    });
    const payload = (await res.json()) as SoloRoundResponse;
    return payload.round ?? null;
  } catch {
    return null;
  }
}

async function pollRoundUntilResolved(
  roundId: string,
  intervalMs: number = 3000,
  maxAttempts: number = 80
): Promise<SoloRound | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const res = await fetch(`/api/solo/rounds?roundId=${encodeURIComponent(roundId)}`, {
        cache: "no-store"
      });
      const payload = (await res.json()) as SoloRoundResponse;
      const round = payload.round;
      if (round && round.status === "completed") {
        return round;
      }
    } catch {
      // keep polling
    }
  }
  return null;
}

export default function GamePage() {
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [submittingMove, setSubmittingMove] = useState<SoloMove | null>(null);
  const [roundActioningId, setRoundActioningId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Connect wallet in host app.");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<SoloRound | null>(null);
  const [myRounds, setMyRounds] = useState<SoloRound[]>([]);

  const fetchMyRounds = useCallback(async (): Promise<SoloRound[]> => {
    if (!connectedAddress) {
      setMyRounds([]);
      return [];
    }

    try {
      const response = await fetch(`/api/solo/rounds?playerAddress=${encodeURIComponent(connectedAddress)}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as SoloRoundsResponse;

      if (!response.ok) {
        return [];
      }

      const rounds = payload.rounds ?? [];
      setMyRounds(rounds);
      return rounds;
    } catch {
      return [];
    }
  }, [connectedAddress]);

  // SDK init
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let isMounted = true;

    void import("@aboutcircles/miniapp-sdk")
      .then((module) => {
        if (!isMounted) return;
        const sdk = module as unknown as MiniappSdk;
        const maybeCleanup = sdk.onWalletChange((address) => {
          const normalized = address?.trim() || null;
          setConnectedAddress(normalized);
          setReady(Boolean(normalized));
          setStatus(normalized ? "Ready. Choose Heads or Tails." : "Connect wallet in host app.");
        });
        if (typeof maybeCleanup === "function") {
          cleanup = maybeCleanup;
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setReady(false);
        setStatus("Miniapp SDK unavailable in this context.");
      });

    return () => {
      isMounted = false;
      cleanup?.();
    };
  }, []);

  // Fetch rounds on wallet connect
  useEffect(() => {
    if (!connectedAddress) {
      setMyRounds([]);
      return;
    }
    void fetchMyRounds();
  }, [connectedAddress, fetchMyRounds]);

  /** Send transactions via miniapp SDK and return the first tx hash, or null on timeout. */
  const fireTransactions = useCallback(
    async (
      txs: Array<{ to: string; data: `0x${string}`; value: `0x${string}` }>
    ): Promise<string | null> => {
      const sdkModule = (await import("@aboutcircles/miniapp-sdk")) as unknown as MiniappSdk;

      try {
        const hashes = await sdkModule.sendTransactions(txs);
        return hashes?.[0] ?? null;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // UserOperation timeout — tx may still land on-chain
        if (msg.includes("Timed out") || msg.includes("UserOperation")) {
          return null;
        }
        throw e;
      }
    },
    []
  );

  const showResult = useCallback(
    (resolved: SoloRound) => {
      setRound(resolved);
      setMyRounds((current) => upsertRoundInList(current, resolved));
      if (resolved.status === "completed") {
        const outcome = resolved.result?.outcome ?? "unknown";
        setStatus(`Round completed: ${outcome.toUpperCase()}`);
      }
      void fetchMyRounds();
    },
    [fetchMyRounds]
  );

  const runMove = useCallback(
    async (move: SoloMove) => {
      if (!connectedAddress) {
        setError("No connected wallet found.");
        return;
      }

      setSubmittingMove(move);
      setError(null);
      setStatus(`Creating ${move.toUpperCase()} round...`);

      try {
        // 1. Create the round on the backend
        const createResponse = await fetch("/api/solo/rounds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerAddress: connectedAddress, move })
        });

        const createPayload = (await createResponse.json()) as SoloRoundResponse;

        if (!createResponse.ok || !createPayload.round) {
          throw new Error(createPayload.error || "Could not create round.");
        }

        const newRound = createPayload.round;
        setRound(newRound);

        const txs = newRound.payment.hostTransactions ?? [];
        if (!txs.length) {
          throw new Error("No payment transaction payload returned from backend.");
        }

        // 2. Sign & send via miniapp SDK
        setStatus("Signing transaction...");
        const txHash = await fireTransactions(txs);

        // 3. If we got a hash, report it — server resolves the round immediately
        if (txHash) {
          setStatus("Resolving...");
          const resolved = await reportTxHash(newRound.id, connectedAddress, txHash);
          if (resolved && resolved.status === "completed") {
            showResult(resolved);
            return;
          }
        }

        // 4. Fallback: SDK timed out or report didn't complete — short poll
        setStatus("Waiting for confirmation...");
        const resolved = await pollRoundUntilResolved(newRound.id, 3000, 20);
        if (resolved) {
          showResult(resolved);
        } else {
          setStatus("Round is still processing. It will appear in your history when done.");
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Move failed.";
        const lower = message.toLowerCase();

        if (lower.includes("user rejected") || lower.includes("user denied")) {
          setError("Transaction was rejected.");
          setStatus("Ready. Choose Heads or Tails.");
        } else {
          setError(message);
          setStatus("Transaction failed. Try again or abandon the round.");
        }
      } finally {
        setSubmittingMove(null);
        void fetchMyRounds();
      }
    },
    [connectedAddress, fetchMyRounds, fireTransactions, showResult]
  );

  const resumeRoundPayment = useCallback(
    async (target: SoloRound) => {
      if (!connectedAddress) {
        setError("No connected wallet found.");
        return;
      }

      setRoundActioningId(target.id);
      setError(null);
      setRound(target);

      try {
        const txs = target.payment.hostTransactions ?? [];
        if (!txs.length) {
          throw new Error("No payment transaction payload found for this round.");
        }

        setStatus("Signing transaction...");
        const txHash = await fireTransactions(txs);

        if (txHash) {
          setStatus("Resolving...");
          const resolved = await reportTxHash(target.id, connectedAddress, txHash);
          if (resolved && resolved.status === "completed") {
            showResult(resolved);
            return;
          }
        }

        setStatus("Waiting for confirmation...");
        const resolved = await pollRoundUntilResolved(target.id, 3000, 20);
        if (resolved) {
          showResult(resolved);
        } else {
          setStatus("Round is still processing. It will appear in your history when done.");
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not resume payment.";
        const lower = message.toLowerCase();

        if (lower.includes("user rejected") || lower.includes("user denied")) {
          setError("Transaction was rejected.");
          setStatus("Ready. Choose Heads or Tails.");
        } else {
          setError(message);
          setStatus("Transaction failed. Try again or abandon the round.");
        }
      } finally {
        setRoundActioningId(null);
        void fetchMyRounds();
      }
    },
    [connectedAddress, fetchMyRounds, fireTransactions, showResult]
  );

  const abandonRound = useCallback(
    async (target: SoloRound) => {
      if (!connectedAddress) {
        setError("No connected wallet found.");
        return;
      }

      setRoundActioningId(target.id);
      setError(null);
      setStatus("Abandoning pending round...");

      try {
        const response = await fetch(`/api/solo/rounds/${target.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "abandon", playerAddress: connectedAddress })
        });
        const payload = (await response.json()) as SoloRoundResponse;

        if (!response.ok || !payload.round) {
          throw new Error(payload.error || "Could not abandon round.");
        }

        setRound(payload.round);
        setMyRounds((current) => upsertRoundInList(current, payload.round!));
        setStatus("Round abandoned. You can start a new move.");
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not abandon round.";
        setError(message);
        setStatus("Abandon failed.");
      } finally {
        setRoundActioningId(null);
        void fetchMyRounds();
      }
    },
    [connectedAddress, fetchMyRounds]
  );

  const completedOutcome = round?.status === "completed" ? round.result?.outcome ?? null : null;

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-ink/10 bg-white/85 p-6 shadow-[0_22px_40px_-28px_rgba(15,23,42,0.45)]">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-ink/60">Coin Flip Miniapp</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Choose your move</h1>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              void runMove("heads");
            }}
            disabled={!ready || submittingMove !== null || roundActioningId !== null}
            className="rounded-2xl bg-marine px-4 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submittingMove === "heads" ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Heads
              </span>
            ) : (
              "Heads"
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              void runMove("tails");
            }}
            disabled={!ready || submittingMove !== null || roundActioningId !== null}
            className="rounded-2xl bg-sand px-4 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-ink transition enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submittingMove === "tails" ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Tails
              </span>
            ) : (
              "Tails"
            )}
          </button>
        </div>

        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        {completedOutcome === "win" ? (
          <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-700">
              <Trophy className="h-4 w-4" />
              You Won
            </p>
            <p className="mt-2 text-sm text-emerald-800">Payout is being processed automatically.</p>
            {round ? <p className="mt-1 text-xs font-mono text-emerald-700/80">Round #{round.id.slice(0, 8)}</p> : null}
          </div>
        ) : null}

        {completedOutcome === "lose" ? (
          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-amber-700">
              <CircleX className="h-4 w-4" />
              You Lost
            </p>
            <p className="mt-2 text-sm text-amber-800">Tap Heads or Tails to start the next round.</p>
            {round ? <p className="mt-1 text-xs font-mono text-amber-700/80">Round #{round.id.slice(0, 8)}</p> : null}
          </div>
        ) : null}

        {!completedOutcome ? <p className="mt-5 text-sm text-ink/75">{status}</p> : null}
        {!completedOutcome && round ? (
          <p className="mt-1 text-xs font-mono text-ink/55">Round: {round.id.slice(0, 8)}</p>
        ) : null}

        {myRounds.length ? (
          <div className="mt-5 rounded-2xl border border-ink/10 bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
              Your rounds
            </p>
            <div className="mt-2 space-y-2">
              {myRounds.map((item) => (
                <div
                  key={item.id}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-left text-xs text-ink/80"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono">#{item.id.slice(0, 8)}</p>
                    {item.status === "completed" ? (
                      <span
                        className={
                          item.result?.outcome === "win"
                            ? "rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700"
                            : item.result?.outcome === "lose"
                              ? "rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700"
                              : "rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700"
                        }
                      >
                        {item.result?.outcome === "win"
                          ? "Win"
                          : item.result?.outcome === "lose"
                            ? "Lose"
                            : "Cancelled"}
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                        Pending
                      </span>
                    )}
                  </div>
                  <p className="mt-1 uppercase">Move: {item.move}</p>
                  {item.status !== "completed" ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void resumeRoundPayment(item);
                        }}
                        disabled={roundActioningId !== null}
                        className="rounded-lg bg-marine px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {roundActioningId === item.id ? "Working..." : "Pay now"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void abandonRound(item);
                        }}
                        disabled={roundActioningId !== null}
                        className="rounded-lg border border-ink/20 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/80 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Abandon
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
