import { readFile } from 'node:fs/promises';
import { poimiKuittiTekstista } from '@penni/engine';
import { onkoTekstia, pdfTeksti } from './pdfTeksti.js';
import type { KuittiLukija } from './tyypit.js';

/**
 * Deterministinen kuittilukija: PDF:n tekstikerros → poimiKuittiTekstista. Ei mallia,
 * ei verkkoa. Kuvat ja skannaukset palauttavat ok:false — niiden lukeminen on maksullisen
 * natiivilukijan tehtävä (oma suunnitelmansa), ja tässä ne näkyvät kuittina joka puuttuu.
 */
export function pdfTekstiLukija(): KuittiLukija {
  return {
    nimi: 'PDF-teksti',
    async lue(tiedosto: string) {
      const tavut = new Uint8Array(await readFile(tiedosto));
      const teksti = await pdfTeksti(tavut);
      if (!onkoTekstia(teksti))
        return { ok: false, virhe: 'Tiedostossa ei ole tekstikerrosta (kuva tai skannaus).' };
      return poimiKuittiTekstista(teksti);
    },
  };
}
