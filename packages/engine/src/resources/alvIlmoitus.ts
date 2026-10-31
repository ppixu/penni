import type { Cents } from '@penni/euro';
import type { IsoDate } from '../vouchers/types.js';
import { type AlvLaskelmaParams, haeAlvLaskelma } from './alvLaskelma.js';
import { asetusPaalla } from './context.js';
import type { Storage } from './storage.js';

/** Ilmoituskauden tyyppi: kuukausi / neljännes / vuosi. */
export type Kausityyppi = 'K' | 'Q' | 'V';

export interface AlvIlmoitus {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  kausityyppi: Kausityyppi;
  /** Tilikoodi -> sentit (haeAlvLaskelmasta, tarkat sentit; vain nollasta poikkeavat). */
  koodit: Map<number, Cents>;
  maksettava: Cents;
  /** Nollailmoitus: kaudella ei ole yhtään alv-koodia (legacy koodi 056). */
  nolla: boolean;
  /** Maksuperusteinen alv (legacy koodi 337). */
  maksuperusteinen: boolean;
}

/** Kauden pituus päivinä (inklusiivinen), UTC-turvallinen kokonaislukulaskenta. */
function kaudenPituusPaivina(alkupvm: IsoDate, loppupvm: IsoDate): number {
  const ms = (iso: IsoDate) =>
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((ms(loppupvm) - ms(alkupvm)) / 86_400_000) + 1;
}

function kausityyppi(alkupvm: IsoDate, loppupvm: IsoDate): Kausityyppi {
  const paivia = kaudenPituusPaivina(alkupvm, loppupvm);
  if (paivia <= 31) return 'K';
  if (paivia <= 92) return 'Q';
  return 'V';
}

/**
 * Kokoa OmaVero-valmis alv-ilmoituksen tietopaketti: haeAlvLaskelman koodikartta sellaisenaan
 * (tarkat sentit, ei kokonaiseuropyöristystä — legacy-uskollinen) + kausityyppi + nolla-/
 * maksuperusteisuusmerkinnät. Puhdas luku, ei kirjauksia, ei verkkoa (lähetys on rajattu pois).
 */
export async function haeAlvIlmoitus(
  storage: Storage,
  params: AlvLaskelmaParams,
): Promise<AlvIlmoitus> {
  const laskelma = await haeAlvLaskelma(storage, params);
  const asetukset = await storage.getAsetukset();
  return {
    alkupvm: laskelma.alkupvm,
    loppupvm: laskelma.loppupvm,
    kausityyppi: kausityyppi(params.alkupvm, params.loppupvm),
    koodit: laskelma.koodit,
    maksettava: laskelma.maksettava,
    nolla: laskelma.koodit.size === 0,
    maksuperusteinen: asetusPaalla(asetukset.Maksuperusteinen),
  };
}
