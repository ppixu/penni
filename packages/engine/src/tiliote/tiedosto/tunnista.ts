import type { Tiliote } from '../poimiKuukausitiliote.js';
import { poimiCamt } from './camt.js';
import { type CsvSarakkeet, jaaCsv, onkoCsv, otsikkoAvain, poimiCsv } from './csv.js';
import { ehdotaCsvSarakkeet } from './csvArvaus.js';
import { tunnistaCsvPankki } from './csvPankit.js';
import { poimiTito } from './tito.js';
import { TiliotetiedostoVirhe, type TiliotteenLahde, dekoodaa } from './yhteiset.js';

const TUETUT_MUODOT =
  'PDF-tiliote, camt.053- tai camt.054-XML, TITO (konekielinen tiliote) tai CSV';

/** Tunnettujen binääritiedostojen alkutavut (kuva, arkisto, Office): ei koskaan tiliotetekstiä. */
const BINAARIN_ALUT: readonly (readonly number[])[] = [
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x50, 0x4b, 0x03, 0x04], // ZIP (myös docx, xlsx)
  [0xd0, 0xcf, 0x11, 0xe0], // vanha Office (doc, xls)
];

const alkaa = (tavut: Uint8Array, alku: readonly number[]): boolean =>
  alku.every((t, i) => tavut[i] === t);

function onBinaari(tavut: Uint8Array): boolean {
  if (BINAARIN_ALUT.some((a) => alkaa(tavut, a))) return true;
  return tavut.subarray(0, 1024).includes(0);
}

function tuntematon(syy: string): TiliotetiedostoVirhe {
  return new TiliotetiedostoVirhe('TUNTEMATON', `${syy} Tuettuja muotoja ovat ${TUETUT_MUODOT}.`);
}

/**
 * Tunnistaa tiliotetiedoston muodon sisällöstä, ei tiedostopäätteestä (spec §2):
 * `%PDF` → pdf; XML, jossa `BkToCstmrStmt` → camt053 ja `BkToCstmrDbtCdtNtfctn` → camt054
 * (muu XML on virhe); ensimmäinen rivi alkaa `T00322` → tito; uskottava CSV → csv;
 * muuten virhe `TUNTEMATON`.
 */
export function tunnistaTiliotetiedosto(tavut: Uint8Array): TiliotteenLahde {
  if (alkaa(tavut, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (tavut.length === 0) throw tuntematon('Tiedosto on tyhjä.');
  if (onBinaari(tavut)) throw tuntematon('Tiedosto ei ole tekstitiedosto.');

  const teksti = dekoodaa(tavut);
  const alku = teksti.trimStart();
  if (alku.startsWith('<')) {
    if (/<(?:[\w.-]+:)?BkToCstmrStmt[\s>/]/.test(alku)) return 'camt053';
    if (/<(?:[\w.-]+:)?BkToCstmrDbtCdtNtfctn[\s>/]/.test(alku)) return 'camt054';
    throw tuntematon('Tiedosto on XML, mutta ei camt.053- tai camt.054-tiliote.');
  }
  // TITO: T00-tietueen tietueen pituus -kenttä (kohdat 4–6) on 322 (kuten Kitsas "T00322100").
  if (alku.startsWith('T00322')) return 'tito';
  if (onkoCsv(teksti)) return 'csv';
  throw tuntematon('Tiedoston muotoa ei tunnistettu.');
}

export interface TiliotetiedostonValinnat {
  /** Käyttäjän vahvistama CSV-sarakejako; ohittaa pankkiprofiilin. */
  csvSarakkeet?: CsvSarakkeet;
}

/**
 * Lukee rakenteisen tiliotetiedoston (camt.053/054, TITO, CSV) `Tiliote`-muotoon. CSV:lle
 * käytetään annettua sarakejakoa, muuten pankkiprofiilia; tuntemattomalle CSV:lle heitetään
 * `CSV_SARAKKEET`. PDF luetaan muualla (PDF-tekstin poiminta), ei tässä.
 */
export function poimiTiliotetiedosto(
  tavut: Uint8Array,
  valinnat: TiliotetiedostonValinnat = {},
): Tiliote {
  const lahde = tunnistaTiliotetiedosto(tavut);
  if (lahde === 'pdf')
    throw new TiliotetiedostoVirhe(
      'VAARA_MUOTO',
      'PDF-tiliote luetaan PDF-lukijalla, ei rakenteisen tiedoston lukijalla',
    );
  const teksti = dekoodaa(tavut);
  if (lahde === 'camt053' || lahde === 'camt054') return poimiCamt(teksti);
  if (lahde === 'tito') return poimiTito(teksti);

  const sarakkeet = valinnat.csvSarakkeet ?? tunnistaCsvPankki(jaaCsv(teksti).otsikot)?.sarakkeet;
  if (!sarakkeet)
    throw new TiliotetiedostoVirhe(
      'CSV_SARAKKEET',
      'CSV-tiedoston pankkia ei tunnistettu: valitse, mikä sarake on päivä, summa ja nimi',
    );
  return poimiCsv(teksti, sarakkeet);
}

/** CSV:n sarakejaon esikatselu: otsikot, ensimmäiset rivit ja ehdotettu sarakejako. */
export interface CsvEsikatselu {
  otsikot: string[];
  /** Enintään 5 ensimmäistä datariviä. */
  esimerkit: string[][];
  /** Otsikkorivin avain (`otsikkoAvain`), jolla vahvistettu sarakejako muistetaan kirjassa. */
  avain: string;
  /** Pankkiprofiilin sarakejako, jos pankki tunnistettiin, muuten arvaus. */
  ehdotus: CsvSarakkeet;
  /** Tunnistetun pankin nimi. */
  pankki?: string;
}

/** Esikatselee CSV-tiedoston sarakejakoa varten. Muu kuin CSV-tiedosto on virhe. */
export function esikatseleCsv(tavut: Uint8Array): CsvEsikatselu {
  const lahde = tunnistaTiliotetiedosto(tavut);
  if (lahde !== 'csv')
    throw new TiliotetiedostoVirhe('VAARA_MUOTO', 'Tiedosto ei ole CSV-tiedosto');
  const taulukko = jaaCsv(dekoodaa(tavut));
  const pankki = tunnistaCsvPankki(taulukko.otsikot);
  const tulos: CsvEsikatselu = {
    otsikot: taulukko.otsikot,
    esimerkit: taulukko.rivit.slice(0, 5),
    avain: otsikkoAvain(taulukko.otsikot),
    ehdotus: pankki?.sarakkeet ?? ehdotaCsvSarakkeet(taulukko),
  };
  if (pankki) tulos.pankki = pankki.pankki;
  return tulos;
}
