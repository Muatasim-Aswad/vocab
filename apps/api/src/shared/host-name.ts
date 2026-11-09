/** Normalizes a Host header or configured host: lowercase, without port; IPv6 keeps brackets. */
export function hostName(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  // A bare IPv6 address (configuration only; Host headers bracket it)
  if (value.split(":").length > 2) return `[${value}]`;
  return value.split(":")[0] ?? "";
}
