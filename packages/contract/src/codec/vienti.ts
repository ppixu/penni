import { type TositeVienti, normalisoiMerkkaukset } from '@penni/engine';
import { centsToWire, prosenttiToWire, wireToCents } from '../wire/euro.js';

/** The wire shape of a ledger entry (subset of legacy keys we round-trip in Tier-0). */
export interface WireVienti {
  tili: number;
  pvm: string;
  debet?: string;
  kredit?: string;
  alvkoodi?: number;
  alvprosentti?: string;
  kohdennus?: number;
  /** Merkkaus-id:t nousevana ja uniikkeina; tyhjä lista jätetään pois. */
  merkkaukset?: number[];
  era?: { id: number };
  selite?: string;
  tyyppi?: number;
  jaksoalkaa?: string;
  jaksoloppuu?: string;
  jaksotustili?: number;
  maksuperusteinenTosite?: number;
  /** Kitsaksen tapaan olio; decode hyväksyy myös pelkän numeron. */
  kumppani?: { id: number } | number;
  arkistotunnus?: string;
  viite?: string;
  tasaerapoisto?: number;
  // Unknown extra keys may be present on the wire; ignored on decode in Tier-0.
  [key: string]: unknown;
}

export function encodeVienti(v: TositeVienti): WireVienti {
  const w: WireVienti = { tili: v.tili, pvm: v.pvm };
  if (v.debet !== 0) w.debet = centsToWire(v.debet);
  if (v.kredit !== 0) w.kredit = centsToWire(v.kredit);
  if (v.alvKoodi !== 0) w.alvkoodi = v.alvKoodi;
  if (v.alvProsentti !== 0) w.alvprosentti = prosenttiToWire(v.alvProsentti);
  if (v.kohdennus) w.kohdennus = v.kohdennus;
  if (v.merkkaukset?.length) w.merkkaukset = [...v.merkkaukset];
  if (v.era) w.era = { id: v.era };
  if (v.selite) w.selite = v.selite;
  if (v.tyyppi) w.tyyppi = v.tyyppi;
  if (v.jaksoalkaa) w.jaksoalkaa = v.jaksoalkaa;
  if (v.jaksoloppuu) w.jaksoloppuu = v.jaksoloppuu;
  if (v.jaksotustili) w.jaksotustili = v.jaksotustili;
  if (v.maksuperusteinenTosite) w.maksuperusteinenTosite = v.maksuperusteinenTosite;
  if (v.kumppani) w.kumppani = { id: v.kumppani };
  if (v.arkistotunnus) w.arkistotunnus = v.arkistotunnus;
  if (v.viite) w.viite = v.viite;
  if (v.tasaerapoisto) w.tasaerapoisto = v.tasaerapoisto;
  return w;
}

export function decodeVienti(w: WireVienti): TositeVienti {
  const v: TositeVienti = {
    tili: Number(w.tili),
    debet: wireToCents(w.debet),
    kredit: wireToCents(w.kredit),
    pvm: String(w.pvm),
    alvKoodi: w.alvkoodi != null ? Number(w.alvkoodi) : 0,
    alvProsentti: w.alvprosentti != null ? Number(w.alvprosentti) : 0,
  };
  if (w.kohdennus != null && Number(w.kohdennus) !== 0) v.kohdennus = Number(w.kohdennus);
  const merkkaukset = Array.isArray(w.merkkaukset)
    ? normalisoiMerkkaukset(w.merkkaukset.map(Number))
    : undefined;
  if (merkkaukset) v.merkkaukset = merkkaukset;
  if (w.era && typeof w.era === 'object' && (w.era as { id?: unknown }).id) {
    v.era = Number((w.era as { id: unknown }).id);
  }
  if (w.selite) v.selite = String(w.selite);
  if (w.tyyppi != null && Number(w.tyyppi) !== 0) v.tyyppi = Number(w.tyyppi);
  if (w.jaksoalkaa) v.jaksoalkaa = String(w.jaksoalkaa);
  if (w.jaksoloppuu) v.jaksoloppuu = String(w.jaksoloppuu);
  if (w.jaksotustili != null && Number(w.jaksotustili) !== 0)
    v.jaksotustili = Number(w.jaksotustili);
  if (w.maksuperusteinenTosite != null && Number(w.maksuperusteinenTosite) !== 0)
    v.maksuperusteinenTosite = Number(w.maksuperusteinenTosite);
  const kumppani =
    typeof w.kumppani === 'object' && w.kumppani !== null
      ? Number((w.kumppani as { id?: unknown }).id)
      : Number(w.kumppani);
  if (Number.isFinite(kumppani) && kumppani !== 0) v.kumppani = kumppani;
  if (w.arkistotunnus) v.arkistotunnus = String(w.arkistotunnus);
  if (w.viite) v.viite = String(w.viite);
  if (w.tasaerapoisto != null && Number(w.tasaerapoisto) !== 0)
    v.tasaerapoisto = Number(w.tasaerapoisto);
  return v;
}
