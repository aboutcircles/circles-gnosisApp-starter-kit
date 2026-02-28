export function shortAddress(address: string | undefined): string {
  if (!address) return "-";
  if (address.length < 14) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}
