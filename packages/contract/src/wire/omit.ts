/**
 * Drop the fields the legacy wire codec omits: undefined, null, '' and numeric 0
 * (mirrors the SQLiteRoute::resultList skip of value.toString() in {"", "0"} plus the
 * Tosite/TositeVienti setters). Nested objects/arrays are preserved. Returns a new object.
 * NOTE: `false` is kept — only numeric 0 is dropped.
 */
export function pudotaTyhjat(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '' || v === 0) continue;
    out[k] = v;
  }
  return out;
}
