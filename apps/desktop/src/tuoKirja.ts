import { rename, unlink } from 'node:fs/promises';
import type { TaysmaytysRaportti, TuontiEdistyminen, TuontiRaportti } from '@penni/tuonti';
import { TuontiVirhe, kirjoitaKirja, lueKitsas, tarkistaTuonti } from '@penni/tuonti';
import { KirjaIstunto } from './kirjaIstunto.js';

export interface TuonninTulos {
  kohde: string;
  raportti: TuontiRaportti;
  taysmaytys: TaysmaytysRaportti;
}

/**
 * Import a Kitsas book at `lahde` into a fresh Penni file at `kohde`.
 *
 * Writes to a temp file first (`${kohde}.osittainen`) and only renames it onto `kohde` once
 * the whole import + reconciliation has succeeded: a mid-import failure (bad source, a write
 * that throws, a failing rename) discards the temp file and never touches `kohde`. A stale
 * temp file left behind by a previous crashed run is discarded up front, so it can never block
 * a fresh attempt.
 *
 * Plain Node, no Electron import — testable directly against real files. `paa.ts`'s
 * `tuonti:suorita` IPC handler does only the save dialog and calls this.
 */
export async function tuoKirja(
  lahde: string,
  kohde: string,
  edistyminen?: (e: TuontiEdistyminen) => void,
): Promise<TuonninTulos> {
  const valiaikainen = `${kohde}.osittainen`;
  await unlink(valiaikainen).catch(() => undefined);

  let istunto: KirjaIstunto;
  try {
    istunto = await KirjaIstunto.avaa(valiaikainen);
  } catch (virhe) {
    // Avaaminen saattoi silti ehtiä luoda tiedoston levylle ennen kuin se heitti (esim.
    // palvelimen listen() epäonnistui) — siivotaan sekin, ei vain myöhemmän tryn tapaukset.
    await unlink(valiaikainen).catch(() => undefined);
    throw virhe;
  }

  try {
    const kirja = lueKitsas(lahde);
    const raportti = await kirjoitaKirja(kirja, istunto.storage, {
      aika: new Date().toISOString(),
      ...(edistyminen ? { edistyminen } : {}),
    });
    const taysmaytys = await tarkistaTuonti(kirja, istunto.storage);
    await istunto.sulje();
    await rename(valiaikainen, kohde);
    return { kohde, raportti, taysmaytys };
  } catch (virhe) {
    await istunto.sulje();
    await unlink(valiaikainen).catch(() => undefined);
    throw virhe instanceof TuontiVirhe
      ? virhe
      : new Error(`Tuonti epäonnistui: ${virhe instanceof Error ? virhe.message : String(virhe)}`);
  }
}
