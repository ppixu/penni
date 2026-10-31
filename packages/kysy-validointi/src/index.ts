import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { InProcessClient } from '@penni/asiakas';
import {
  type KysyTapahtuma,
  KysyVirhe,
  OLETUS_ASETUKSET,
  kysy,
  luoOllamaKutsu,
  varmistaKysyOllama,
} from '@penni/kysy';
import { createSqliteStorage } from '@penni/storage-sqlite';
import { avaaEvalKirja } from './kirja.js';
import { KYSYMYKSET } from './kysymykset.js';
import { pisteyta } from './pisteytys.js';
import { muodostaRaportti } from './raportti.js';

/**
 * Warm the model before the question loop: a large local model's cold load takes minutes and
 * would otherwise eat the first question's call timeout (seen live with muse-glimmer 30b).
 * Best effort — on failure the first question simply pays for the load itself.
 */
async function lammitaMalli(url: string, malli: string, kontekstiTokenit?: number): Promise<void> {
  const generateUrl = url.replace(/\/api\/chat$/, '/api/generate');
  try {
    await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: malli,
        prompt: '',
        stream: false,
        ...(kontekstiTokenit !== undefined ? { options: { num_ctx: kontekstiTokenit } } : {}),
      }),
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    // parhaan yrityksen lämmitys — virhe ei kaada ajoa
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      malli: { type: 'string', default: OLETUS_ASETUKSET.malli },
      limit: { type: 'string' },
      out: { type: 'string', default: './kysy-raportti' },
      url: { type: 'string', default: OLETUS_ASETUKSET.url },
      ajattelu: { type: 'boolean', default: false },
      aikakatkaisu: { type: 'string' },
      konteksti: { type: 'string' },
      cache: { type: 'string' },
    },
  });

  if (!values.db) {
    console.error(
      'Käyttö: pnpm validoi --db <polku.kitsas|.penni> [--malli qwen3.5:2b] [--limit N] ' +
        '[--out <hakemisto>] [--url <ollama-url>] [--ajattelu] [--aikakatkaisu <sekunnit>] ' +
        '[--konteksti <tokenit>] [--cache <hakemisto>]',
    );
    process.exitCode = 1;
    return;
  }

  const asetukset = {
    malli: values.malli ?? OLETUS_ASETUKSET.malli,
    url: values.url ?? OLETUS_ASETUKSET.url,
    ajattelu: values.ajattelu ?? false,
    ...(values.aikakatkaisu !== undefined
      ? { aikakatkoMs: Number(values.aikakatkaisu) * 1000 }
      : {}),
    ...(values.konteksti !== undefined ? { kontekstiTokenit: Number(values.konteksti) } : {}),
  };

  // Fail loudly before touching the book: a book conversion just to discover Ollama isn't
  // running would waste the (potentially slow) .kitsas import for nothing.
  try {
    await varmistaKysyOllama({ ...OLETUS_ASETUKSET, ...asetukset });
  } catch (e) {
    if (e instanceof KysyVirhe) {
      console.error(e.message);
      if (e.korjaus) console.error(`Korjaus: ${e.korjaus}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  console.log(`Lämmitetään malli ${asetukset.malli}...`);
  await lammitaMalli(asetukset.url, asetukset.malli, asetukset.kontekstiTokenit);

  const { polku } = await avaaEvalKirja(values.db);
  const storage = createSqliteStorage({}, { tiedosto: polku });
  const client = new InProcessClient(storage, undefined, 'kysy-validointi');

  const cacheDir = values.cache ?? join(values.out, 'cache');
  const kutsuFn = luoOllamaKutsu(cacheDir);

  const kysymykset =
    values.limit !== undefined ? KYSYMYKSET.slice(0, Number(values.limit)) : KYSYMYKSET;
  const pvm = new Date().toISOString().slice(0, 10);

  const tulokset = [];
  try {
    for (const k of kysymykset) {
      const alku = performance.now();
      let tapahtumat: KysyTapahtuma[] = [];
      // One retry on a transport-level failure ('kutsu'): a local model's cold start or a
      // momentary Ollama hiccup must not burn a whole question in the report.
      for (let yritys = 0; yritys < 2; yritys++) {
        tapahtumat = [];
        for await (const tapahtuma of kysy(client, { kysymys: k.kysymys, asetukset, kutsuFn })) {
          tapahtumat.push(tapahtuma);
        }
        const kutsuvirhe = tapahtumat.some((t) => t.tyyppi === 'virhe' && t.koodi === 'kutsu');
        if (!kutsuvirhe) break;
        if (yritys === 0) console.log(`  ↻ ${k.id}: kutsuvirhe, yritetään uudelleen`);
      }
      const kestoMs = performance.now() - alku;
      const odotettu =
        k.odotus.tyyppi === 'kieltaytyminen' ? undefined : await k.odotus.arvo(client, pvm);
      tulokset.push(pisteyta(k, tapahtumat, odotettu, kestoMs));
      console.log(`${tulokset[tulokset.length - 1]?.ok ? '✓' : '✗'} ${k.id}`);
    }
  } finally {
    storage.close();
  }

  const raportti = muodostaRaportti(tulokset);
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, 'report.md'), raportti.md);
  writeFileSync(join(values.out, 'report.json'), JSON.stringify(raportti.json, null, 2));
  console.log(`\n${raportti.konsoli}`);
  console.log(`\nRaportit: ${join(values.out, 'report.md')} / report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
