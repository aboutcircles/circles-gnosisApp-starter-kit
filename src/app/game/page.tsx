"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const POLL_INTERVAL_MS = 7000;
const MAX_POLL_ATTEMPTS = 24;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export default function GamePage() {
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [submittingMove, setSubmittingMove] = useState<SoloMove | null>(null);
  const [status, setStatus] = useState<string>("Connect wallet in host app.");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<SoloRound | null>(null);
  const [myRounds, setMyRounds] = useState<SoloRound[]>([]);

  const roundPollTimer = useRef<number | null>(null);
  const pollAttemptsRef = useRef(0);

  const clearRoundPoll = useCallback(() => {
    if (roundPollTimer.current !== null) {
      window.clearInterval(roundPollTimer.current);
      roundPollTimer.current = null;
    }
  }, []);

  const pollRound = useCallback(
    (roundId: string) => {
      clearRoundPoll();
      pollAttemptsRef.current = 0;

      roundPollTimer.current = window.setInterval(async () => {
        pollAttemptsRef.current += 1;
        if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
          setStatus("Still pending. Re-open wallet activity and tap Heads/Tails once to retry.");
          clearRoundPoll();
          return;
        }

        try {
          const response = await fetch(`/api/solo/rounds/${roundId}`, { cache: "no-store" });
          const payload = (await response.json()) as SoloRoundResponse;

          if (!response.ok || !payload.round) {
            return;
          }

          setRound(payload.round);
          void fetch(
            `/api/solo/rounds?playerAddress=${encodeURIComponent(payload.round.playerAddress)}`,
            { cache: "no-store" }
          )
            .then(async (res) => {
              const data = (await res.json()) as SoloRoundsResponse;
              if (res.ok) {
                setMyRounds(data.rounds ?? []);
              }
            })
            .catch(() => undefined);

          if (payload.round.status === "completed") {
            const outcome = payload.round.result?.outcome ?? "unknown";
            setStatus(`Round completed: ${outcome.toUpperCase()}`);
            clearRoundPoll();
            return;
          }

          if (payload.round.payment.status === "paid") {
            setStatus("Payment detected. Resolving round...");
            return;
          }

          setStatus("Waiting for payment confirmation...");
        } catch {
          // Keep polling quietly.
        }
      }, POLL_INTERVAL_MS);
    },
    [clearRoundPoll]
  );

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

  const findAndResumeActiveRound = useCallback(async (): Promise<SoloRound | null> => {
    const rounds = await fetchMyRounds();
    if (!rounds.length) return null;
    const active = rounds.find((item) => item.status !== "completed");

    if (!active) {
      return null;
    }

    setRound(active);
    pollRound(active.id);
    return active;
  }, [fetchMyRounds, pollRound]);

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
      clearRoundPoll();
    };
  }, [clearRoundPoll]);

  useEffect(() => {
    if (!connectedAddress) {
      setMyRounds([]);
      return;
    }

    void fetchMyRounds();
  }, [connectedAddress, fetchMyRounds]);

  const runMove = useCallback(
    async (move: SoloMove) => {
      if (!connectedAddress) {
        setError("No connected wallet found.");
        return;
      }

      setSubmittingMove(move);
      setError(null);
      setStatus(`Creating ${move.toUpperCase()} round...`);
      let createdRoundId: string | null = null;

      try {
        const createResponse = await fetch("/api/solo/rounds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerAddress: connectedAddress,
            move
          })
        });

        const createPayload = (await createResponse.json()) as SoloRoundResponse;

        if (!createResponse.ok || !createPayload.round) {
          if (createResponse.status === 409) {
            const resumed = await findAndResumeActiveRound();
            if (resumed) {
              setStatus("Resumed existing pending round. Waiting for payment confirmation...");
              return;
            }
          }
          throw new Error(createPayload.error || "Could not create round.");
        }

        const newRound = createPayload.round;
        createdRoundId = newRound.id;
        setRound(newRound);
        void fetchMyRounds();
        setStatus("Round created. Sending payment transaction...");

        const txs = newRound.payment.hostTransactions ?? [];
        if (!txs.length) {
          throw new Error("No payment transaction payload returned from backend.");
        }

        const sdkModule = (await import("@aboutcircles/miniapp-sdk")) as unknown as MiniappSdk;
        await withTimeout(
          sdkModule.sendTransactions(txs),
          45000,
          "Timed out waiting for miniapp transaction response."
        );

        setStatus("Transaction sent. Waiting for payment confirmation...");
        pollRound(newRound.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Move failed.";
        const lower = message.toLowerCase();

        if (
          lower.includes("timed out while waiting for user operation") ||
          lower.includes("timed out waiting for miniapp transaction response")
        ) {
          setStatus("Transaction may be pending. Waiting for confirmation...");
          if (createdRoundId) {
            pollRound(createdRoundId);
            return;
          }
          const resumed = await findAndResumeActiveRound();
          if (!resumed) {
            setStatus("Could not resume pending round. Tap Heads/Tails once more.");
          }
        } else {
          setError(message);
          setStatus("Move failed. Try again.");
        }
      } finally {
        setSubmittingMove(null);
        void fetchMyRounds();
      }
    },
    [connectedAddress, fetchMyRounds, findAndResumeActiveRound, pollRound]
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
            disabled={!ready || submittingMove !== null}
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
            disabled={!ready || submittingMove !== null}
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
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setRound(item);
                    if (item.status !== "completed") {
                      setStatus("Resumed pending round. Waiting for payment confirmation...");
                      pollRound(item.id);
                    } else {
                      setStatus("Round loaded.");
                    }
                  }}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-left text-xs text-ink/80 hover:border-ink/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono">#{item.id.slice(0, 8)}</p>
                    {item.status === "completed" ? (
                      <span
                        className={
                          item.result?.outcome === "win"
                            ? "rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700"
                            : "rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700"
                        }
                      >
                        {item.result?.outcome === "win" ? "Win" : "Lose"}
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                        Pending
                      </span>
                    )}
                  </div>
                  <p className="mt-1 uppercase">Move: {item.move}</p>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
