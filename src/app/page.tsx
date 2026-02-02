"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Clipboard, Crown, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { circlesConfig, generatePaymentLink } from "@/lib/circles";
import { usePaymentWatcher } from "@/hooks/use-payment-watcher";
import { PaymentStatus } from "@/components/payment-status";

const defaultRecipient = circlesConfig.defaultRecipientAddress;

export default function Home() {
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("Circles payment");
  const [watching, setWatching] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [qrState, setQrState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [qrCode, setQrCode] = useState("");
  const [showQr, setShowQr] = useState(false);

  const amountValue = Number(amount);
  const dataValue = note;
  const hasDataValue = note.trim().length > 0;
  const dataPreview = hasDataValue
    ? dataValue.length > 16
      ? `${dataValue.slice(0, 12)}…`
      : dataValue
    : "…";
  const paymentLink = useMemo(() => {
    if (!recipient || !Number.isFinite(amountValue) || amountValue <= 0 || !hasDataValue) {
      return "";
    }
    return generatePaymentLink(recipient, amountValue, dataValue);
  }, [recipient, amountValue, dataValue, hasDataValue]);

  const { status, payment, error } = usePaymentWatcher({
    enabled: watching && Boolean(paymentLink),
    dataValue,
    minAmountCRC: amountValue || 0,
    recipientAddress: recipient
  });

  useEffect(() => {
    let active = true;

    if (!paymentLink) {
      setQrCode("");
      setQrState("idle");
      setShowQr(false);
      return;
    }

    setQrState("loading");
    (async () => {
      try {
        const { toDataURL } = await import("qrcode");
        const url = await toDataURL(paymentLink, { width: 220, margin: 1 });
        if (active) {
          setQrCode(url);
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
  }, [paymentLink]);

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

  return (
    <main className="px-4 py-10 md:py-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="space-y-4">
          <nav
            aria-label="Primary"
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm shadow-[0_10px_28px_-24px_rgba(15,23,42,0.35)] backdrop-blur"
          >
            <div className="flex items-center gap-3">
              <Image
                src="/logo-color.png"
                alt="Circles logo"
                width={160}
                height={48}
                className="h-10 w-auto"
                priority
              />
              <p className="text-xs uppercase tracking-[0.4em] text-ink/60"> Starter Kit</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-ink/60">
              <Link
                href="/king-of-the-hill"
                className="inline-flex items-center gap-1 rounded-full border border-citrus/30 bg-citrus/10 px-3 py-1 text-citrus transition hover:border-citrus/40 hover:bg-citrus/15"
              >
                <Crown className="h-3.5 w-3.5" />
                King of the Hill
              </Link>
              <Link
                href="/behind-the-scenes"
                className="rounded-full border border-ink/10 bg-white/70 px-3 py-1 transition hover:border-ink/20 hover:text-ink"
              >
                Behind the scenes
              </Link>
            </div>
          </nav>
          <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
            Build Circles-powered Gnosis App compatible apps.
          </h1>
          <p className="max-w-2xl text-sm text-ink/70">
            This boilerplate generates a Gnosis payment link, tracks it on the Circles RPC, and
            keeps the interface ready for standalone use. Use this as a starter repo to build your
            own apps compatible with Circles on Gnosis App.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Payment builder</CardTitle>
              <CardDescription>
                Create the payment payload that the Gnosis app will execute.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="recipient">Recipient address</Label>
                <Input
                  id="recipient"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount (CRC)</Label>
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
                <Label htmlFor="note">Description (sent as data)</Label>
                <Input
                  id="note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="e.g. membership, ticket, invoice"
                />
              </div>

              <div className="rounded-2xl border border-ink/10 bg-sand/70 p-4 text-xs text-ink/70">
                <div className="flex items-center justify-between">
                  <span>Data</span>
                  <span className="font-mono">{dataPreview}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  className="w-full"
                  asChild
                  disabled={!paymentLink}
                >
                  <a href={paymentLink} target="_blank" rel="noreferrer">
                    Open in Gnosis app
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={handleCopy}
                  disabled={!paymentLink}
                >
                  <Clipboard className="h-4 w-4" />
                  {copyState === "copied"
                    ? "Copied"
                    : copyState === "error"
                    ? "Copy failed"
                    : "Copy link"}
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => setShowQr((prev) => !prev)}
                  disabled={!paymentLink || qrState === "loading"}
                >
                  <QrCode className="h-4 w-4" />
                  {qrState === "loading"
                    ? "Generating QR"
                    : showQr
                    ? "Hide QR"
                    : "Show QR"}
                </Button>
              </div>

              {showQr && (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-ink/10 bg-white/70 p-4 text-xs text-ink/70">
                  {qrState === "ready" && qrCode ? (
                    <Image
                      src={qrCode}
                      alt="Payment link QR code"
                      width={220}
                      height={220}
                      className="h-[220px] w-[220px] rounded-xl border border-ink/10 bg-white p-2"
                      unoptimized
                    />
                  ) : qrState === "error" ? (
                    <p>Unable to generate QR code for this link.</p>
                  ) : (
                    <p>Generating QR code…</p>
                  )}
                  <span>Scan to open the payment link in a wallet.</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Payment tracking</CardTitle>
              <CardDescription>
                Monitor Circles RPC transfer events that match the data + recipient.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between space-y-6">
              <PaymentStatus status={status} payment={payment} error={error} />

              <div className="space-y-4 rounded-2xl border border-ink/10 bg-white/60 p-4 text-xs text-ink/60">
                <div className="flex items-center justify-between">
                  <span>Tracking</span>
                  <span className="font-mono">data + recipient</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>RPC endpoint</span>
                  <span className="font-mono">{circlesConfig.rpcUrl.replace("https://", "")}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Button
                  variant={watching ? "outline" : "default"}
                  onClick={() => setWatching((prev) => !prev)}
                  disabled={!paymentLink}
                >
                  {watching ? "Stop monitoring" : "Start monitoring"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
