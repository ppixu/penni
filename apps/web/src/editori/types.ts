import type { IsoDate, TilioteTiedot } from '@penni/engine';
import type { Cents } from '@penni/euro';

/** Which column of a grid row a focusable control sits in. */
export type Solu = 'tili' | 'selite' | 'kohdennus' | 'debet' | 'kredit' | 'alv';

/** Tab/focus order across a row's cells. */
export const SARAKKEET: readonly Solu[] = ['tili', 'selite', 'kohdennus', 'debet', 'kredit', 'alv'];

/**
 * One editable grid row. Money is ALWAYS integer Cents in state; strings live only
 * inside the EuroInput while focused. `tili === undefined` marks an empty row.
 */
export interface VientiRivi {
  /** Stable client-side key for React + focus refs (NOT the account number). */
  avain: string;
  tili?: number;
  selite?: string;
  debetSnt: Cents; // 0 when empty
  kreditSnt: Cents; // 0 when empty
  alvKoodi: number; // default 0 (EIALV); esitäytetään tilin oletuksesta (setTili.alv).
  alvProsentti: number; // default 0.
  /**
   * VAT entry basis: true = the amount is gross; false = net. Default true. Käänteisen
   * verovelvollisuuden koodeilla (24/25/26/29) aina false: syötetty summa on veroton
   * ostohinta ja vero lisätään molemmille puolille (setAlvKoodi/setTili asettavat).
   */
  bruttoSyotto: boolean;
  /** true kun alv-koodi on esitäytetty tilin oletuksesta (ei käyttäjän valinta): tilin
   *  vaihto saa silloin korvata sen uuden tilin oletuksella. */
  alvTililta?: boolean;
  /** Marks an auto-suggested balancing line. Tier-0 keeps it fully editable. */
  ehdotettu?: boolean;
  /** Kustannuspaikka tai projekti (id ≥ 1); puuttuu = ei kohdennusta (Yleinen). */
  kohdennus?: number;
  /** Merkkausten id:t nousevassa järjestyksessä, uniikit; puuttuu, kun merkkauksia ei ole. */
  merkkaukset?: number[];
}

export interface TositeEditoriTila {
  paiva: IsoDate; // ISO 'YYYY-MM-DD'
  tyyppi: number; // TositeTyyppi.MENO default
  sarja: string; // '' = yleinen
  selite: string; // voucher-level otsikko/selite
  rows: VientiRivi[]; // always >= 1 row
  /** Tiliote-tyypin tositteen kausi, pankkitili ja pankin saldot (tallentuu Tiliote-tyypillä). */
  tiliote?: TilioteTiedot;
  draftId?: number; // reserved for the deferred edit route; unused in create-only Tier-0
}

export type EditoriAction =
  | { type: 'setPaiva'; pvm: IsoDate }
  | { type: 'setTyyppi'; tyyppi: number }
  | { type: 'setSarja'; sarja: string }
  | { type: 'setSelite'; selite: string } // voucher-level
  | { type: 'setTiliote'; tiliote: TilioteTiedot }
  | { type: 'setRiviSelite'; avain: string; selite: string } // row-level
  | {
      type: 'setTili';
      avain: string;
      tili: number;
      /** Tilin alv-oletus (tilinAlvOletus); sovelletaan vain riville, jonka alv-koodia
       *  käyttäjä ei ole itse valinnut. Puuttuu = rivin alv ennallaan. */
      alv?: { alvKoodi: number; alvProsentti: number };
    }
  | { type: 'setDebet'; avain: string; snt: Cents } // setting debet zeroes kredit
  | { type: 'setKredit'; avain: string; snt: Cents } // and vice-versa
  | { type: 'setAlvKoodi'; avain: string; alvKoodi: number; alvProsentti: number }
  | { type: 'setBruttoSyotto'; avain: string; brutto: boolean }
  | { type: 'setKohdennus'; avain: string; kohdennus?: number; merkkaukset?: number[] }
  | { type: 'addRow'; afterAvain?: string }
  | {
      type: 'addBalancingRow'; // Enter: append a row pre-filled with the suggested counter-amount
      /** Kirjanpidon pankkitili: Meno/Tulo-tositteessa tasaava rivi saa sen tiliksi. */
      pankkitili?: number;
    }
  | { type: 'removeRow'; avain: string }
  | { type: 'reset'; initial?: Partial<TositeEditoriTila> }
  | { type: 'korvaa'; tila: TositeEditoriTila }; // ulkoinen täyttö ja sen kumoaminen

export interface Summat {
  debetYht: Cents;
  kreditYht: Cents;
  erotus: Cents; // debetYht − kreditYht
  tasmaa: boolean; // erotus === 0
}
