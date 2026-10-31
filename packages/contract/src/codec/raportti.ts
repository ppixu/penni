import type { RaporttiRivi } from '@penni/engine';
import type { z } from 'zod';
import type { WireRaporttiRiviSchema } from '../schema/wire.js';
import { centsToWire, wireToCents } from '../wire/euro.js';

/** Wire shape of one report row (inferred from the zod schema — no parallel hand-written type). */
export type WireRaporttiRivi = z.infer<typeof WireRaporttiRiviSchema>;

export function encodeRaporttiRivi(r: RaporttiRivi): WireRaporttiRivi {
  return {
    teksti: r.teksti,
    sisennys: r.sisennys,
    lihava: r.lihava,
    arvo: r.arvo === null ? null : centsToWire(r.arvo),
    ...(r.tyhja ? { tyhja: true } : {}),
    ...(r.tili !== undefined ? { tili: r.tili } : {}),
    ...(r.kaavarivi !== undefined ? { kaavarivi: r.kaavarivi } : {}),
    ...(r.kaavaLaji !== undefined ? { kaavaLaji: r.kaavaLaji } : {}),
  };
}

export function decodeRaporttiRivi(w: WireRaporttiRivi): RaporttiRivi {
  return {
    teksti: w.teksti,
    sisennys: w.sisennys,
    lihava: w.lihava,
    arvo: w.arvo === null ? null : wireToCents(w.arvo),
    ...(w.tyhja ? { tyhja: true } : {}),
    ...(w.tili !== undefined ? { tili: w.tili } : {}),
    ...(w.kaavarivi !== undefined ? { kaavarivi: w.kaavarivi } : {}),
    ...(w.kaavaLaji !== undefined ? { kaavaLaji: w.kaavaLaji } : {}),
  };
}
