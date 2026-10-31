import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createSqliteStorage } from '@penni/storage-sqlite';
import { kirjoitaKirja, lueKitsas } from '@penni/tuonti';

export interface EvalKirja {
  /** SQLite (.penni) tiedostopolku, valmis avattavaksi createSqliteStorage:lla. */
  polku: string;
}

/**
 * Open the book the eval harness runs against. A `.penni` path is a Penni SQLite file and is
 * used as-is (read-write in place — the harness itself never writes to it, but it doesn't
 * copy it either). A `.kitsas` path is a Kitsas book: read with `lueKitsas` and imported into a
 * fresh temp `.penni` file via `kirjoitaKirja`, mirroring `apps/desktop/src/tuoKirja.ts`. The
 * source `.kitsas` file is never modified.
 */
export async function avaaEvalKirja(polku: string): Promise<EvalKirja> {
  const paate = extname(polku).toLowerCase();
  if (paate === '.penni') return { polku };
  if (paate !== '.kitsas') {
    throw new Error(`Tuntematon tiedostopääte: ${polku} (odotettiin .penni tai .kitsas)`);
  }

  const hakemisto = mkdtempSync(join(tmpdir(), 'kysy-validointi-'));
  const kohde = join(hakemisto, 'eval.penni');
  const kirja = lueKitsas(polku);
  const storage = createSqliteStorage({}, { tiedosto: kohde });
  try {
    await kirjoitaKirja(kirja, storage, { aika: new Date().toISOString() });
  } finally {
    storage.close();
  }
  return { polku: kohde };
}
