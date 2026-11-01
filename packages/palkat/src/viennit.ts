import type { Asetukset, IsoDate, PalkkaHenkilo, PalkkaLaji, TositeVienti } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { PalkatVirhe } from './taulukot.js';
import { ASETUS } from './tyontekija.js';

/**
 * Palkka-ajon kirjaus: yksi tosite, henkilöittäin rivit spesifikaation "Booking"-taulukon
 * järjestyksessä (kuten Kitsas `palkkaapuri.cpp:119-142`). Tilit tulevat `palkkatilit`-asetuksesta
 * (samat koodit kuin Kitsaalla, joten tuodun kirjan kartta kelpaa sellaisenaan).
 *
 * Jaksotus: työntekijän ja työnantajan TyEL- ja työttömyysvakuutusosuudet kirjataan velaksi
 * TL / TT -tileille ja työnantajan osuudet kuluiksi EL / TV; vakuutusyhtiön lasku suoritetaan
 * ostolaskuna näitä velkoja vastaan.
 */

export type PalkkaKoodi =
  | 'PA'
  | 'LK'
  | 'LU'
  | 'LV'
  | 'KM'
  | 'PR'
  | 'AT'
  | 'EP'
  | 'SB'
  | 'SV'
  | 'EL'
  | 'TV'
  | 'TL'
  | 'TT'
  | 'MP';

export type Palkkatilit = Record<PalkkaKoodi, number>;

/** Yritystilikartan oletukset (`charts/yritys/asetukset.json`). MP on kirjan pankkitili. */
export const PALKKATILIT_OLETUS: Omit<Palkkatilit, 'MP'> = {
  PA: 5000,
  LK: 5110,
  LU: 5440,
  LV: 5990,
  KM: 7870,
  PR: 7880,
  AT: 7910,
  EP: 2920,
  SB: 2920,
  SV: 6300,
  EL: 6130,
  TV: 6410,
  TL: 2931,
  TT: 2965,
};

const KOODIT: readonly PalkkaKoodi[] = [
  ...(Object.keys(PALKKATILIT_OLETUS) as Exclude<PalkkaKoodi, 'MP'>[]),
  'MP',
];

const onTilinumero = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/**
 * Lukee `palkkatilit`-asetuksen (JSON) oletusten päälle. Kitsas-tuotu kartta säilyy; puuttuvat
 * koodit (TL, TT, MP) täydennetään. Tilinumero voi olla luku tai numeromerkkijono. Muut koodit
 * (esim. Kitsaan AY, UO) ohitetaan. Jos MP puuttuu, sitä käytetään `oletusPankkitili`.
 */
export function luePalkkatilit(asetukset: Asetukset, oletusPankkitili: number): Palkkatilit {
  const omat: Partial<Record<PalkkaKoodi, number>> = {};
  const raaka = asetukset[ASETUS.palkkatilit];
  if (raaka !== undefined && raaka.trim() !== '') {
    let json: unknown;
    try {
      json = JSON.parse(raaka);
    } catch {
      throw new PalkatVirhe('SYOTE', `Asetus ${ASETUS.palkkatilit} ei ole kelvollista JSONia.`);
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new PalkatVirhe(
        'SYOTE',
        `Asetus ${ASETUS.palkkatilit} on virheellinen: odotettiin oliota.`,
      );
    }
    const kartta = json as Record<string, unknown>;
    for (const koodi of KOODIT) {
      const arvo = kartta[koodi];
      if (arvo === undefined || arvo === null) continue;
      const tili = typeof arvo === 'string' && /^\d+$/.test(arvo.trim()) ? Number(arvo) : arvo;
      if (!onTilinumero(tili)) {
        throw new PalkatVirhe(
          'SYOTE',
          `Asetus ${ASETUS.palkkatilit} on virheellinen: ${koodi} ei ole tilinumero.`,
        );
      }
      omat[koodi] = tili;
    }
  }
  const mp = omat.MP ?? oletusPankkitili;
  if (!onTilinumero(mp)) {
    throw new PalkatVirhe(
      'SYOTE',
      'Palkan vastatili (MP) puuttuu: valitse nettopalkan maksutili palkka-asetuksista.',
    );
  }
  return { ...PALKKATILIT_OLETUS, ...omat, MP: mp };
}

const RAHAPALKKA: ReadonlySet<PalkkaLaji> = new Set(['kuukausipalkka', 'tuntipalkka']);
const PAIVARAHAT: ReadonlySet<PalkkaLaji> = new Set(['kokopaivaraha', 'osapaivaraha']);

const nolla = 0 as Cents;

/**
 * Palkka-ajon viennit. Nollasummaiset rivit jätetään pois. `eraId` (kun annettu) asetetaan vain
 * OmaVero-veloille eli EP- ja SB-riveille (ennakonpidätys + sava, kumpikin 2920).
 * Heittää `PalkatVirhe('SYOTE')`, jos jonkin henkilön nettopalkka on negatiivinen tai
 * kulukorvausriviltä puuttuu tili.
 */
export function palkkaViennit(
  henkilot: readonly PalkkaHenkilo[],
  tilit: Palkkatilit,
  maksupaiva: IsoDate,
  eraId?: number,
): TositeVienti[] {
  const viennit: TositeVienti[] = [];

  henkilot.forEach((h, i) => {
    // Virheviesteissä vain järjestysnumero, ei nimeä.
    if (h.tulos.nettopalkka < 0) {
      throw new PalkatVirhe(
        'SYOTE',
        `Henkilön ${i + 1} nettopalkka on negatiivinen: palkkaa ei voi kirjata.`,
      );
    }
    const t = h.tulos;
    const summa = (lajit: ReadonlySet<PalkkaLaji>) =>
      h.rivit.reduce((a, r) => (lajit.has(r.laji) ? a + r.summa : a), 0) as Cents;
    const laji = (l: PalkkaLaji) => summa(new Set([l]));

    const kirjaa = (
      tili: number,
      puoli: 'debet' | 'kredit',
      maara: Cents,
      otsikko: string,
      era?: number,
    ) => {
      if (maara === 0) return;
      const vienti: TositeVienti = {
        tili,
        debet: puoli === 'debet' ? maara : nolla,
        kredit: puoli === 'kredit' ? maara : nolla,
        pvm: maksupaiva,
        alvKoodi: 0,
        alvProsentti: 0,
        selite: `${otsikko} / ${h.nimi}`,
      };
      if (era !== undefined) vienti.era = era;
      viennit.push(vienti);
    };

    kirjaa(tilit.PA, 'debet', summa(RAHAPALKKA), 'Palkat');
    kirjaa(tilit.LK, 'debet', laji('lisa'), 'Lisät');
    kirjaa(tilit.LU, 'debet', t.luontoisedut, 'Luontoisedut');
    kirjaa(tilit.LV, 'kredit', t.luontoisedut, 'Luontoisedut');
    kirjaa(tilit.KM, 'debet', laji('km'), 'Km-korvaukset');
    kirjaa(tilit.PR, 'debet', summa(PAIVARAHAT), 'Päivärahat');
    kirjaa(tilit.AT, 'debet', laji('ateriakorvaus'), 'Ateriakorvaukset');
    h.rivit.forEach((r, j) => {
      if (r.laji !== 'kulukorvaus' || r.summa === 0) return;
      if (r.tili === undefined || !onTilinumero(r.tili)) {
        throw new PalkatVirhe(
          'SYOTE',
          `Henkilön ${i + 1} kulukorvausrivillä ${j + 1} ei ole tiliä.`,
        );
      }
      kirjaa(r.tili, 'debet', r.summa, r.selite.trim() || 'Kulukorvaus');
    });
    kirjaa(tilit.SV, 'debet', t.sava, 'Sairausvakuutusmaksu');
    kirjaa(tilit.SB, 'kredit', t.sava, 'Sairausvakuutusmaksu', eraId);
    kirjaa(tilit.EL, 'debet', t.tyelTyonantaja, 'Työnantajan TyEL-maksu');
    kirjaa(tilit.TL, 'kredit', t.tyelTyonantaja, 'Työnantajan TyEL-maksu');
    kirjaa(tilit.TV, 'debet', t.tvrTyonantaja, 'Työnantajan työttömyysvakuutusmaksu');
    kirjaa(tilit.TT, 'kredit', t.tvrTyonantaja, 'Työnantajan työttömyysvakuutusmaksu');
    kirjaa(tilit.EP, 'kredit', t.ennakonpidatys, 'Ennakonpidätys', eraId);
    kirjaa(tilit.TL, 'kredit', t.tyelTyontekija, 'Työntekijän TyEL-maksu');
    kirjaa(tilit.TT, 'kredit', t.tvrTyontekija, 'Työntekijän työttömyysvakuutusmaksu');
    kirjaa(tilit.MP, 'kredit', t.nettopalkka, 'Nettopalkka');
  });

  // Tilannekuva voi olla muokattu tai epäjohdonmukainen: tositetta ei anneta epätasapainoisena.
  const debet = viennit.reduce((a, v) => a + v.debet, 0);
  const kredit = viennit.reduce((a, v) => a + v.kredit, 0);
  if (debet !== kredit) {
    throw new PalkatVirhe('SYOTE', 'Palkkakirjaus ei täsmää: debet ja kredit eroavat toisistaan.');
  }
  return viennit;
}
