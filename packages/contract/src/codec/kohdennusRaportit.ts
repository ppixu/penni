import type { BudjettivertailuRivi, KohdennusOsio } from '@penni/engine';
import type { z } from 'zod';
import type { WireBudjettivertailuRiviSchema, WireKohdennusOsioSchema } from '../schema/wire.js';
import { centsToWire, wireToCents } from '../wire/euro.js';
import { decodeRaporttiRivi, encodeRaporttiRivi } from './raportti.js';

export type WireKohdennusOsio = z.infer<typeof WireKohdennusOsioSchema>;
export type WireBudjettivertailuRivi = z.infer<typeof WireBudjettivertailuRiviSchema>;

export function encodeKohdennusOsio(o: KohdennusOsio): WireKohdennusOsio {
  return { kohdennus: { ...o.kohdennus }, rivit: o.rivit.map(encodeRaporttiRivi) };
}

export function decodeKohdennusOsio(w: WireKohdennusOsio): KohdennusOsio {
  const { id, nimi, polku, tuntematon } = w.kohdennus;
  return {
    kohdennus: { id, nimi, polku, ...(tuntematon ? { tuntematon } : {}) },
    rivit: w.rivit.map(decodeRaporttiRivi),
  };
}

export function encodeBudjettivertailuRivi(r: BudjettivertailuRivi): WireBudjettivertailuRivi {
  const raha = (c: BudjettivertailuRivi['budjetti']) => (c === null ? null : centsToWire(c));
  return {
    teksti: r.teksti,
    sisennys: r.sisennys,
    lihava: r.lihava,
    ...(r.tyhja ? { tyhja: true } : {}),
    ...(r.tili !== undefined ? { tili: r.tili } : {}),
    ...(r.kaavarivi !== undefined ? { kaavarivi: r.kaavarivi } : {}),
    budjetti: raha(r.budjetti),
    toteutunut: raha(r.toteutunut),
    ero: raha(r.ero),
    ...(r.prosentti !== undefined ? { prosentti: r.prosentti } : {}),
  };
}

export function decodeBudjettivertailuRivi(w: WireBudjettivertailuRivi): BudjettivertailuRivi {
  const sentit = (v: string | null) => (v === null ? null : wireToCents(v));
  return {
    teksti: w.teksti,
    sisennys: w.sisennys,
    lihava: w.lihava,
    ...(w.tyhja ? { tyhja: true } : {}),
    ...(w.tili !== undefined ? { tili: w.tili } : {}),
    ...(w.kaavarivi !== undefined ? { kaavarivi: w.kaavarivi } : {}),
    budjetti: sentit(w.budjetti),
    toteutunut: sentit(w.toteutunut),
    ero: sentit(w.ero),
    ...(w.prosentti !== undefined ? { prosentti: w.prosentti } : {}),
  };
}
