import type { BudjettiRivi, Kohdennus, KohdennusKaytolla, UusiKohdennus } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';

/**
 * Wire -> rich: coerce numeric keys, preserve all other keys (Kitsaksen muut json-avaimet).
 * Kun wire ei sisällä id:tä (uusi kohdennus), id jätetään pois — jotta tallennus antaa uuden
 * tunnisteen (sama kuvio kuin decodeKumppani).
 */
export function decodeKohdennus(w: Record<string, unknown>): Kohdennus {
  const { id: _id, kuuluu: _kuuluu, tyyppi, ...rest } = w;
  const k = { ...rest, tyyppi: Number(tyyppi), nimi: { ...(w.nimi as object) } } as Kohdennus;
  if (w.id != null) k.id = Number(w.id);
  if (w.kuuluu != null && Number(w.kuuluu) !== 0) k.kuuluu = Number(w.kuuluu);
  return k;
}

/** Wire -> rich: kohdennus ja sen käyttömäärä `lkm` (puuttuva = 0). */
export function decodeKohdennusKaytolla(w: Record<string, unknown>): KohdennusKaytolla {
  return { ...decodeKohdennus(w), lkm: w.lkm != null ? Number(w.lkm) : 0 };
}

/** Rich -> wire: identity (already wire-shaped). */
export function encodeKohdennus(k: Kohdennus | UusiKohdennus): Record<string, unknown> {
  return { ...k };
}

/** Budjettirivin sentit kulkevat rahamerkkijonona ("-123.45"). */
export function encodeBudjettiRivi(r: BudjettiRivi): {
  kohdennus: number;
  tili: number;
  sentit: string;
} {
  return { kohdennus: r.kohdennus, tili: r.tili, sentit: centsToWire(r.sentit) };
}

export function decodeBudjettiRivi(w: {
  kohdennus: number | string;
  tili: number | string;
  sentit: string | number;
}): BudjettiRivi {
  return { kohdennus: Number(w.kohdennus), tili: Number(w.tili), sentit: wireToCents(w.sentit) };
}
