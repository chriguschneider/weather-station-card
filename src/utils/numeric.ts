// parseFloat that returns null instead of NaN, so HA states such as
// "unknown" / "unavailable" are gated with one `value == null` check
// rather than propagating NaN into arithmetic and labels.
export function parseNumericSafe(value: unknown): number | null {
  if (value == null) return null;
  const n = parseFloat(value as string);
  return Number.isFinite(n) ? n : null;
}
