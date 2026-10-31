import { type Tiliote, poimiTiliotteet } from '@penni/engine';
import { onkoTekstia, pdfTeksti } from './pdfTeksti.js';
import { LukuVirhe } from './tyypit.js';

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
  return tiliote;
}
