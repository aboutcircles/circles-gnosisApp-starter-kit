import { useEffect, useState } from "react";
import { checkPaymentReceived, type CirclesTransferEvent } from "@/lib/circles";

export type PaymentWatchStatus = "idle" | "waiting" | "confirmed" | "error";

interface PaymentWatchOptions {
  enabled: boolean;
  dataValue: string;
  minAmountCRC: number;
  recipientAddress?: string;
  intervalMs?: number;
}

export function usePaymentWatcher({
  enabled,
  dataValue,
  minAmountCRC,
  recipientAddress,
  intervalMs = 5000
}: PaymentWatchOptions) {
  const [status, setStatus] = useState<PaymentWatchStatus>("idle");
  const [payment, setPayment] = useState<CirclesTransferEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPayment(null);
    setError(null);
    if (!enabled || !dataValue || !minAmountCRC) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (cancelled) return;
      setStatus((prev) => (prev === "confirmed" ? prev : "waiting"));

      try {
        const found = await checkPaymentReceived(dataValue, minAmountCRC, recipientAddress);

        if (cancelled) return;

        if (found) {
          setPayment(found);
          setStatus("confirmed");
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Payment check failed");
        setStatus("error");
      }

      if (!cancelled) {
        timeoutId = setTimeout(poll, intervalMs);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [enabled, dataValue, minAmountCRC, recipientAddress, intervalMs]);

  return { status, payment, error };
}
