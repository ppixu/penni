import {
  type Tiliote,
  TiliotetiedostoVirhe,
  type TiliotetiedostonValinnat,
  esikatseleCsv,
  poimiTiliotetiedosto,
  poimiTiliotteet,
  tunnistaTiliotetiedosto,
} from '@penni/engine';
import { onkoTekstia, pdfTeksti } from './pdfTeksti.js';
import { LukuVirhe, type TilioteEsikatselu } from './tyypit.js';

export { LukuVirhe } from './tyypit.js';

/**
 * Lukee pankin tiliotteen PDF:stä. Muoto tunnistetaan tekstistä (`poimiTiliotteet`): pankin
 * kuukausitiliote (kausi, alku- ja loppusaldo, monirivinen taitto myös pdf.js:n lohkomuodossa)
 * tai "Tapahtumat"-vienti (rivi per tapahtuma). Kaksi virhettä erotellaan, koska ohje on niissä
 * eri: skannattu/ei-tekstillinen PDF vs. tiedosto, josta kumpikaan muoto ei löydä mitään.
 * Saldollinen kuukausitiliote ilman tapahtumia (hiljainen kuukausi) on kelvollinen.
 */
export async function lueTiliotePdf(tavut: Uint8Array): Promise<Tiliote> {
  const teksti = await pdfTeksti(tavut);
  if (!onkoTekstia(teksti))
    throw new LukuVirhe(
      'EI_TEKSTIA',
      'Tiliotteessa ei ole tekstikerrosta. Lataa pankista PDF-vienti, älä kuvaa tai skannausta.',
    );
  const tiliote = poimiTiliotteet(teksti);
  const saldollinen = tiliote.alkusaldo !== undefined && tiliote.loppusaldo !== undefined;
  if (tiliote.tapahtumat.length === 0 && !saldollinen)
    throw new LukuVirhe(
      'VAARA_MUOTO',
      'Tiedostosta ei löytynyt yhtään tapahtumaa. Tuetut muodot ovat pankin kuukausitiliote ' +
        'ja "Tapahtumat"-vienti PDF:nä.',
    );
  return { ...tiliote, lahde: 'pdf' };
}

/**
 * Muuntaa rakenteisten tiedostojen lukijan virheen luku-kerroksen virheeksi. Viesti säilyy
 * sellaisenaan (myös "(rivi N)"), jotta käyttäjä näkee, mistä kohdasta tiedosto on rikki;
 * tuntemattoman tiedoston viesti luettelee jo tuetut muodot.
 */
function lukuVirheeksi(virhe: unknown): unknown {
  if (!(virhe instanceof TiliotetiedostoVirhe)) return virhe;
  if (virhe.koodi === 'CSV_SARAKKEET') return new LukuVirhe('CSV_SARAKKEET', virhe.message);
  return new LukuVirhe('VAARA_MUOTO', virhe.message);
}

/**
 * Lukee tiliotetiedoston sisällön mukaan (ei päätteen): PDF kulkee PDF-lukijan kautta, muut
 * (camt.053/054, TITO, CSV) moottorin jäsentimille. Tuntemattomalle CSV:lle heitetään
 * `CSV_SARAKKEET`, ellei `valinnat.csvSarakkeet` ole annettu.
 */
export async function lueTiliotetiedosto(
  tavut: Uint8Array,
  valinnat?: TiliotetiedostonValinnat,
): Promise<Tiliote> {
  try {
    if (tunnistaTiliotetiedosto(tavut) === 'pdf') return await lueTiliotePdf(tavut);
    return poimiTiliotetiedosto(tavut, valinnat);
  } catch (virhe) {
    throw lukuVirheeksi(virhe);
  }
}

/**
 * Tiedoston muoto ja CSV:lle sarakejaon esikatselu, jotta sivu voi päättää, näytetäänkö
 * sarakkeiden vahvistusvaihe.
 */
export function esikatseleTiliote(tavut: Uint8Array): TilioteEsikatselu {
  try {
    const lahde = tunnistaTiliotetiedosto(tavut);
    return lahde === 'csv' ? { lahde, csv: esikatseleCsv(tavut) } : { lahde };
  } catch (virhe) {
    throw lukuVirheeksi(virhe);
  }
}
