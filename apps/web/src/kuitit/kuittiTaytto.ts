import { tositeEditorille } from '@/editori/tositeEditorille';
import type { TositeEditoriTila, VientiRivi } from '@/editori/types';
import {
  type IsoDate,
  type Kuitti,
  type Tili,
  type TositeAsetukset,
  TositeTyyppi,
  luoTositeMatchista,
} from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';

/** Kuitista täytetty lomakkeen tila ja ilmoituksen kuvaus täytetyistä kentistä ("pvm, myyjä, summa"). */
export interface KuittiTaytto {
  tila: TositeEditoriTila;
  kuvaus: string;
}

export interface TayttoOptiot {
  /** Lomakkeen oletuspäivä: päivä täytetään vain, jos käyttäjä ei ole sitä muuttanut. */
  oletusPaiva: string;
  chart: readonly Tili[];
  /** Pankkitili, menotili ja myyjäkohtaiset menotilisäännöt kuten täsmäytyksessä. */
  asetukset: TositeAsetukset;
  /** Kuuluuko päivä avoimelle, lukitsemattomalle tilikaudelle. */
  sallittuPaiva: (pvm: string) => boolean;
  alvVelvollinen: (pvm: string) => boolean;
  /** Käyttäjä kirjoittaa riviin parhaillaan, vaikka tila näyttää vielä tyhjältä: rivit ovat käytössä. */
  rivitKaytossa?: boolean;
}

/**
 * Rivit ovat tyhjät vain, jos käyttäjä ei ole kirjoittanut niihin mitään: ei tiliä, summaa,
 * rivin selitettä, alv-koodia, kohdennusta eikä merkkauksia. Muuten rivejä ei korvata (valittu
 * kohdennus katoaisi hiljaa kuitin riveiltä).
 */
function rivitTyhjat(tila: TositeEditoriTila): boolean {
  return tila.rows.every(
    (r) =>
      r.tili === undefined &&
      r.debetSnt === 0 &&
      r.kreditSnt === 0 &&
      (r.selite ?? '').trim() === '' &&
      r.alvKoodi === 0 &&
      !r.kohdennus &&
      !r.merkkaukset?.length,
  );
}

/**
 * Kuitin rivit samalla polulla kuin täsmäytyksen kuitti + pankkitapahtuma: kuitti on
 * synteettinen veloitus (−brutto). Alv:ttomassa kirjassa veroerittely jätetään pois, jolloin
 * koko summa kirjataan yhtenä verottomana menona. Puuttuva tili tai muokkaamaton tulos = null.
 */
function kuitinRivit(
  kuitti: Kuitti,
  brutto: Cents,
  paiva: string,
  optiot: TayttoOptiot,
): VientiRivi[] | null {
  const k: Kuitti = optiot.alvVelvollinen(paiva)
    ? kuitti
    : { ...kuitti, alv: [], kaanteinenAlv: false };
  try {
    const tosite = luoTositeMatchista(
      { pvm: paiva as IsoDate, nimi: kuitti.myyja ?? '', maara: Euro.fromCents(-brutto) },
      k,
      optiot.chart,
      optiot.asetukset,
    );
    return tositeEditorille(tosite, optiot.chart, { tiukka: false })?.rows ?? null;
  } catch (virhe) {
    // Vain virheen viesti: kuitin sisältö ei kuulu lokiin.
    console.warn(
      `Kuitin rivien muodostus epäonnistui: ${virhe instanceof Error ? virhe.message : String(virhe)}`,
    );
    return null;
  }
}

/**
 * Luetun kuitin tiedot lomakkeelle — vain tyhjiin kohtiin. Päivä, jos käyttäjä ei ole sitä
 * muuttanut ja kuitin päivä on avoimella kaudella; otsikko, jos tyhjä; rivit kokonaisuutena,
 * jos tosite on meno, kaikki rivit ovat tyhjiä (eikä niihin kirjoiteta parhaillaan) ja kuitilla
 * on euromääräinen loppusumma. null = ei mitään täytettävää.
 */
export function kuittiTaytto(
  kuitti: Kuitti,
  nykyinen: TositeEditoriTila,
  optiot: TayttoOptiot,
): KuittiTaytto | null {
  const kentat: string[] = [];
  let paiva = nykyinen.paiva;
  if (
    nykyinen.paiva === optiot.oletusPaiva &&
    kuitti.pvm !== undefined &&
    kuitti.pvm !== nykyinen.paiva &&
    optiot.sallittuPaiva(kuitti.pvm)
  ) {
    paiva = kuitti.pvm;
    kentat.push('pvm');
  }
  let selite = nykyinen.selite;
  const myyja = kuitti.myyja?.trim();
  if (nykyinen.selite.trim() === '' && myyja) {
    selite = myyja;
    kentat.push('myyjä');
  }
  let rows = nykyinen.rows;
  const brutto = kuitti.bruttoSumma;
  // Kuitin summa ei ole pankin euromääräinen veloitus: vierasta valuuttaa ei muunnettaisi
  // oikein ilman maksun kurssia. Rivit ovat menon rivejä, joten muulle tositelajille niitä ei
  // täytetä. Päivä ja myyjä voidaan silti täyttää.
  if (
    nykyinen.tyyppi === TositeTyyppi.MENO &&
    kuitti.valuutta === 'EUR' &&
    !optiot.rivitKaytossa &&
    rivitTyhjat(nykyinen) &&
    brutto !== undefined &&
    brutto > 0
  ) {
    const rivit = kuitinRivit(kuitti, brutto, paiva, optiot);
    if (rivit && rivit.length > 0) {
      rows = rivit;
      kentat.push('summa');
    }
  }
  if (kentat.length === 0) return null;
  return { tila: { ...nykyinen, paiva, selite, rows }, kuvaus: kentat.join(', ') };
}
