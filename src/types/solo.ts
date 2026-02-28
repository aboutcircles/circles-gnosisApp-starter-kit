export type SoloMove = "heads" | "tails";

export type SoloRoundStatus = "awaiting_payment" | "resolving" | "completed";

export type SoloPaymentStatus = "pending" | "paid";

export type SoloOutcome = "win" | "lose";

export type SoloPayoutStatus = "pending" | "processing" | "paid" | "failed" | "skipped";

export interface SoloPayment {
  status: SoloPaymentStatus;
  recipientAddress: string;
  paymentLink: string;
  expectedData: string;
  amountCRC: string;
  transactionHash?: string;
  paidAt?: string;
}

export interface SoloResult {
  coin: SoloMove;
  outcome: SoloOutcome;
  resolvedAt: string;
}

export interface SoloPayout {
  status: SoloPayoutStatus;
  fromAddress: string;
  toAddress: string;
  amountCRC: string;
  txHash?: string;
  error?: string;
  processedAt?: string;
  retryCount?: number;
}

export interface SoloRound {
  id: string;
  createdAt: string;
  updatedAt: string;
  playerAddress: string;
  move: SoloMove;
  status: SoloRoundStatus;
  payment: SoloPayment;
  result?: SoloResult;
  payout: SoloPayout;
  processingToken?: string;
}
