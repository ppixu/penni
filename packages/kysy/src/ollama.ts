import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type KysyAsetukset,
  KysyVirhe,
  type MalliKutsu,
  type MalliKutsuValinnat,
  type OllamaTyokalu,
  type OllamaTyokaluKutsu,
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

/**
 * Does the model support thinking (`capabilities` from /api/show)? A model without it answers
 * `think: true` with HTTP 400, so the app turns thinking on only when this says yes. Any failure
 * (old Ollama, unknown model, network) is "no": thinking off is the safe, always-working mode.
 */
export async function tukeeAjattelua(a: KysyAsetukset): Promise<boolean> {
  try {
    const vastaus = await fetch(a.url.replace(/\/api\/chat$/, '/api/show'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: a.malli }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!vastaus.ok) return false;
    const data: unknown = await vastaus.json();
    const kyvyt =
      typeof data === 'object' && data !== null && 'capabilities' in data
        ? (data as { capabilities: unknown }).capabilities
        : undefined;
    return Array.isArray(kyvyt) && kyvyt.includes('thinking');
  } catch {
    return false;
  }
}

/** Build the /api/chat body. No `format: 'json'` — Kysy answers are free text, not extracted JSON. */
function rakennaPyynto(
  viestit: OllamaViesti[],
  tyokalut: OllamaTyokalu[] | undefined,
  a: KysyAsetukset,
  stream: boolean,
): Record<string, unknown> {
  return {
    model: a.malli,
    stream,
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

/**
 * Reads Ollama's NDJSON stream into one `OllamaVastaus`, handing each thinking delta to `ajatus`
 * as it arrives. Ollama streams `message.thinking` / `message.content` deltas, `tool_calls` in
 * whole, and `done_reason` on the final `done` chunk; a mid-stream failure is an `{error}` line.
 */
async function lueVirta(runko: ReadableStream<Uint8Array>, ajatus: (osa: string) => void) {
  const dekooderi = new TextDecoder();
  let puskuri = '';
  let content = '';
  let thinking = '';
  const tool_calls: OllamaTyokaluKutsu[] = [];
  let done_reason: string | undefined;
  const kasittele = (rivi: string) => {
    if (rivi.trim() === '') return;
    const osa = JSON.parse(rivi) as {
      error?: string;
      message?: { content?: string; thinking?: string; tool_calls?: OllamaTyokaluKutsu[] };
      done?: boolean;
      done_reason?: string;
    };
    if (osa.error !== undefined) throw new KysyVirhe('kutsu', `Ollama: ${osa.error}`);
    const m = osa.message;
    if (m?.thinking) {
      thinking += m.thinking;
      ajatus(m.thinking);
    }
    if (m?.content) content += m.content;
    if (m?.tool_calls) tool_calls.push(...m.tool_calls);
    if (osa.done) done_reason = osa.done_reason;
  };
  const lukija = runko.getReader();
  for (;;) {
    const { value, done } = await lukija.read();
    if (done) break;
    puskuri += dekooderi.decode(value, { stream: true });
    let rivinvaihto = puskuri.indexOf('\n');
    while (rivinvaihto >= 0) {
      kasittele(puskuri.slice(0, rivinvaihto));
      puskuri = puskuri.slice(rivinvaihto + 1);
      rivinvaihto = puskuri.indexOf('\n');
    }
  }
  kasittele(puskuri + dekooderi.decode());
  return {
    message: {
      content,
      ...(thinking !== '' ? { thinking } : {}),
      ...(tool_calls.length > 0 ? { tool_calls } : {}),
    },
    ...(done_reason !== undefined ? { done_reason } : {}),
  };
}

async function kutsuOllama(
  viestit: OllamaViesti[],
  tyokalut: OllamaTyokalu[] | undefined,
  a: KysyAsetukset,
  valinnat: MalliKutsuValinnat = {},
): Promise<OllamaVastaus> {
  const aikakatko = a.aikakatkoMs ?? (a.ajattelu ? AIKAKATKO_MS.ajattelu : AIKAKATKO_MS.suora);
  const signaalit = [AbortSignal.timeout(aikakatko)];
  if (valinnat.signal) signaalit.push(valinnat.signal);
  // Streaming only when someone listens to the thinking: the non-streaming path (eval harness,
  // thinking off) stays exactly as measured.
  const ajatus = valinnat.ajatus;
  let data: unknown;
  try {
    const vastaus = await fetch(a.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rakennaPyynto(viestit, tyokalut, a, ajatus !== undefined)),
      signal: AbortSignal.any(signaalit),
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
    if (ajatus !== undefined && vastaus.body) data = await lueVirta(vastaus.body, ajatus);
    else data = await vastaus.json();
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
  return async (viestit, tyokalut, a, valinnat) => {
    if (cacheDir === undefined) return kutsuOllama(viestit, tyokalut, a, valinnat);
    mkdirSync(cacheDir, { recursive: true });
    const polku = join(cacheDir, cacheAvain(viestit, tyokalut, a));
    if (existsSync(polku)) {
      const talletettu = JSON.parse(readFileSync(polku, 'utf8')) as OllamaVastaus;
      if (talletettu.message.thinking) valinnat?.ajatus?.(talletettu.message.thinking);
      return talletettu;
    }
    const vastaus = await kutsuOllama(viestit, tyokalut, a, valinnat);
    // Atomic write: a Ctrl-C mid-write must never leave a truncated file that a later run reads
    // back as a genuine model answer. Write to a sibling temp file, then rename into place —
    // rename is atomic within the same directory/filesystem.
    const vali = `${polku}.tmp-${randomUUID()}`;
    writeFileSync(vali, JSON.stringify(vastaus));
    renameSync(vali, polku);
    return vastaus;
  };
}
