import { type TositeRivi, normalisoiMerkkaukset } from '@penni/engine';

/** The wire shape of an invoice row (engine subset; numbers stay raw per tositerivi.h). */
export interface WireRivi {
  myyntikpl: number;
  ahinta: number;
  alvkoodi?: number;
  alvprosentti?: number;
  aleprosentti?: number;
  euroalennus?: number;
  unkoodi?: string;
  selite?: string;
  tili?: number;
  kohdennus?: number;
  /** Merkkaus-id:t nousevana ja uniikkeina; tyhjä lista jätetään pois. */
  merkkaukset?: number[];
  [key: string]: unknown;
}

export function encodeRivi(r: TositeRivi): WireRivi {
  const w: WireRivi = { myyntikpl: r.myyntiKpl, ahinta: r.aNetto };
  if (r.alvKoodi !== 0) w.alvkoodi = r.alvKoodi;
  if (r.alvProsentti !== 0) w.alvprosentti = r.alvProsentti;
  if (r.aleProsentti) w.aleprosentti = r.aleProsentti;
  if (r.euroAlennus) w.euroalennus = r.euroAlennus;
  if (r.unKoodi) w.unkoodi = r.unKoodi;
  if (r.selite) w.selite = r.selite;
  if (r.tili !== undefined) w.tili = r.tili;
  if (r.kohdennus !== undefined) w.kohdennus = r.kohdennus;
  if (r.merkkaukset?.length) w.merkkaukset = [...r.merkkaukset];
  return w;
}

export function decodeRivi(w: WireRivi): TositeRivi {
  const r: TositeRivi = {
    myyntiKpl: Number(w.myyntikpl),
    aNetto: Number(w.ahinta),
    alvKoodi: w.alvkoodi != null ? Number(w.alvkoodi) : 0,
    alvProsentti: w.alvprosentti != null ? Number(w.alvprosentti) : 0,
  };
  if (w.aleprosentti != null && Number(w.aleprosentti) !== 0)
    r.aleProsentti = Number(w.aleprosentti);
  if (w.euroalennus != null && Number(w.euroalennus) !== 0) r.euroAlennus = Number(w.euroalennus);
  if (w.unkoodi) r.unKoodi = String(w.unkoodi);
  if (w.selite) r.selite = String(w.selite);
  if (w.tili != null) r.tili = Number(w.tili);
  if (w.kohdennus != null) r.kohdennus = Number(w.kohdennus);
  const merkkaukset = Array.isArray(w.merkkaukset)
    ? normalisoiMerkkaukset(w.merkkaukset.map(Number))
    : undefined;
  if (merkkaukset) r.merkkaukset = merkkaukset;
  return r;
}
