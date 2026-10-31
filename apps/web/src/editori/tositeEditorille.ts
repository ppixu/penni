import {
  AlvKoodi,
  type StoredTosite,
  type Tili,
  type TositeVienti,
  VientiTyyppi,
  veroTyyppi,
} from '@penni/engine';
import { Euro } from '@penni/euro';
import { bruttoSyottoKoodille } from './alvOletus.js';
import { johdaViennit } from './johdaViennit.js';
import { uusiRivi } from './reducer.js';
import type { TositeEditoriTila, VientiRivi } from './types.js';

/** Alv-koodit, joiden perusvienti kirjataan verottomana ja vero omana vientinään. */
const NETTOKOODIT: ReadonlySet<number> = new Set([AlvKoodi.MYYNNIT_NETTO, AlvKoodi.OSTOT_NETTO]);

/**
 * Vientityypit, jotka ruudukko kirjoittaa itse (generoiVeroviennit) ja joita mikään ei lue:
 * kirjaus-, alv-kirjaus- ja vähennyskelvottoman alv:n merkintä. Ne rinnastetaan puuttuvaan.
 * Muut tyypit (esim. ostovelka 102, suoritus 302, bruttooikaisu) kuuluvat laskuille ja
 * laskelmille: niiden on palauduttava sellaisenaan, tai tosite jää vain luku -näkymään.
 */
const RUUDUKON_TYYPIT: ReadonlySet<number> = new Set([
  VientiTyyppi.OSTO + VientiTyyppi.KIRJAUS,
  VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS,
  VientiTyyppi.OSTO + VientiTyyppi.ALVKIRJAUS,
  VientiTyyppi.MYYNTI + VientiTyyppi.ALVKIRJAUS,
  VientiTyyppi.OSTO + VientiTyyppi.VAHENNYSKELVOTON,
]);

function vertailtavaTyyppi(tyyppi: number | undefined): number {
  return tyyppi === undefined || RUUDUKON_TYYPIT.has(tyyppi) ? 0 : tyyppi;
}

/**
 * Vientien vertailuavain: tili, summat, alv, vientityyppi, päivä ja selite. Päivä ja selite
 * mukana, koska ruudukko leimaa tositteen päivän kaikille viennille ja antaa alv-vienneille
 * perusrivin selitteen; puuttuva ja tyhjä selite ovat samat.
 */
function avain(v: TositeVienti): string {
  return `${v.tili}|${v.debet}|${v.kredit}|${v.alvKoodi}|${v.alvProsentti}|${vertailtavaTyyppi(v.tyyppi)}|${v.pvm}|${v.selite ?? ''}`;
}

/**
 * Löysä vertailuavain: vain ne kentät, jotka ruudukko itse kirjoittaa. Käytetään, kun tositetta
 * ei ole tallennettu — silloin generaattorin lisäämä vientityyppi tms. ei ole käyttäjän tietoa,
 * jota tallennus voisi hävittää, ja ainoa kysymys on kumpi syöttötapa (brutto/netto) rivit tuottaa.
 */
function loysaAvain(v: TositeVienti): string {
  return `${v.tili}|${v.debet}|${v.kredit}|${v.alvKoodi}|${v.alvProsentti}`;
}

/**
 * Vientikenttä, jota ruudukko ei kirjoita takaisin: erä (laskun avoin saldo), kohdennus,
 * jaksotus tai maksuperusteisen alv:n linkki. Tallennus hävittäisi sen hiljaa. Tarkistetaan
 * vain tiukassa tilassa: esitäytössä ei ole tallennettua tietoa, jota voisi hävitä.
 */
function sailymatonKentta(v: TositeVienti): boolean {
  return (
    (v.era !== undefined && v.era !== 0) ||
    (v.kohdennus !== undefined && v.kohdennus !== 0) ||
    v.jaksoalkaa !== undefined ||
    v.jaksoloppuu !== undefined ||
    v.jaksotustili !== undefined ||
    v.maksuperusteinenTosite !== undefined
  );
}

function samatViennit(
  a: readonly TositeVienti[],
  b: readonly TositeVienti[],
  tiukka: boolean,
): boolean {
  if (a.length !== b.length) return false;
  const avaimella = tiukka ? avain : loysaAvain;
  const x = a.map(avaimella).sort();
  const y = b.map(avaimella).sort();
  return x.every((k, i) => k === y[i]);
}

export type TositeEditorilleOptiot = {
  /**
   * `true` (oletus): tallennettu tosite avataan muokattavaksi, joten rivien on tuotettava
   * viennit kaikkine kenttineen tai tulos on null — muuten tallennus pudottaisi kenttiä.
   * `false`: tosite on juuri koottu (kuitin täyttö, tiliotteen käsinkirjaus) ja rivit vain
   * esitäyttävät tyhjän lomakkeen, jolloin pudotettavaa tallennettua tietoa ei ole.
   */
  tiukka?: boolean;
};

/**
 * Perusviennit editorin riveiksi. `brutto`: verollisen nettokoodin (11/21) rivi palautetaan
 * bruttosummana (perusvienti + sen alv-vienti), kuten käyttäjä sen alun perin syötti;
 * muuten verottomana summana.
 */
function riveiksi(viennit: readonly TositeVienti[], brutto: boolean): VientiRivi[] | null {
  const alvViennit = viennit.filter((v) => v.alvKoodi >= AlvKoodi.ALVKIRJAUS);
  const kaytetyt = new Set<TositeVienti>();
  const rivit: VientiRivi[] = [];
  for (const v of viennit) {
    if (v.alvKoodi >= AlvKoodi.ALVKIRJAUS) continue;
    const kredit = v.kredit !== 0;
    let debetSnt = v.debet;
    let kreditSnt = v.kredit;
    let bruttoSyotto = bruttoSyottoKoodille(v.alvKoodi);
    if (NETTOKOODIT.has(v.alvKoodi)) {
      if (brutto) {
        const vero = alvViennit.find(
          (a) =>
            !kaytetyt.has(a) &&
            a.alvProsentti === v.alvProsentti &&
            (a.alvKoodi === v.alvKoodi + AlvKoodi.ALVKIRJAUS ||
              a.alvKoodi === v.alvKoodi + AlvKoodi.ALVVAHENNYS),
        );
        if (!vero) return null;
        kaytetyt.add(vero);
        const veroSumma = vero.debet + vero.kredit;
        if (kredit) kreditSnt = Euro.fromCents(v.kredit + veroSumma);
        else debetSnt = Euro.fromCents(v.debet + veroSumma);
      } else bruttoSyotto = false;
    }
    if (veroTyyppi(v.alvKoodi) === undefined && v.alvKoodi !== AlvKoodi.EIALV) return null;
    rivit.push(
      uusiRivi({
        tili: v.tili,
        debetSnt,
        kreditSnt,
        alvKoodi: v.alvKoodi,
        alvProsentti: v.alvProsentti,
        bruttoSyotto,
        ...(v.selite ? { selite: v.selite } : {}),
      }),
    );
  }
  return rivit;
}

/**
 * Tallennettu tosite ruudukkoeditorin alkutilaksi. Alv-viennit (koodi >= 100) johdetaan
 * editorissa uudelleen perusriveistä, joten ne jätetään pois; muunnos hyväksytään vain, jos
 * rivit tuottavat täsmälleen tallennetut viennit vientityyppeineen, päivineen ja selitteineen (ensin bruttona, sitten
 * nettona syötettynä). Muuten null: tositetta ei voi muokata ruudukossa muuttamatta sen
 * kirjauksia. Null myös, jos jollakin viennillä on kenttä, jota ruudukko ei säilytä (erä,
 * kohdennus, jaksotus) — esim. Kitsas-tuonnin tiedot katoaisivat tallennettaessa. Viennitön
 * tosite (esim. pelkkä tiliote liitteenä) palautuu tyhjäksi ruudukoksi (`rows: []`).
 * Kenttävaatimuksen voi löysätä `optiot.tiukka = false`:lla, kun tositetta ei ole tallennettu
 * (ks. TositeEditorilleOptiot).
 */
export function tositeEditorille(
  tosite: Pick<StoredTosite, 'pvm' | 'viennit' | 'tyyppi' | 'sarja' | 'otsikko' | 'tiliote'>,
  chart: readonly Tili[],
  optiot: TositeEditorilleOptiot = {},
): Partial<TositeEditoriTila> | null {
  const tiukka = optiot.tiukka ?? true;
  if (tiukka && tosite.viennit.some(sailymatonKentta)) return null;
  for (const brutto of [true, false]) {
    const rivit = riveiksi(tosite.viennit, brutto);
    if (!rivit) continue;
    let johdetut: TositeVienti[];
    try {
      johdetut = johdaViennit(rivit, chart, tosite.pvm);
    } catch {
      continue;
    }
    if (!samatViennit(johdetut, tosite.viennit, tiukka)) continue;
    return {
      paiva: tosite.pvm,
      tyyppi: tosite.tyyppi,
      sarja: tosite.sarja,
      selite: tosite.otsikko ?? '',
      rows: rivit,
      ...(tosite.tiliote ? { tiliote: tosite.tiliote } : {}),
    };
  }
  return null;
}
