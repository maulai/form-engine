/**
 * Structural equality for form values.
 * - Plain objects and arrays by content, dates by time, everything else by `Object.is`.
 * - Keys with `undefined` count as absent (`{ a: undefined }` equals `{}`).
 */
export function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!equal(ra[k], rb[k])) return false;
  return true;
}
