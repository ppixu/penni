import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type KysyAsetukset,
  KysyVirhe,
  type MalliKutsu,
  type OllamaTyokalu,
  type OllamaVastaus,
  type OllamaViesti,
} from './tyypit.js';

/** Thinking models need a large budget or `content` comes back empty; see kuitti-validointi/vision.ts.
 *  SUORA nostettiin 500 → 1000: muse-glimmer 30b törmäsi 500:aan (done_reason 'length' →
 *  budjetti-virhe) selittävissä vastauksissaan; lyhyeen vastaavat mallit pysähtyvät eosiin. */
const AJATTELU_TOKENIT = 3000;
const SUORA_TOKENIT = 1000;
const AIKAKATKO_MS = { ajattelu: 600_000, suora: 120_000 } as const;

function merkkijono(arvo: unknown): string {
  return typeof arvo === 'string' ? arvo : '';
}

/** Fail loudly and early: a silently skipped model is indistinguishable from a bad model. */
export async function varmistaKysyOllama(a: KysyAsetukset): Promise<void> {
  const tagsUrl = a.url.replace(/\/api\/chat$/, '/api/tags');
  const korjaus = `ollama pull ${a.malli}`;
  let data: unknown;
  try {
    const vastaus = await fetch(tagsUrl, { signal: AbortSignal.timeout(10_000) });
    data = await vastaus.json();
  } catch (e) {
    throw new KysyVirhe(
      'kutsu',
      `Ollamaan ei saatu yhteyttä osoitteessa ${tagsUrl}: ${e instanceof Error ? e.message : String(e)}.`,
      korjaus,
    );
  }
  const mallit =
    typeof data === 'object' && data !== null && 'models' in data
      ? (data as { models: unknown }).models
      : undefined;
  const nimet = Array.isArray(mallit)
    ? mallit.map((m) =>
        typeof m === 'object' && m !== null && 'name' in m
          ? merkkijono((m as { name: unknown }).name)
          : '',
      )
    : [];
  if (!nimet.includes(a.malli)) {
    throw new KysyVirhe(
      'kutsu',
      `Mallia ${a.malli} ei ole ladattu (löytyi: ${nimet.join(', ') || 'ei mitään'}).`,
      korjaus,
    );
  }
}

/** Build the /api/chat body. No `format: 'json'` — Kysy answers are free text, not extracted JSON. */
function rakennaPyynto(
  viestit: OllamaViesti[],
  tyokalut: OllamaTyokalu[] | undefined,
  a: KysyAsetukset,
): Record<string, unknown> {
  return {
    model: a.malli,
    stream: false,
    think: a.ajattelu,
    options: {
      temperature: 0,
      num_predict: a.ajattelu ? AJATTELU_TOKENIT : SUORA_TOKENIT,
      ...(a.kontekstiTokenit !== undefined ? { num_ctx: a.kontekstiTokenit } : {}),
    },
    messages: viestit,
    ...(tyokalut !== undefined ? { tools: tyokalut } : {}),
  };
}

/**
 * Structural check on the raw response body. The loop only ever sees a well-shaped
 * `OllamaVastaus` — a missing or malformed `message` is a transport failure ('kutsu'),
 * never something the loop's empty/budget classification has to deal with.
 */
function jasennaVastaus(data: unknown): OllamaVastaus {
  if (typeof data !== 'object' || data === null || !('message' in data)) {
    throw new KysyVirhe('kutsu', 'Ollama-vastauksesta puuttuu message-kenttä.');
  }
  const viesti = (data as { message: unknown }).message;
  if (
    typeof viesti !== 'object' ||
    viesti === null ||
    typeof (viesti as { content?: unknown }).content !== 'string'
  ) {
    throw new KysyVirhe('kutsu', 'Ollama-vastauksen message-kenttä on virheellinen.');
  }
  return data as OllamaVastaus;
}

async function kutsuOllama(
  viestit: OllamaViesti[],
  tyokalut: OllamaTyokalu[] | undefined,
  a: KysyAsetukset,
): Promise<OllamaVastaus> {
  const aikakatko = a.aikakatkoMs ?? (a.ajattelu ? AIKAKATKO_MS.ajattelu : AIKAKATKO_MS.suora);
  let data: unknown;
  try {
    const vastaus = await fetch(a.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rakennaPyynto(viestit, tyokalut, a)),
      signal: AbortSignal.timeout(aikakatko),
    });
    // fetch does not throw on non-2xx; an unchecked `.ok` lets an Ollama error body fall through
    // to jasennaVastaus and get scored as a malformed response — a transport/server failure
    // must be 'kutsu', reported with the HTTP status, never silently reinterpreted.
    if (!vastaus.ok) {
      const runko = await vastaus.text().catch(() => '');
      throw new KysyVirhe(
        'kutsu',
        `Ollama vastasi HTTP ${vastaus.status} ${vastaus.statusText}: ${runko}`,
      );
    }
    data = await vastaus.json();
  } catch (e) {
    if (e instanceof KysyVirhe) throw e;
    throw new KysyVirhe('kutsu', e instanceof Error ? e.message : String(e));
  }
  return jasennaVastaus(data);
}

/**
 * Cache key: model + thinking flag + full message/tool state, hashed. Used only by the eval
 * harness — the desktop app never passes `cacheDir`. Pure — unit-tested indirectly via
 * `luoOllamaKutsu`.
 */
function cacheAvain(
  viestit: OllamaViesti[],
  tyokalut: OllamaTyokalu[] | undefined,
  a: KysyAsetukset,
): string {
  const sha = createHash('sha256')
    .update(
      JSON.stringify({
        malli: a.malli,
        ajattelu: a.ajattelu,
        konteksti: a.kontekstiTokenit ?? null,
        tokenit: a.ajattelu ? AJATTELU_TOKENIT : SUORA_TOKENIT,
        viestit,
        tyokalut,
      }),
    )
    .digest('hex')
    .slice(0, 32);
  const siisti = a.malli.replace(/[^a-z0-9]+/gi, '_');
  return `${sha}-${siisti}.json`;
}

/**
 * Real Ollama transport for the Kysy loop. Without `cacheDir` every call hits the network;
 * with it, identical (model, thinking, messages, tools) tuples are served from disk — the
 * model is the expensive part, and re-running an eval must not re-pay for it.
 */
export function luoOllamaKutsu(cacheDir?: string): MalliKutsu {
  return async (viestit, tyokalut, a) => {
    if (cacheDir === undefined) return kutsuOllama(viestit, tyokalut, a);
    mkdirSync(cacheDir, { recursive: true });
    const polku = join(cacheDir, cacheAvain(viestit, tyokalut, a));
    if (existsSync(polku)) return JSON.parse(readFileSync(polku, 'utf8')) as OllamaVastaus;
    const vastaus = await kutsuOllama(viestit, tyokalut, a);
    // Atomic write: a Ctrl-C mid-write must never leave a truncated file that a later run reads
    // back as a genuine model answer. Write to a sibling temp file, then rename into place —
    // rename is atomic within the same directory/filesystem.
    const vali = `${polku}.tmp-${randomUUID()}`;
    writeFileSync(vali, JSON.stringify(vastaus));
    renameSync(vali, polku);
    return vastaus;
  };
}
