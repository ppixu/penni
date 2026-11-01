import type { IsoDate, TositeRivi } from '../vouchers/types.js';

/** Toistuvan laskun pohja: ne laskun kentät, joista jokainen uusi luonnos muodostetaan. */
export interface ToistoPohja {
  otsikko?: string;
  maksutapa: number;
  sarja?: string;
  rivit: TositeRivi[];
  maksuaikaPaivia: number;
  jakso?: { alkaa: IsoDate; loppuu: IsoDate };
  [avain: string]: unknown;
}

/** Toistuvan laskun aikataulu (Toisto). */
export interface Toisto {
  id: number;
  nimi?: string;
  kumppani?: number;
  kuukausia: number;
  seuraava: IsoDate;
  loppuu?: IsoDate;
  pohja: ToistoPohja;
  lahdeTosite?: number;
  aktiivinen: boolean;
}

/** Uusi/päivitettävä toisto; id annettu => päivitys, puuttuu => lisäys. */
export interface UusiToisto {
  id?: number;
  nimi?: string;
  kumppani?: number;
  kuukausia: number;
  seuraava: IsoDate;
  loppuu?: IsoDate;
  pohja: ToistoPohja;
  lahdeTosite?: number;
  aktiivinen: boolean;
}
