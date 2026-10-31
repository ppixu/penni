import type { Kumppani, UusiKumppani } from '@penni/engine';

/**
 * Wire -> rich: coerce id to number (wire may send a string), preserve all other keys.
 * Kun wire ei sisällä id:tä (uusi kumppani), id jätetään pois — jotta saveKumppanin
 * `k.id ?? nextId++` osaa antaa uuden tunnisteen (sama kuvio kuin decodeTositessa).
 */
export function decodeKumppani(w: Record<string, unknown>): Kumppani {
  const { id: _wireId, ...rest } = w;
  const k = {
    ...rest,
    nimi: typeof w.nimi === 'string' ? w.nimi : String(w.nimi ?? ''),
  } as Kumppani;
  if (w.id != null) k.id = typeof w.id === 'number' ? w.id : Number(w.id);
  return k;
}

/** Rich -> wire: identity (already wire-shaped). */
export function encodeKumppani(k: Kumppani | UusiKumppani): Record<string, unknown> {
  return { ...k };
}
