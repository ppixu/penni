import type { Cents } from '@penni/euro';

/** ISO calendar date 'YYYY-MM-DD'. Lexicographic order == chronological order. */
export type IsoDate = string;

/** A single ledger entry. debet/kredit are integer cents and mutually exclusive (one is 0). */
export interface TositeVienti {
  tili: number; // account number (Tili.numero)
  debet: Cents;
  kredit: Cents;
  pvm: IsoDate;
  alvKoodi: number;
  alvProsentti: number;
  kohdennus?: number; // raw id, round-tripped; no lookup in Tier-0
  era?: number; // simplified era id, round-tripped; richer era model arrives Tier-2
  selite?: string;
  tyyppi?: number; // VientiTyyppi
  jaksoalkaa?: IsoDate; // accrual span start (jaksotukset)
  jaksoloppuu?: IsoDate; // accrual span end (open-ended if absent)
  jaksotustili?: number; // accrual counter-account override (round-trips; unused by the jaksotukset flow)
  maksuperusteinenTosite?: number; // set on a cash-basis VAT expiry-recognition leg: the origin invoice id
}

/**
 * An invoice row. Mirrors model/tositerivi: unit price / quantity / discounts are
 * euro/percent/count `number`s (as in the legacy code), NOT Cents — the only money
 * rounding to cents happens in rivi.ts at the line-total boundary.
 */
export interface TositeRivi {
  myyntiKpl: number; // quantity (default 1)
  aNetto: number; // net unit price, euros
  alvKoodi: number;
  alvProsentti: number; // VAT percent, e.g. 24
  aleProsentti?: number; // discount percent
  euroAlennus?: number; // euro discount (net), euros
  unKoodi?: string; // UN/ECE unit code, default 'C62'
  selite?: string;
  tili?: number; // sales-revenue account for this row (falls back to OletusMyyntitili)
  kohdennus?: number; // cost centre
}

/**
 * Tiliotetositteen tiedot. Avaimet kuten Kitsaksen Tosite::TILIOTE-kartassa
 * (apuri/tiliote/tilioteapuri.cpp:166-168: alkupvm, loppupvm, tili, iban); lisäksi pankin
 * tiliotteella ilmoittamat saldot, joihin kirjanpidon pankkitilin saldoa verrataan.
 */
export interface TilioteTiedot {
  tili: number; // pankkitilin numero kirjanpidossa
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  iban?: string;
  alkusaldo?: Cents; // pankin ilmoittama saldo kautta edeltävänä päivänä
  loppusaldo?: Cents; // pankin ilmoittama saldo kauden viimeisenä päivänä
}

/** A voucher (atomic accounting record). Wire key names preserved. */
export interface Tosite {
  pvm: IsoDate;
  tyyppi: number; // TositeTyyppi
  tila: number; // TositeTila (numeric state, NOT a total order)
  tunniste: number; // 0 until finalized
  sarja: string;
  otsikko?: string;
  kumppani?: number;
  viite?: string;
  laskupvm?: IsoDate;
  erapvm?: IsoDate;
  numero?: string; // invoice number (assigned on post from LaskuSeuraavaId)
  maksutapa?: number; // Maksutapa (default LASKU)
  alkuperainenTosite?: number; // hyvityslasku: the credited original voucher's id
  marginaalialijaama?: Record<string, number>; // MARGINAALILASKELMA: rate-key -> carried deficit cents
  tiliote?: TilioteTiedot; // TILIOTE: kausi, pankkitili ja pankin saldot
  viennit: TositeVienti[];
  rivit?: TositeRivi[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in 'YYYY-MM-DD' form (mirrors QDate::isValid()). */
export function onkoPvmValidi(s: string | undefined): boolean {
  if (!s || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map((p) => Number.parseInt(p, 10));
  if (m === undefined || d === undefined || y === undefined) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); // last day of month m
  return d <= days;
}
