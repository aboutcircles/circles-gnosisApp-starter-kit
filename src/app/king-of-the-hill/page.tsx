"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Clipboard, Crown, QrCode, TimerReset, Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  circlesConfig,
  fetchLatestMatchingTransferEvent,
  generatePaymentLink,
  type CirclesTransferEvent
} from "@/lib/circles";

type PollStatus = "idle" | "watching" | "error";

function createRoundId() {
  const seed =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `koth-${Date.now().toString(36)}-${seed}`;
}

function formatAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatRemaining(ms: number) {
  const secondsTotal = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(secondsTotal / 60);
  const seconds = secondsTotal % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatEventTime(timestamp: string) {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Unknown";
  const milliseconds = parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
  return new Date(milliseconds).toLocaleTimeString();
}

export default function KingOfTheHillPage() {
  const [recipient, setRecipient] = useState(circlesConfig.defaultRecipientAddress);
  const [amount, setAmount] = useState("0.1");
  const [durationMinutes, setDurationMinutes] = useState("2");
  const [roundId, setRoundId] = useState("");
  const [roundEndsAt, setRoundEndsAt] = useState<number | null>(null);
  const [leader, setLeader] = useState<CirclesTransferEvent | null>(null);
  const [pollStatus, setPollStatus] = useState<PollStatus>("idle");
  const [pollError, setPollError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [qrState, setQrState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [qrCode, setQrCode] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const amountValue = Number(amount);
  const durationValue = Number(durationMinutes);
  const canStartRound = Boolean(
    recipient && Number.isFinite(amountValue) && amountValue > 0 && Number.isFinite(durationValue) && durationValue > 0
  );

  const remainingMs = roundEndsAt ? Math.max(0, roundEndsAt - now) : 0;
  const isRoundRunning = Boolean(roundEndsAt && remainingMs > 0);
  const isRoundFinished = Boolean(roundEndsAt && remainingMs <= 0);

  const paymentLink = useMemo(() => {
    if (!roundId || !recipient || !Number.isFinite(amountValue) || amountValue <= 0) {
      return "";
    }
    return generatePaymentLink(recipient, amountValue, roundId);
  }, [roundId, recipient, amountValue]);

  useEffect(() => {
    if (!isRoundRunning) return;
    const timerId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, [isRoundRunning]);

  useEffect(() => {
    let active = true;

    if (!paymentLink || !isRoundRunning) {
      setQrCode("");
      setQrState("idle");
      setShowQr(false);
      return;
    }

    setQrState("loading");
    (async () => {
      try {
        const { toDataURL } = await import("qrcode");
        const dataUrl = await toDataURL(paymentLink, { width: 240, margin: 1 });
        if (active) {
          setQrCode(dataUrl);
          setQrState("ready");
        }
      } catch {
        if (active) {
          setQrCode("");
          setQrState("error");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [paymentLink, isRoundRunning]);

  useEffect(() => {
    if (!isRoundRunning || !roundId || !recipient) {
      if (!isRoundFinished) {
        setPollStatus("idle");
      }
      return;
    }

    let cancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (cancelled) return;

      setPollStatus((previous) => (previous === "error" ? previous : "watching"));

      try {
        const latest = await fetchLatestMatchingTransferEvent(roundId, recipient, 250);
        if (cancelled) return;

        if (latest) {
          setLeader(latest);
        }

        setPollError(null);
        setPollStatus("watching");
      } catch (error) {
        if (cancelled) return;
        setPollError(error instanceof Error ? error.message : "Unable to fetch round state");
        setPollStatus("error");
      }

      if (!cancelled && roundEndsAt && Date.now() < roundEndsAt) {
        timeoutId = setTimeout(poll, 1000);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isRoundRunning, isRoundFinished, roundId, recipient, roundEndsAt]);

  const handleStartRound = () => {
    if (!canStartRound) return;

    const startedAt = Date.now();
    setNow(startedAt);
    setRoundId(createRoundId());
    setRoundEndsAt(startedAt + Math.round(durationValue * 60 * 1000));
    setLeader(null);
    setPollError(null);
    setPollStatus("watching");
    setCopyState("idle");
  };

  const handleEndNow = () => {
    setNow(Date.now());
    setRoundEndsAt(Date.now());
  };

  const handleCopy = async () => {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(paymentLink);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  };

  const roundStatus = isRoundRunning
    ? pollStatus === "error"
      ? { label: "RPC error", variant: "error" as const }
      : { label: "Live", variant: "waiting" as const }
    : isRoundFinished
      ? { label: "Ended", variant: "success" as const }
      : { label: "Idle", variant: "neutral" as const };

  return (
    <main className="px-4 py-10 md:py-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="space-y-4">
          <nav
            aria-label="King of the Hill navigation"
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm shadow-[0_10px_28px_-24px_rgba(15,23,42,0.35)] backdrop-blur"
          >
            <Link href="/" className="inline-flex items-center gap-2 font-semibold text-ink hover:text-ink/70">
              <ArrowLeft className="h-4 w-4" />
              Back to starter
            </Link>
            <Badge variant={roundStatus.variant}>{roundStatus.label}</Badge>
          </nav>
          <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
            King of the Hill
          </h1>
          <p className="max-w-2xl text-sm text-ink/70">
            Every valid payment claims the crown. The latest payer before the timer ends wins the round.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Round control</CardTitle>
              <CardDescription>Set the round rules, then share the payment link or QR.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="recipient">Recipient address</Label>
                <Input
                  id="recipient"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="0x..."
                  spellCheck={false}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="amount">Round buy-in (CRC)</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="duration">Duration (minutes)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-ink/10 bg-sand/70 p-4 text-xs text-ink/70">
                <div className="flex items-center justify-between">
                  <span>Round token</span>
                  <span className="font-mono">{roundId || "Start a round"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Time left</span>
                  <span className="font-mono">{isRoundRunning ? formatRemaining(remainingMs) : "-"}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="w-full" onClick={handleStartRound} disabled={!canStartRound}>
                  <TimerReset className="h-4 w-4" />
                  {isRoundRunning ? "Restart round" : "Start round"}
                </Button>
                <Button className="w-full" variant="secondary" onClick={handleEndNow} disabled={!isRoundRunning}>
                  End now
                </Button>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="w-full" asChild disabled={!isRoundRunning || !paymentLink}>
                  <a href={paymentLink} target="_blank" rel="noreferrer">
                    Open payment
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={handleCopy}
                  disabled={!isRoundRunning || !paymentLink}
                >
                  <Clipboard className="h-4 w-4" />
                  {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy link"}
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => setShowQr((value) => !value)}
                  disabled={!isRoundRunning || !paymentLink || qrState === "loading"}
                >
                  <QrCode className="h-4 w-4" />
                  {qrState === "loading" ? "Generating" : showQr ? "Hide QR" : "Show QR"}
                </Button>
              </div>

              {showQr && (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink/10 bg-white/70 p-4 text-xs text-ink/70">
                  {qrState === "ready" && qrCode ? (
                    <Image
                      src={qrCode}
                      alt="King of the Hill payment QR"
                      width={240}
                      height={240}
                      className="h-[240px] w-[240px] rounded-xl border border-ink/10 bg-white p-2"
                      unoptimized
                    />
                  ) : qrState === "error" ? (
                    <p>Unable to generate QR code for this round.</p>
                  ) : (
                    <p>Generating QR code...</p>
                  )}
                  <span>Share this QR so challengers can attempt the crown.</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-citrus" />
                Crown tracker
              </CardTitle>
              <CardDescription>Latest matching payment becomes the current king.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between space-y-5">
              <div className="space-y-4 rounded-2xl border border-ink/10 bg-white/60 p-4 text-sm text-ink/70">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-ink/55">
                  <span>Round state</span>
                  <span>{roundStatus.label}</span>
                </div>

                {leader ? (
                  <div className="space-y-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <Trophy className="h-4 w-4 text-citrus" />
                      {isRoundRunning ? "Current king" : "Winner"}
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <span>Address</span>
                      <span className="font-mono">{formatAddress(leader.from)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span>Tx hash</span>
                      <span className="font-mono">{formatAddress(leader.transactionHash)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span>Claimed at</span>
                      <span className="font-mono">{formatEventTime(leader.timestamp)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-ink/60">
                    {isRoundRunning
                      ? "No challengers yet. First valid payment becomes king."
                      : "Start a round to begin crown tracking."}
                  </p>
                )}
              </div>

              <div className="space-y-3 rounded-2xl border border-ink/10 bg-sand/60 p-4 text-xs text-ink/60">
                <p>
                  Valid payment rule: recipient + round token must match.
                </p>
                <div className="flex items-center justify-between">
                  <span>RPC endpoint</span>
                  <span className="font-mono">{circlesConfig.rpcUrl.replace("https://", "")}</span>
                </div>
                {pollStatus === "error" && pollError ? <p className="text-red-600">{pollError}</p> : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
