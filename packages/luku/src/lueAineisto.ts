import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Kuittilahde } from '@penni/engine';
import { lueTiliotePdf } from './lueTiliote.js';
import {
  type KuittiLukija,
  type LukemattaJaanyt,
  type LukuEdistyminen,
  LukuVirhe,
  type TasmaysAineisto,
} from './tyypit.js';

/** Piilotiedostot ja macOS:n roskat eivät ole kuitteja. */
function onkoKuittitiedosto(nimi: string): boolean {
  return !nimi.startsWith('.');
}

/**
 * Lukee tiliotteen ja kuittikansion yhdeksi täsmäytysaineistoksi. Yksittäisen kuitin
 * epäonnistuminen ei kaada ajoa: se kirjautuu `lukematta`-listaan ja sen pankkirivi
 * käsitellään kuittina joka puuttuu. Ilman kansiota (`null`) luetaan pelkkä tiliote; valittu
 * mutta tyhjä kansio on sen sijaan virhe, koska se on lähes aina väärä valinta.
 */
export async function lueAineisto(
  tiliote: string,
  kansio: string | null,
  lukija: KuittiLukija,
  edistyminen?: (e: LukuEdistyminen) => void,
): Promise<TasmaysAineisto> {
  edistyminen?.({ vaihe: 'tiliote', valmiina: 0, yhteensa: 1, tiedosto: tiliote });
  const luettu = await lueTiliotePdf(new Uint8Array(await readFile(tiliote)));
  edistyminen?.({ vaihe: 'tiliote', valmiina: 1, yhteensa: 1, tiedosto: tiliote });
  if (kansio === null)
    return { tiliote: { ...luettu, tiedosto: tiliote }, kuitit: [], lukematta: [] };

  const nimet = (await readdir(kansio)).filter(onkoKuittitiedosto).sort();
  if (nimet.length === 0)
    throw new LukuVirhe('EI_TIEDOSTOJA', `Kansiossa ei ole kuitteja: ${kansio}`);

  const kuitit: Kuittilahde[] = [];
  const lukematta: LukemattaJaanyt[] = [];
  for (const [i, nimi] of nimet.entries()) {
    const polku = join(kansio, nimi);
    try {
      const tulos = await lukija.lue(polku);
      if (tulos.ok) kuitit.push({ tiedosto: polku, kuitti: tulos.kuitti });
      else lukematta.push({ tiedosto: polku, syy: tulos.virhe });
    } catch (virhe) {
      lukematta.push({
        tiedosto: polku,
        syy: virhe instanceof Error ? virhe.message : String(virhe),
      });
    }
    edistyminen?.({ vaihe: 'kuitit', valmiina: i + 1, yhteensa: nimet.length, tiedosto: polku });
  }

  return { tiliote: { ...luettu, tiedosto: tiliote }, kuitit, lukematta };
}
