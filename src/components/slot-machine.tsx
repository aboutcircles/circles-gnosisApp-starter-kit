"use client";

import { useCallback, useEffect, useState, useRef } from "react";

import { Button } from "@/components/ui/button";
import { SlotReel, SYMBOLS } from "./slot-reel";
import { SpinResult, evaluateWin, type WinType } from "./spin-result";
import { PaymentGate } from "./payment-gate";

type GameState = "idle" | "ready" | "spinning" | "result" | "game_over";

export function SlotMachine() {
  const [gameState, setGameState] = useState<GameState>("idle");
  const [spinsRemaining, setSpinsRemaining] = useState(0);
  const [totalSpins, setTotalSpins] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [targets, setTargets] = useState<[number, number, number]>([0, 0, 0]);
  const [lastResult, setLastResult] = useState<{ results: [number, number, number]; winType: WinType; bonusSpins: number } | null>(null);
  const stoppedCount = useRef(0);

  const handlePaymentConfirmed = useCallback(() => {
    setSpinsRemaining(5);
    setTotalSpins(0);
    setLastResult(null);
    setGameState("ready");
  }, []);

  const handleSpin = useCallback(() => {
    if (spinsRemaining <= 0) return;

    // Pick random targets
    const t: [number, number, number] = [
      Math.floor(Math.random() * SYMBOLS.length),
      Math.floor(Math.random() * SYMBOLS.length),
      Math.floor(Math.random() * SYMBOLS.length)
    ];
    setTargets(t);
    setLastResult(null);
    stoppedCount.current = 0;
    setSpinning(true);
    setGameState("spinning");
  }, [spinsRemaining]);

  const handleReelStopped = useCallback(() => {
    stoppedCount.current += 1;
    if (stoppedCount.current < 3) return;

    // All 3 reels have stopped
    setSpinning(false);

    const { winType, bonusSpins } = evaluateWin(targets);
    const newRemaining = spinsRemaining - 1 + bonusSpins;

    setLastResult({ results: targets, winType, bonusSpins });
    setSpinsRemaining(newRemaining);
    setTotalSpins((p) => p + 1);

    if (newRemaining <= 0) {
      setGameState("game_over");
    } else {
      setGameState("result");
    }
  }, [targets, spinsRemaining]);

  const handlePlayAgain = useCallback(() => {
    setGameState("idle");
    setSpinsRemaining(0);
    setTotalSpins(0);
    setLastResult(null);
  }, []);

  const handleNextSpin = useCallback(() => {
    setLastResult(null);
    setGameState("ready");
  }, []);

  // Auto-spin on losing results after a brief pause
  const autoSpinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending auto-spin timer
    if (autoSpinTimer.current) {
      clearTimeout(autoSpinTimer.current);
      autoSpinTimer.current = null;
    }

    // Only auto-spin on "no match" results with spins remaining
    if (gameState === "result" && lastResult?.winType === "none" && spinsRemaining > 0) {
      autoSpinTimer.current = setTimeout(() => {
        setLastResult(null);
        // Trigger spin directly (same logic as handleSpin)
        const t: [number, number, number] = [
          Math.floor(Math.random() * SYMBOLS.length),
          Math.floor(Math.random() * SYMBOLS.length),
          Math.floor(Math.random() * SYMBOLS.length)
        ];
        setTargets(t);
        stoppedCount.current = 0;
        setSpinning(true);
        setGameState("spinning");
      }, 1200);
    }

    return () => {
      if (autoSpinTimer.current) {
        clearTimeout(autoSpinTimer.current);
        autoSpinTimer.current = null;
      }
    };
  }, [gameState, lastResult, spinsRemaining]);

  // --- idle: show payment gate ---
  if (gameState === "idle") {
    return (
      <div className="flex flex-col items-center gap-8">
        <ReelDisplay targets={[0, 1, 2]} spinning={false} onReelStopped={() => {}} />
        <PaymentGate onPaymentConfirmed={handlePaymentConfirmed} />
        <Disclaimer />
      </div>
    );
  }

  // --- all other states: show game ---
  return (
    <div className="flex flex-col items-center gap-6">
      {/* Header info */}
      <div className="text-center">
        <p className="text-2xl font-display font-bold text-white">🎰 CRC Slot Machine</p>
        <div className="mt-2 flex items-center justify-center gap-4">
          <span className="rounded-full bg-purple-500/20 border border-purple-400/30 px-3 py-1 text-xs font-semibold text-purple-300">
            Spins left: {spinsRemaining}
          </span>
          {totalSpins > 0 && (
            <span className="text-xs text-white/40">
              Spin #{totalSpins}
            </span>
          )}
        </div>
      </div>

      {/* Reels */}
      <ReelDisplay
        targets={targets}
        spinning={spinning}
        onReelStopped={handleReelStopped}
      />

      {/* Result */}
      {lastResult && (
        <SpinResult
          results={lastResult.results}
          winType={lastResult.winType}
          bonusSpins={lastResult.bonusSpins}
        />
      )}

      {/* Actions */}
      <div className="flex flex-col items-center gap-3">
        {gameState === "ready" && (
          <Button
            size="lg"
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-[0_0_30px_rgba(168,85,247,0.5)] min-w-[200px]"
            onClick={handleSpin}
          >
            🎰 Spin!
          </Button>
        )}

        {gameState === "spinning" && (
          <div className="flex items-center gap-2 text-sm text-white/40">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
            Spinning…
          </div>
        )}

        {gameState === "result" && lastResult?.winType === "none" && (
          <div className="flex items-center gap-2 text-sm text-white/40">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
            Auto-spinning… ({spinsRemaining} left)
          </div>
        )}

        {gameState === "result" && lastResult?.winType !== "none" && (
          <Button
            size="lg"
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-[0_0_30px_rgba(168,85,247,0.5)] min-w-[200px]"
            onClick={handleNextSpin}
          >
            🎰 Spin Again ({spinsRemaining} left)
          </Button>
        )}

        {gameState === "game_over" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-white/50">No spins remaining</p>
            <Button
              size="lg"
              className="bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_24px_rgba(168,85,247,0.4)]"
              onClick={handlePlayAgain}
            >
              🔄 Play Again (10 CRC)
            </Button>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <Disclaimer />
    </div>
  );
}

// --- Reel display sub-component ---

function ReelDisplay({
  targets,
  spinning,
  onReelStopped
}: {
  targets: [number, number, number];
  spinning: boolean;
  onReelStopped: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <SlotReel spinning={spinning} targetIndex={targets[0]} stopDelay={800} onStopped={onReelStopped} />
      <SlotReel spinning={spinning} targetIndex={targets[1]} stopDelay={1200} onStopped={onReelStopped} />
      <SlotReel spinning={spinning} targetIndex={targets[2]} stopDelay={1600} onStopped={onReelStopped} />
    </div>
  );
}

// --- Disclaimer sub-component ---

function Disclaimer() {
  return (
    <p className="mt-1 text-[11px] text-white/25 text-center max-w-[260px] leading-relaxed px-4">
      For entertainment only — no real CRC can be won. Wins award bonus spins only.
    </p>
  );
}
