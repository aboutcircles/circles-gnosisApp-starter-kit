import { Sdk } from "@aboutcircles/sdk";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { gnosis } from "viem/chains";

import type { MiniappHostTransaction, MiniappTransaction } from "./types";

interface TransactionRequest {
  to: Address;
  data: Hex;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
  nonce?: number;
}

const DEFAULT_CHAIN_RPC_URL = "https://rpc.aboutcircles.com/";

function toHexValue(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

function toMiniappTransaction(tx: TransactionRequest): MiniappTransaction {
  return {
    to: tx.to,
    data: tx.data,
    value: String(tx.value ?? 0n)
  };
}

function toMiniappHostTransaction(tx: TransactionRequest): MiniappHostTransaction {
  return {
    to: tx.to,
    data: tx.data,
    value: toHexValue(tx.value ?? 0n)
  };
}

export async function buildMiniappCompatiblePayment(params: {
  playerAddress: Address;
  recipientAddress: Address;
  amountAtto: bigint;
  expectedData: string;
}): Promise<{
  transactions: MiniappTransaction[];
  hostTransactions: MiniappHostTransaction[];
}> {
  const chainRpcUrl =
    process.env.CIRCLES_CHAIN_RPC_URL ||
    process.env.CIRCLES_RPC_URL ||
    process.env.NEXT_PUBLIC_CIRCLES_RPC_URL ||
    DEFAULT_CHAIN_RPC_URL;

  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http(chainRpcUrl)
  });

  const collectedTransactions: TransactionRequest[] = [];

  const runner = {
    address: params.playerAddress,
    publicClient,
    async init() {
      return undefined;
    },
    async estimateGas(tx: TransactionRequest): Promise<bigint> {
      return publicClient.estimateGas({
        account: params.playerAddress,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasPrice: tx.gasPrice,
        nonce: tx.nonce
      });
    },
    async call(tx: TransactionRequest): Promise<string> {
      const result = await publicClient.call({
        account: params.playerAddress,
        to: tx.to,
        data: tx.data,
        value: tx.value
      });

      return result.data ?? "0x";
    },
    async resolveName() {
      return null;
    },
    async sendTransaction(txs: TransactionRequest[]) {
      collectedTransactions.push(...txs);
      return {
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000000"
      };
    }
  };

  const sdk = new Sdk(undefined, runner);
  const avatar = await sdk.getAvatar(params.playerAddress);

  await avatar.transfer.advanced(params.recipientAddress, params.amountAtto, {
    useWrappedBalances: true,
    txData: new TextEncoder().encode(params.expectedData)
  });

  if (!collectedTransactions.length) {
    throw new Error("Could not construct a payment transaction from transfer path.");
  }

  return {
    transactions: collectedTransactions.map(toMiniappTransaction),
    hostTransactions: collectedTransactions.map(toMiniappHostTransaction)
  };
}
