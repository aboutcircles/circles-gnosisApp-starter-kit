import { keccak256, stringToBytes } from "viem";

export function keccakHex(input: string): string {
  return keccak256(stringToBytes(input));
}
