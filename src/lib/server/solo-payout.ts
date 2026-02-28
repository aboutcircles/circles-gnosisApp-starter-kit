import { Sdk } from "@aboutcircles/sdk";
import { CirclesRpc } from "@aboutcircles/sdk-rpc";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  zeroAddress
} from "viem";
import { gnosis } from "viem/chains";

import type { SoloPayout } from "@/types/solo";

const DEFAULT_CHAIN_RPC_URL = "https://rpc.aboutcircles.com/";
const DEFAULT_ENTRY_FEE_CRC = "1";
const DEFAULT_WIN_PAYOUT_CRC = "2";
const AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,18})?$/;

interface TransactionRequest {
  to: Address;
  data: Hex;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
  nonce?: number;
}

interface ContractRunner {
  address?: Address;
  publicClient: PublicClient;
  init(): Promise<void>;
  estimateGas(tx: TransactionRequest): Promise<bigint>;
  call(tx: TransactionRequest): Promise<string>;
  resolveName(name: string): Promise<string | null>;
  sendTransaction(txs: TransactionRequest[]): Promise<TransactionReceipt>;
}

const SAFE_ABI = [
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "getTransactionHash",
    stateMutability: "view",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "_nonce", type: "uint256" }
    ],
    outputs: [{ type: "bytes32" }]
  },
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" }
    ],
    outputs: [{ name: "success", type: "bool" }]
  }
] as const;

function normalizePrivateKey(rawKey: string): Hex {
  const candidate = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(candidate)) {
    throw new Error("CIRCLES_ORG_PRIVATE_KEY must be a 32-byte hex string");
  }

  return candidate as Hex;
}

function parseAmountToAtto(amountCRC: string): bigint {
  if (!AMOUNT_PATTERN.test(amountCRC)) {
    throw new Error("Amount must be a decimal string with up to 18 decimals");
  }

  const amountAtto = parseUnits(amountCRC, 18);
  if (amountAtto <= 0n) {
    throw new Error("Amount must be greater than 0");
  }

  return amountAtto;
}

function formatAmountFromAtto(valueAtto: bigint): string {
  const amount = formatUnits(valueAtto, 18);
  const [whole, fraction = ""] = amount.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function createEoaContractRunner(
  privateKey: Hex,
  rpcUrl: string,
  executeFromAddress?: Address
): ContractRunner {
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http(rpcUrl)
  });

  const walletClient = createWalletClient({
    account,
    chain: gnosis,
    transport: http(rpcUrl)
  });
  const safeAddress =
    executeFromAddress && executeFromAddress.toLowerCase() !== account.address.toLowerCase()
      ? executeFromAddress
      : undefined;

  return {
    address: account.address,
    publicClient,
    init: async () => undefined,
    estimateGas: async (tx) => {
      return publicClient.estimateGas({
        account,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gasPrice: tx.gasPrice,
        nonce: tx.nonce
      });
    },
    call: async (tx) => {
      const result = await publicClient.call({
        account,
        to: tx.to,
        data: tx.data,
        value: tx.value
      });
      return result.data ?? "0x";
    },
    resolveName: async () => null,
    sendTransaction: async (txs) => {
      if (!txs.length) {
        throw new Error("No transaction payload provided");
      }

      let lastReceipt: TransactionReceipt | null = null;

      for (const tx of txs) {
        let hash: Hex;

        if (safeAddress) {
          const nonce = await publicClient.readContract({
            address: safeAddress,
            abi: SAFE_ABI,
            functionName: "nonce"
          });
          const safeTxGas = tx.gas ?? 0n;
          const safeHash = await publicClient.readContract({
            address: safeAddress,
            abi: SAFE_ABI,
            functionName: "getTransactionHash",
            args: [
              tx.to,
              tx.value ?? 0n,
              tx.data,
              0,
              safeTxGas,
              0n,
              0n,
              zeroAddress,
              zeroAddress,
              nonce
            ]
          });

          const sig = await account.sign({ hash: safeHash });
          const vByte = Number.parseInt(sig.slice(-2), 16);
          const normalizedV = vByte >= 27 ? vByte : vByte + 27;
          const normalizedSignature = `${sig.slice(0, -2)}${normalizedV.toString(16).padStart(2, "0")}` as Hex;

          const safeExecData = encodeFunctionData({
            abi: SAFE_ABI,
            functionName: "execTransaction",
            args: [
              tx.to,
              tx.value ?? 0n,
              tx.data,
              0,
              safeTxGas,
              0n,
              0n,
              zeroAddress,
              zeroAddress,
              normalizedSignature
            ]
          });

          const simulation = await publicClient.call({
            account,
            to: safeAddress,
            data: safeExecData,
            value: 0n
          });
          const simulationSuccess = decodeFunctionResult({
            abi: SAFE_ABI,
            functionName: "execTransaction",
            data: simulation.data ?? "0x"
          });
          if (!simulationSuccess) {
            throw new Error("Safe exec simulation failed for payout transaction");
          }

          hash = await walletClient.sendTransaction({
            account,
            to: safeAddress,
            data: safeExecData,
            value: 0n
          });
        } else {
          hash = await walletClient.sendTransaction({
            account,
            to: tx.to,
            data: tx.data,
            value: tx.value ?? 0n,
            gas: tx.gas,
            gasPrice: tx.gasPrice,
            nonce: tx.nonce
          });
        }

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status !== "success") {
          throw new Error(`Payout transaction reverted: ${hash}`);
        }

        lastReceipt = receipt;
      }

      if (!lastReceipt) {
        throw new Error("No receipt returned from payout transaction");
      }

      return lastReceipt;
    }
  };
}

export function getSoloEconomics() {
  const orgAvatarAddress = process.env.CIRCLES_ORG_AVATAR_ADDRESS || "";

  return {
    entryFeeCRC: process.env.SOLO_ENTRY_FEE_CRC || DEFAULT_ENTRY_FEE_CRC,
    winnerPayoutCRC: process.env.SOLO_WIN_PAYOUT_CRC || DEFAULT_WIN_PAYOUT_CRC,
    entryRecipientAddress: orgAvatarAddress
  };
}

export function getSoloPayoutConfiguration() {
  const orgAvatarAddress = process.env.CIRCLES_ORG_AVATAR_ADDRESS;
  const privateKey = process.env.CIRCLES_ORG_PRIVATE_KEY;

  return {
    orgAvatarAddress,
    isConfigured: Boolean(orgAvatarAddress && privateKey)
  };
}

export async function getSoloOrgBalanceCRC(): Promise<string | null> {
  const orgAvatarAddress = process.env.CIRCLES_ORG_AVATAR_ADDRESS?.trim();
  if (!orgAvatarAddress || !isAddress(orgAvatarAddress)) {
    return null;
  }

  const circlesRpcUrl =
    process.env.CIRCLES_RPC_URL ||
    process.env.NEXT_PUBLIC_CIRCLES_RPC_URL ||
    DEFAULT_CHAIN_RPC_URL;

  try {
    const rpc = new CirclesRpc(circlesRpcUrl);
    const totalAtto = await rpc.balance.getTotalBalance(orgAvatarAddress as Address);
    return formatAmountFromAtto(totalAtto);
  } catch {
    return null;
  }
}

export async function getSoloOrgName(): Promise<string | null> {
  const orgAvatarAddress = process.env.CIRCLES_ORG_AVATAR_ADDRESS?.trim();
  if (!orgAvatarAddress || !isAddress(orgAvatarAddress)) {
    return null;
  }

  const circlesRpcUrl =
    process.env.CIRCLES_RPC_URL ||
    process.env.NEXT_PUBLIC_CIRCLES_RPC_URL ||
    DEFAULT_CHAIN_RPC_URL;

  try {
    const rpc = new CirclesRpc(circlesRpcUrl);
    const profile = await rpc.profile.getProfileByAddress(orgAvatarAddress as Address);
    const name = String(profile?.name ?? "").trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function payoutSoloWinner(params: {
  roundId: string;
  winnerAddress: string;
  amountCRC: string;
}): Promise<SoloPayout> {
  const nowIso = new Date().toISOString();
  const orgAvatarAddress = process.env.CIRCLES_ORG_AVATAR_ADDRESS;
  const privateKeyRaw = process.env.CIRCLES_ORG_PRIVATE_KEY;
  const chainRpcUrl =
    process.env.CIRCLES_CHAIN_RPC_URL ||
    process.env.CIRCLES_RPC_URL ||
    process.env.NEXT_PUBLIC_CIRCLES_RPC_URL ||
    DEFAULT_CHAIN_RPC_URL;

  if (!orgAvatarAddress || !privateKeyRaw) {
    return {
      status: "skipped",
      fromAddress: orgAvatarAddress ?? "not-configured",
      toAddress: params.winnerAddress,
      amountCRC: params.amountCRC,
      error: "Missing CIRCLES_ORG_AVATAR_ADDRESS or CIRCLES_ORG_PRIVATE_KEY",
      processedAt: nowIso
    };
  }

  if (!isAddress(orgAvatarAddress)) {
    return {
      status: "failed",
      fromAddress: orgAvatarAddress,
      toAddress: params.winnerAddress,
      amountCRC: params.amountCRC,
      error: "CIRCLES_ORG_AVATAR_ADDRESS is invalid",
      processedAt: nowIso
    };
  }

  if (!isAddress(params.winnerAddress)) {
    return {
      status: "failed",
      fromAddress: orgAvatarAddress,
      toAddress: params.winnerAddress,
      amountCRC: params.amountCRC,
      error: "Winner address is invalid",
      processedAt: nowIso
    };
  }

  try {
    const privateKey = normalizePrivateKey(privateKeyRaw);
    const runner = createEoaContractRunner(privateKey, chainRpcUrl, orgAvatarAddress as Address);
    await runner.init();

    const sdk = new Sdk(undefined, runner);
    const orgAvatar = await sdk.getAvatar(orgAvatarAddress as Address);
    const payoutAmountAtto = parseAmountToAtto(params.amountCRC);

    const txData = new TextEncoder().encode(`solo:${params.roundId}:winner`);
    const receipt = await orgAvatar.transfer.advanced(
      params.winnerAddress as Address,
      payoutAmountAtto,
      {
        useWrappedBalances: true,
        txData
      }
    );

    const txHash =
      (receipt as { transactionHash?: string; hash?: string }).transactionHash ||
      (receipt as { hash?: string }).hash;

    return {
      status: "paid",
      fromAddress: orgAvatarAddress,
      toAddress: params.winnerAddress,
      amountCRC: params.amountCRC,
      txHash,
      processedAt: nowIso
    };
  } catch (error) {
    return {
      status: "failed",
      fromAddress: orgAvatarAddress,
      toAddress: params.winnerAddress,
      amountCRC: params.amountCRC,
      error: error instanceof Error ? error.message : "Unknown payout failure",
      processedAt: nowIso
    };
  }
}
