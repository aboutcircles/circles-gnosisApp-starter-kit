import { hexToString, isHex } from "viem";

export function byteaToString(data?: string | null) {
  if (!data) return null;

  const hex = data.startsWith("\\x")
    ? `0x${data.slice(2)}`
    : data.startsWith("0x")
      ? data
      : null;

  if (!hex || !isHex(hex)) return data;

  try {
    return hexToString(hex);
  } catch {
    return data;
  }
}
