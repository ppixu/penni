import { type Cents, roundHalfAway } from '@penni/euro';
import type { IsoDate, Muistutus } from '../vouchers/types.js';
import { lisaaPaivia, paiviaVuodessa, paivienEro } from './paivat.js';

/** Muistutusmaksun oletus (5,00 €). */
export const OLETUS_MUISTUTUSMAKSU = 500 as Cents;

export interface MuistutusLaskentaSyote {
  alkuperainen: { erapvm: IsoDate; viivkorko?: number };
  /** Kirjatut aiemmat muistutukset, vanhin ensin. */
  aiemmatMuistutukset: { pvm: IsoDate; maksu: Cents; korko: Cents }[];
  /** Erän saldo päivänä `pvm` ennen tätä muistutusta. */
  aiempiSaldo: Cents;
  pvm: IsoDate;
  /** `undefined` = oletusmaksu; kutsuja antaa 0, kun maksuruutu ei ole valittuna. */
  maksu?: Cents;
  korko: boolean;
  /** Dialogissa annettu korkoprosentti; voittaa muut. */
  viivkorko?: number;
  /** `luePeruskorko(asetukset)` (kelvoton tai puuttuva → 0). */
  peruskorko: number;
  /** Kumppanilla on alv-tunnus. */
  yritysasiakas: boolean;
}

/**
 * Laskee maksumuistutuksen maksun ja viivästyskoron. Korko lasketaan vain pääomasta (aiempi
 * saldo vähennettynä aiempien muistutusten maksuilla ja koroilla) ja päivät lasketaan
 * molemmat päät mukaan; tämä poikkeaa tarkoituksella Kitsaksesta
 * (maksumuistutusmuodostaja.cpp:60-65,146-152). Korkoprosentti tallennetaan sadasosaprosentteina
 * ja laskenta tehdään BigIntillä.
 */
export function laskeMaksumuistutus(s: MuistutusLaskentaSyote): Omit<Muistutus, 'aiemmat'> {
  const viivkorko =
    s.viivkorko ?? s.alkuperainen.viivkorko ?? s.peruskorko + (s.yritysasiakas ? 8 : 7);
  const maksu = s.maksu ?? OLETUS_MUISTUTUSMAKSU;

  let edellinen = s.alkuperainen.erapvm;
  let aiemmatKulut = 0;
  for (const m of s.aiemmatMuistutukset) {
    if (m.pvm > edellinen) edellinen = m.pvm;
    aiemmatKulut += m.maksu + m.korko;
  }
  const korkoalkaa = lisaaPaivia(edellinen, 1);
  const korkoloppuu = s.pvm;
  const paivia = paivienEro(korkoalkaa, korkoloppuu) + 1;
  const peruste = Math.max(0, s.aiempiSaldo - aiemmatKulut);

  let korko = 0;
  if (s.korko && paivia > 0 && peruste > 0) {
    const sadasosat = BigInt(roundHalfAway(viivkorko * 100));
    const osoittaja = BigInt(peruste) * sadasosat * BigInt(paivia);
    const nimittaja = 10000n * BigInt(paiviaVuodessa(korkoalkaa));
    // Pyöristys puolikkaasta ylöspäin (osoittaja on ei-negatiivinen).
    korko = Number((2n * osoittaja + nimittaja) / (2n * nimittaja));
  }

  return {
    maksu,
    korko: korko as Cents,
    viivkorko,
    korkoalkaa,
    korkoloppuu,
    aiempiSaldo: s.aiempiSaldo,
  };
}
