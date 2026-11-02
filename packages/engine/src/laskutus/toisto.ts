import { yleinenAlv } from '../alv/kannat.js';
import { AlvKoodi } from '../alv/koodit.js';
import { Maksutapa } from '../vouchers/enums.js';
import type { IsoDate, Tosite, TositeRivi } from '../vouchers/types.js';
import { lisaaPaivia, paivienEro, siirraKuukausia } from './paivat.js';

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

/** Laskutusjakso siirrettynä `kk` kuukautta eteenpäin (laskunuusinta.cpp:115-121). */
export function siirraJaksoa(
  jakso: { alkaa: IsoDate; loppuu: IsoDate },
  kk: number,
): { alkaa: IsoDate; loppuu: IsoDate } {
  return { alkaa: lisaaPaivia(jakso.loppuu, 1), loppuu: siirraKuukausia(jakso.loppuu, kk) };
}

/**
 * Toiston pohja laskusta: otsikko, maksutapa, sarja, rivit, lisätiedot ja viivästyskorko sellaisinaan,
 * `maksuaikaPaivia = erapvm − laskupvm` (0 ilman eräpäivää) ja laskutusjakso siirrettynä kerran
 * `kuukausia` eteenpäin (spec §5.2), koska pohjan jakso on SEURAAVAN luonnoksen jakso.
 * Ennakon vähennysrivit (`ennakkoTosite`) ovat kertaluonteisia eivätkä siirry pohjaan.
 */
export function pohjaLaskusta(t: Tosite, kuukausia: number): ToistoPohja {
  const laskupvm = t.laskupvm ?? t.pvm;
  return {
    ...(t.otsikko !== undefined ? { otsikko: t.otsikko } : {}),
    maksutapa: t.maksutapa ?? Maksutapa.LASKU,
    ...(t.sarja !== '' ? { sarja: t.sarja } : {}),
    rivit: (t.rivit ?? []).filter((r) => r.ennakkoTosite == null),
    maksuaikaPaivia: t.erapvm !== undefined ? paivienEro(laskupvm, t.erapvm) : 0,
    ...(t.jakso !== undefined ? { jakso: siirraJaksoa(t.jakso, kuukausia) } : {}),
    ...(t.info !== undefined ? { info: t.info } : {}),
    ...(t.viivkorko !== undefined ? { viivkorko: t.viivkorko } : {}),
  };
}

/** Yleiset alv-kannat, jotka ovat olleet voimassa (vanhin ensin). */
const YLEISET_KANNAT: readonly number[] = [22, 23, 24, 25.5];

/**
 * Myyntirivit (MYYNNIT_NETTO), joiden kanta on jokin yleinen kanta mutta ei `pvm`:nä voimassa
 * oleva, saavat `yleinenAlv(pvm)`:n (laskunuusinta.cpp:178-186). Alennettuihin kantoihin ei
 * kosketa.
 */
export function paivitaRivienAlv(rivit: readonly TositeRivi[], pvm: IsoDate): TositeRivi[] {
  const yleinen = yleinenAlv(pvm);
  return rivit.map((r) =>
    r.alvKoodi === AlvKoodi.MYYNNIT_NETTO &&
    r.alvProsentti !== yleinen &&
    YLEISET_KANNAT.includes(r.alvProsentti)
      ? { ...r, alvProsentti: yleinen }
      : r,
  );
}
