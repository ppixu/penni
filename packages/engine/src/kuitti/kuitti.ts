import type { Cents } from '@penni/euro';
import type { IsoDate } from '../vouchers/types.js';

/** Yksi ALV-kanta kuitilla. Rahat kokonaissentteinä. */
export interface KuittiAlvEra {
  /** ALV-prosentti, esim. 25.5 | 24 | 14 | 10 | 0. */
  kanta: number;
  netto?: Cents;
  vero?: Cents;
  brutto?: Cents;
}

/** Näkömallin lukema kuitti validoituna. */
export interface Kuitti {
  myyja?: string;
  /** Y-tunnus muodossa 'NNNNNNN-N', jos näkyvissä. */
  ytunnus?: string;
  /** Kuitin päiväys 'YYYY-MM-DD'. */
  pvm?: IsoDate;
  /** ISO-valuuttakoodi, oletus 'EUR'. */
  valuutta: string;
  bruttoSumma?: Cents;
  /** ALV-erittely; voi olla tyhjä jos mallilta ei saada. */
  alv: KuittiAlvEra[];
  /** Kuitti mainitsee käännetyn verovelvollisuuden (reverse charge). */
  kaanteinenAlv?: boolean;
  /** Myyjän alue käännetyn alv:n koodivalintaan: 'EU' | 'MUU' (EU:n ulkopuoli). */
  alue?: 'EU' | 'MUU';
  /** Mallin ilmoittama kokonaisluottamus 0..1 (valinnainen). */
  luottamus?: number;
}
