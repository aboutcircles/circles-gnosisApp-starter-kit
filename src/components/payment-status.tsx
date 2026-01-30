import { Badge } from "@/components/ui/badge";
import type { CirclesTransferEvent } from "@/lib/circles";
import type { PaymentWatchStatus } from "@/hooks/use-payment-watcher";
import { byteaToString } from "@/lib/bytea";

const statusLabel: Record<PaymentWatchStatus, { label: string; variant: "neutral" | "waiting" | "success" | "error" }> = {
  idle: { label: "Idle", variant: "neutral" },
  waiting: { label: "Waiting", variant: "waiting" },
  confirmed: { label: "Confirmed", variant: "success" },
  error: { label: "Error", variant: "error" }
};

export function PaymentStatus({
  status,
  payment,
  error
}: {
  status: PaymentWatchStatus;
  payment: CirclesTransferEvent | null;
  error: string | null;
}) {
  const display = statusLabel[status];
  const dataStr = byteaToString(payment?.data);
  const dataPreview = dataStr
    ? dataStr.length > 16
      ? `${dataStr.slice(0, 12)}…`
      : dataStr
    : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Payment status</p>
        <Badge variant={display.variant}>{display.label}</Badge>
      </div>
      {payment ? (
        <div className="space-y-2 text-xs text-ink/70">
          <div className="flex items-center justify-between">
            <span>Transaction</span>
            <span className="font-mono">{payment.transactionHash.slice(0, 12)}…</span>
          </div>
          <div className="flex items-center justify-between">
            <span>From</span>
            <span className="font-mono">{payment.from.slice(0, 10)}…</span>
          </div>
          <div className="flex items-center justify-between">
            <span>To</span>
            <span className="font-mono">{payment.to.slice(0, 10)}…</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Data</span>
            <span className="font-mono">{dataPreview ?? "Unknown"}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink/60">
          {status === "idle"
            ? "Start monitoring after sharing the link with a payer."
            : status === "error"
            ? error || "Payment check failed."
            : "No matching payment yet."}
        </p>
      )}
    </div>
  );
}
