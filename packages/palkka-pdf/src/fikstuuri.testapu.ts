import type { PalkkaAjo, PalkkaHenkilo } from '@penni/engine';
import type { Cents } from '@penni/euro';
import {
  type PalkatAsetukset,
  type Tyontekija,
  type Verokortti,
  laskePalkka,
  taulukkoHaku,
} from '@penni/palkat';

export const c = (n: number) => n as Cents;
const TARKISTEMERKIT = '0123456789ABCDEFHJKLMNPRSTUVWXY';
/** Testitunnus: `ppkkvv` + vuosisatamerkki + yksilönumero 900-999 + laskettu tarkiste. */
function testiHetu(ppkkvv: string, merkki: string, yksilo: string): string {
  return `${ppkkvv}${merkki}${yksilo}${TARKISTEMERKIT[Number(`${ppkkvv}${yksilo}`) % 31]}`;
}
export const HETU = testiHetu('010190', '-', '900');
export const YKSILO_JA_TARKISTE = HETU.slice(7);

export const KORTTI: Verokortti = {
  alkaa: '2026-01-01',
  paattyy: '2026-12-31',
  perusBp: 2000,
  lisaBp: 4000,
  tuloraja: c(3_000_000),
  aiemminMaksettu: c(0),
};

export const TYONTEKIJA: Tyontekija = {
  id: 't1',
  nimi: 'Testi Työntekijä',
  hetu: HETU,
  osoite: { katu: 'Testikatu 1 A 2', postinumero: '00100', kaupunki: 'Helsinki' },
  iban: 'FI2112345600000785',
  vakuutusperuste: 'tyontekija',
  palkkamuoto: 'kuukausi',
  puhelinetu: true,
  verokortit: [KORTTI],
  aktiivinen: true,
};

const ASETUKSET: PalkatAsetukset = { tilapainenTyonantaja: false, tvrVapautus: false };

/** Tapaus A (laske.test.ts): kuukausipalkka 3 000, puhelinetu, 100 km, kortti 20 %/40 %, 2026. */
export function tapausA(
  t: Tyontekija = TYONTEKIJA,
  rivit?: Parameters<typeof laskePalkka>[0]['rivit'],
) {
  const henkilo = laskePalkka(
    {
      tyontekija: t,
      maksupaiva: '2026-10-31',
      kausiAlkaa: '2026-10-01',
      kausiLoppuu: '2026-10-31',
      rivit: rivit ?? [
        { laji: 'kuukausipalkka', selite: 'Kuukausipalkka', summa: c(300_000) },
        { laji: 'puhelinetu', selite: 'Puhelinetu' },
        { laji: 'km', selite: 'Helsinki–Espoo asiakaskäynti', maara: 10_000 },
      ],
    },
    { taulukko: taulukkoHaku(), asetukset: ASETUKSET, aiempiKertyma: c(0) },
  );
  const ajo: PalkkaAjo = {
    versio: 1,
    kausiAlkaa: '2026-10-01',
    kausiLoppuu: '2026-10-31',
    laskettu: '2026-10-31T10:00:00.000Z',
    henkilot: [henkilo],
  };
  return { henkilo, ajo };
}

export const TYONANTAJA = { nimi: 'Demo Oy', ytunnus: '1234567-8' };
export const VUODEN_ALUSTA = {
  brutto: c(3_020_000),
  ennakonpidatys: c(604_000),
  netto: c(2_203_660),
};
