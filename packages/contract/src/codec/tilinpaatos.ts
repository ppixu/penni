import type { TilinpaatosDoc, TilinpaatosMuoto } from '@penni/engine';
import type { z } from 'zod';
import type {
  WireLiitetiedotSyoteSchema,
  WireTilinpaatosDocSchema,
  WireVahvistusSyoteSchema,
} from '../schema/wire.js';
import { decodeRaporttiRivi, encodeRaporttiRivi } from './raportti.js';

export type WireTilinpaatosDoc = z.infer<typeof WireTilinpaatosDocSchema>;
export type WireLiitetiedotSyote = z.infer<typeof WireLiitetiedotSyoteSchema>;
export type WireVahvistusSyote = z.infer<typeof WireVahvistusSyoteSchema>;

export function encodeTilinpaatosDoc(d: TilinpaatosDoc): WireTilinpaatosDoc {
  return {
    tilikausi: d.tilikausi,
    muoto: d.muoto,
    tuloslaskelma: d.tuloslaskelma.map(encodeRaporttiRivi),
    tase: d.tase.map(encodeRaporttiRivi),
    liitetiedot: d.liitetiedot,
    vahvistettu: d.vahvistettu,
  };
}

export function decodeTilinpaatosDoc(w: WireTilinpaatosDoc): TilinpaatosDoc {
  return {
    tilikausi: { alkaa: String(w.tilikausi.alkaa), loppuu: String(w.tilikausi.loppuu) },
    muoto: w.muoto as TilinpaatosMuoto,
    tuloslaskelma: w.tuloslaskelma.map(decodeRaporttiRivi),
    tase: w.tase.map(decodeRaporttiRivi),
    liitetiedot: String(w.liitetiedot),
    vahvistettu: w.vahvistettu == null ? null : String(w.vahvistettu),
  };
}

export function encodeLiitetiedotSyote(s: {
  loppupvm: string;
  teksti: string;
}): WireLiitetiedotSyote {
  return { loppupvm: s.loppupvm, teksti: s.teksti };
}
export function decodeLiitetiedotSyote(w: WireLiitetiedotSyote): {
  loppupvm: string;
  teksti: string;
} {
  return { loppupvm: String(w.loppupvm), teksti: String(w.teksti) };
}
export function encodeVahvistusSyote(s: { alkaa: string }): WireVahvistusSyote {
  return { alkaa: s.alkaa };
}
export function decodeVahvistusSyote(w: WireVahvistusSyote): { alkaa: string } {
  return { alkaa: String(w.alkaa) };
}
