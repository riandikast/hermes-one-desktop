/** Exact dotted-quad RFC1918 hosts; never WHATWG's shortened/numeric IPv4 coercion. */
export function isPrivateWebHost(host: string): boolean {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host))
    return false;
  const parts = host.split(".").map(Number);
  if (parts.some((part) => part > 255)) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}
