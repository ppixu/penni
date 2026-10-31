import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { InProcessClient } from '@penni/asiakas';
import { ResourceError } from '@penni/engine';
import { createSqliteStorage } from '@penni/storage-sqlite';
import { TyokaluVirhe, haeTyokalu } from '@penni/tyokalut';
import { KOMENNOT } from './komennot.js';
import { ohjeJson, tulostaIhmiselle, tulostaOhje } from './tulostus.js';

const GLOBAALIT = {
  kirja: { type: 'string' },
  json: { type: 'boolean', default: false },
  agentti: { type: 'string' },
} as const;

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  stdin?: string;
}

export async function suorita(argv: string[], io: Io): Promise<number> {
  // First pass: only find the command word (tolerate unknown/command-specific flags).
  const esi = parseArgs({ args: argv, options: GLOBAALIT, allowPositionals: true, strict: false });
  const komento = String(esi.positionals[0] ?? '');

  if (komento === 'ohje' || komento === '') {
    const json = esi.values.json === true;
    if (json) io.stdout(`${JSON.stringify(ohjeJson(), null, 2)}\n`);
    else tulostaOhje(io);
    // Bare `penni` (no command) exits 1 so shell scripts notice a missing command; explicit
    // `penni ohje` exits 0. Same rule applies whether or not --json was given.
    return komento === '' ? 1 : 0;
  }

  const maaritys = KOMENNOT[komento];
  if (!maaritys) {
    return esivirhe(
      io,
      esi.values.json === true,
      'KOMENTO',
      `Tuntematon komento: ${komento}\nKäyttö: penni --kirja <polku.penni> <komento> [valinnat] | penni ohje --json`,
    );
  }

  // Second pass: strict parse with the command's own flags merged in.
  let values: Record<string, unknown>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      options: { ...GLOBAALIT, ...maaritys.optiot },
      allowPositionals: true,
    });
    values = parsed.values as Record<string, unknown>;
    positionals = parsed.positionals.slice(1); // drop the command word
  } catch (virhe) {
    return esivirhe(io, esi.values.json === true, 'SYOTE', (virhe as Error).message);
  }

  const polku = (values.kirja as string | undefined) ?? process.env.PENNI_KIRJA;
  if (!polku) {
    return esivirhe(
      io,
      values.json === true,
      'KIRJA',
      'Anna kirjanpitotiedosto: --kirja <polku.penni> tai PENNI_KIRJA-ympäristömuuttuja.',
    );
  }
  if (!existsSync(polku)) {
    return esivirhe(io, values.json === true, 'KIRJA', `Tiedostoa ei ole olemassa: ${polku}`);
  }

  const tyokalu = haeTyokalu(maaritys.tyokalu);
  if (!tyokalu) throw new Error(`rekisteristä puuttuu: ${maaritys.tyokalu}`); // programming error

  let syote: unknown;
  if (maaritys.stdin === true) {
    const raaka = io.stdin ?? (await lueStdin());
    try {
      syote = JSON.parse(raaka);
    } catch {
      return raportoiVirhe(
        new TyokaluVirhe('SYOTE', 'stdin ei ollut kelvollista JSONia'),
        values.json === true,
        io,
      );
    }
  } else {
    try {
      syote = await maaritys.syote(values, positionals);
    } catch (virhe) {
      return raportoiVirhe(virhe, values.json === true, io);
    }
  }

  const lahde = (values.agentti as string | undefined) ?? 'cli';
  const storage = createSqliteStorage({}, { tiedosto: polku });
  try {
    const client = new InProcessClient(storage, undefined, lahde);
    const tulos = await tyokalu.suorita(client, syote, { aika: new Date().toISOString() });
    if (values.json === true) io.stdout(`${JSON.stringify(tulos, null, 2)}\n`);
    else tulostaIhmiselle(tyokalu.nimi, tulos, io);
    return 0;
  } catch (virhe) {
    return raportoiVirhe(virhe, values.json === true, io);
  } finally {
    storage.close();
  }
}

/** Pre-dispatch errors (bad command word, missing/bad --kirja, bad flags) — same {virhe, koodi}
 * JSON-on-stderr shape as raportoiVirhe when --json is set, the existing plain text otherwise. */
function esivirhe(io: Io, json: boolean, koodi: string, viesti: string): number {
  if (json) io.stderr(`${JSON.stringify({ virhe: viesti, koodi })}\n`);
  else io.stderr(`${viesti}\n`);
  return 1;
}

async function lueStdin(): Promise<string> {
  const palat: Buffer[] = [];
  for await (const pala of process.stdin) palat.push(pala as Buffer);
  return Buffer.concat(palat).toString('utf8');
}

function raportoiVirhe(virhe: unknown, json: boolean, io: Io): number {
  const { koodi, viesti } =
    virhe instanceof ResourceError
      ? { koodi: virhe.code, viesti: virhe.message }
      : virhe instanceof TyokaluVirhe
        ? { koodi: virhe.koodi, viesti: virhe.message }
        : virhe instanceof Error && 'issues' in virhe
          ? { koodi: 'SYOTE', viesti: virhe.message } // zod validation error (v4 class names vary)
          : { koodi: 'TUNTEMATON', viesti: String(virhe) };
  if (json) io.stderr(`${JSON.stringify({ virhe: viesti, koodi })}\n`);
  else io.stderr(`Virhe (${koodi}): ${viesti}\n`);
  return 1;
}
