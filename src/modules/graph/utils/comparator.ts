/**
 * Deterministic, locale-independent lexicographical comparator.
 * Guarantees byte-level code unit comparison independent of system locale.
 */
export function compareStringDeterministic(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
