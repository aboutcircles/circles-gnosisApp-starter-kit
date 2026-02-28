import Link from "next/link";
import { ArrowLeft, Link2, QrCode, Radar, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Behind the Scenes | Circles × Gnosis App Starter Kit",
  description: "A technical walkthrough of the Circles Gnosis App starter kit."
};

export default function BehindTheScenesPage() {
  return (
    <main className="px-4 py-10 md:py-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="space-y-6">
          <nav
            aria-label="Behind the scenes menu"
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm shadow-[0_10px_28px_-24px_rgba(15,23,42,0.35)] backdrop-blur"
          >
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/"
                className="inline-flex items-center gap-2 font-semibold text-ink transition hover:text-ink/70"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to the builder
              </Link>
              <span className="hidden h-4 w-px bg-ink/10 sm:block" aria-hidden />
              <span className="text-xs uppercase tracking-[0.35em] text-ink/50">
                Technical overview
              </span>
            </div>
          </nav>
          <div className="space-y-3">
            <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              What is happening behind the scenes
            </h1>
            <p className="max-w-2xl text-sm text-ink/70">
              This page maps the UI you see to the exact client-side steps and RPC calls powering
              the starter kit. Everything happens in the browser: we generate a Gnosis app deep
              link, render a QR code, and poll Circles transfer events until we spot a matching
              payment.
            </p>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <Card id="build-link">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-marine" />
                  1. Build the payment link
                </CardTitle>
              </div>
              <CardDescription>
                The builder turns form input into a Gnosis app transfer URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-ink/70">
              <p>
                `generatePaymentLink` (in `src/lib/circles.ts`) URL-encodes the data field and
                outputs a deep link that the Gnosis app understands.
              </p>
              <div className="rounded-2xl border border-ink/10 bg-white/70 p-4 text-xs text-ink/70">
                <p className="font-semibold text-ink">Format</p>
                <p className="mt-1 font-mono">
                  https://app.gnosis.io/transfer/&lt;recipient&gt;/crc?data=&lt;data&gt;&amp;amount=&lt;amount&gt;
                </p>
              </div>
            </CardContent>
          </Card>

          <Card id="render-qr">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-marine" />
                2. Render a QR code
              </CardTitle>
              <CardDescription>
                The QR code is generated client-side for easy scanning.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-ink/70">
              <p>
                The home page dynamically imports `qrcode` and calls `toDataURL` to turn the link
                into a base64 image. No server or build-time asset is required.
              </p>
            </CardContent>
          </Card>

          <Card id="poll-rpc">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Radar className="h-5 w-5 text-marine" />
                3. Poll Circles RPC
              </CardTitle>
              <CardDescription>
                We watch Circles transfer events until a matching payment appears.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-ink/70">
              <p>
                `usePaymentWatcher` (in `src/hooks/use-payment-watcher.ts`) polls every 5 seconds
                by default. It calls `checkPaymentReceived`, which issues a JSON-RPC request to the
                Circles endpoint.
              </p>
              <p>
                The app calls `circles_events` for the `CrcV2_TransferData` event and searches the
                most recent entries for matches.
              </p>
            </CardContent>
          </Card>

          <Card id="match-payment">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-marine" />
                4. Match + display the payment
              </CardTitle>
              <CardDescription>
                We verify recipient + data, then surface the transaction details.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-ink/70">
              <p>
                TransferData events do not include amounts, so the matching logic focuses on the
                recipient address and the data payload. It normalizes `0x`/`\\x` hex strings and
                UTF-8 text to avoid mismatches.
              </p>
              <p>
                Once a match is found, `PaymentStatus` shows the transaction hash, sender, and
                decoded data.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
