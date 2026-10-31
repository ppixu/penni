import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Kuitti, OCR_KEHOTE, jasennaKuitti, rakennaKuittiKehote } from '@penni/engine';
import type { Kuva } from './rasterointi.js';

export { OCR_KEHOTE };

export type VisioTila = 'poiminta' | 'ocr' | 'poiminta-korjaus';

export interface VisioAsetukset {
  malli: string;
  ajattelu: boolean;
  url: string;
  cacheDir?: string;
}

export const OLETUS_URL = 'http://localhost:11434/api/chat';

/** Thinking models need a large budget or `content` comes back empty; see spec §3.3. */
const AJATTELU_TOKENIT = 3000;
const SUORA_TOKENIT = 500;
const AIKAKATKO_MS = { ajattelu: 600_000, suora: 120_000 } as const;

export type VastausTulos = { ok: true; sisalto: string } | { ok: false; syy: 'budjetti' | 'tyhja' };

/**
 * `'jasennys'` (unparseable JSON after the one repair retry) is distinct from `'tyhja'`
 * (model answered with genuinely empty content) and from `'kutsu'` (transport/HTTP failure) —
 * three unrelated events that must never share one bucket, see spec §7 / final review finding #3.
 */
export type VisioVirheenSyy = 'budjetti' | 'tyhja' | 'kutsu' | 'jasennys';

export class VisioVirhe extends Error {
  readonly syy: VisioVirheenSyy;
  constructor(syy: VisioVirheenSyy, viesti: string) {
    super(viesti);
    this.name = 'VisioVirhe';
    this.syy = syy;
  }
}

/**
 * Cache key: content hash + model + mode + thinking + prompt + endpoint. The prompt and the
 * endpoint are hashed in because `/tmp/vlm-cache` is deliberately long-lived and survives code
 * edits — without this, changing the prompt would silently keep serving answers produced by the
 * old prompt (final review finding #6). Pure — unit-tested.
 */
export function cacheAvain(
  tavut: Uint8Array,
  malli: string,
  tila: VisioTila,
  ajattelu: boolean,
  kehote: string,
  url: string,
): string {
  const sha = createHash('sha256')
    .update(tavut)
    .update('\0')
    .update(kehote)
    .update('\0')
    .update(url)
    .digest('hex')
    .slice(0, 32);
  const siisti = malli.replace(/[^a-z0-9]+/gi, '_');
  return `${sha}-${siisti}-${tila}-${ajattelu ? 'ajattelu' : 'suora'}.txt`;
}

interface OllamaViesti {
  content?: unknown;
  thinking?: unknown;
}

function viesti(v: unknown): OllamaViesti {
  if (typeof v !== 'object' || v === null || !('message' in v)) return {};
  const m = (v as { message: unknown }).message;
  return typeof m === 'object' && m !== null ? (m as OllamaViesti) : {};
}

function merkkijono(arvo: unknown): string {
  return typeof arvo === 'string' ? arvo : '';
}

/**
 * Ollama's answer → usable content, or the reason it is unusable. A hybrid reasoning model
 * that runs out of budget answers inside `thinking` and leaves `content` empty; that is a
 * budget failure, never a wrong answer. Pure — unit-tested.
 */
export function tulkitseVastaus(v: unknown): VastausTulos {
  const m = viesti(v);
  const sisalto = merkkijono(m.content);
  if (sisalto.trim() !== '') return { ok: true, sisalto };
  const ajatus = merkkijono(m.thinking);
  const syy =
    typeof v === 'object' && v !== null && 'done_reason' in v
      ? merkkijono((v as { done_reason: unknown }).done_reason)
      : '';
  if (ajatus.trim() !== '' || syy === 'length') return { ok: false, syy: 'budjetti' };
  return { ok: false, syy: 'tyhja' };
}

/** Build the /api/chat body. Pure — unit-tested. */
export function rakennaPyynto(
  kuvaB64: string,
  kehote: string,
  a: VisioAsetukset,
  jsonMuoto: boolean,
): Record<string, unknown> {
  const pyynto: Record<string, unknown> = {
    model: a.malli,
    stream: false,
    think: a.ajattelu,
    options: {
      temperature: 0,
      num_predict: a.ajattelu ? AJATTELU_TOKENIT : SUORA_TOKENIT,
    },
    messages: [{ role: 'user', content: kehote, images: [kuvaB64] }],
  };
  if (jsonMuoto) pyynto.format = 'json';
  return pyynto;
}

/** Fail loudly and early: a silently skipped model is indistinguishable from a bad model. */
export async function varmistaOllama(a: VisioAsetukset): Promise<void> {
  const tagsUrl = a.url.replace(/\/api\/chat$/, '/api/tags');
  let data: unknown;
  try {
    const vastaus = await fetch(tagsUrl, { signal: AbortSignal.timeout(10_000) });
    data = await vastaus.json();
  } catch (e) {
    throw new VisioVirhe(
      'kutsu',
      `Ollamaan ei saatu yhteyttä osoitteessa ${tagsUrl}: ${e instanceof Error ? e.message : String(e)}. Käynnistä Ollama ja aja: ollama pull ${a.malli}`,
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
    throw new VisioVirhe(
      'kutsu',
      `Mallia ${a.malli} ei ole ladattu (löytyi: ${nimet.join(', ') || 'ei mitään'}). Aja: ollama pull ${a.malli}`,
    );
  }
}

async function kutsu(
  kuva: Kuva,
  kehote: string,
  a: VisioAsetukset,
  json: boolean,
): Promise<string> {
  const b64 = Buffer.from(kuva.tavut).toString('base64');
  const aikakatko = a.ajattelu ? AIKAKATKO_MS.ajattelu : AIKAKATKO_MS.suora;
  let data: unknown;
  try {
    const vastaus = await fetch(a.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rakennaPyynto(b64, kehote, a, json)),
      signal: AbortSignal.timeout(aikakatko),
    });
    // fetch does not throw on non-2xx; an unchecked `.ok` lets an Ollama error body (e.g.
    // "model requires more system memory") fall through to tulkitseVastaus and get scored as
    // "malli ei palauttanut sisältöä" — a transport/server failure must be 'kutsu', never 'tyhja'.
    if (!vastaus.ok) {
      const runko = await vastaus.text().catch(() => '');
      throw new VisioVirhe(
        'kutsu',
        `Ollama vastasi HTTP ${vastaus.status} ${vastaus.statusText}: ${runko}`,
      );
    }
    data = await vastaus.json();
  } catch (e) {
    if (e instanceof VisioVirhe) throw e;
    throw new VisioVirhe('kutsu', e instanceof Error ? e.message : String(e));
  }
  const tulos = tulkitseVastaus(data);
  if (!tulos.ok) throw new VisioVirhe(tulos.syy, `malli ei palauttanut sisältöä (${tulos.syy})`);
  return tulos.sisalto;
}

/** Cached model call. The model is the expensive part; scoring changes must not re-pay for it. */
async function kutsuVälimuistilla(
  kuva: Kuva,
  kehote: string,
  a: VisioAsetukset,
  json: boolean,
  tila: VisioTila,
): Promise<string> {
  const dir = a.cacheDir;
  if (dir === undefined) return kutsu(kuva, kehote, a, json);
  mkdirSync(dir, { recursive: true });
  const polku = join(dir, cacheAvain(kuva.tavut, a.malli, tila, a.ajattelu, kehote, a.url));
  if (existsSync(polku)) return readFileSync(polku, 'utf8');
  const sisalto = await kutsu(kuva, kehote, a, json);
  // Atomic write: a Ctrl-C mid-write must never leave a truncated file that a later run reads
  // back as a genuine model answer. Write to a sibling temp file, then rename into place —
  // rename is atomic within the same directory/filesystem.
  const vali = `${polku}.tmp-${randomUUID()}`;
  writeFileSync(vali, sisalto);
  renameSync(vali, polku);
  return sisalto;
}

/** Shape of the cached-and-transported model call; the seam `visioKuitti` tests inject a fake for. */
type MalliKutsu = (
  kuva: Kuva,
  kehote: string,
  a: VisioAsetukset,
  json: boolean,
  tila: VisioTila,
) => Promise<string>;

/** Appended to the prompt on the one allowed JSON-repair retry; see spec §7. */
const JSON_KORJAUS_LISAYS =
  'Edellinen vastauksesi ei ollut kelvollista JSON:ia. Vastaa NYT VAIN yhdellä JSON-objektilla, ' +
  'ei mitään muuta tekstiä eikä koodiaitoja.';

/**
 * poiminta-tila: kuva → tiukka Kuitti-JSON → jasennaKuitti (sama validointi kuin tekstipolulla).
 * Jos malli palauttaa jäsentymätöntä JSONia, tehdään täsmälleen yksi korjausyritys nudge-lisäyksellä
 * (spec §7: "one repair retry"). Uusinta käyttää tilaa 'poiminta-korjaus', jotta se saa oman
 * välimuistiavaimensa — `cacheAvain` hashaa nykyään myös kehotteen, joten pelkkä eri `kehote`
 * riittäisi jo erottamaan avaimet, mutta eri `tila` pitää ne erillään myös silloin jos kehotteet
 * joskus lähentyvät — ensimmäisen yrityksen epäonnistunut tulos ei siis koskaan tarjoile eikä
 * saastuta uusintaa tai päinvastoin.
 * `kutsuFn` on injektoitava vain testejä varten (oletus: oikea, välimuistillinen Ollama-kutsu);
 * budjettivirhe (`VisioVirhe.syy === 'budjetti'`) ei koskaan laukaise uusintaa, koska se heitetään
 * jo `kutsuFn`:n sisällä ennen kuin `jasennaKuitti`-tarkistus edes ehtii ajaa.
 */
export async function visioKuitti(
  kuva: Kuva,
  a: VisioAsetukset,
  kutsuFn: MalliKutsu = kutsuVälimuistilla,
): Promise<Kuitti> {
  const raaka = await kutsuFn(kuva, rakennaKuittiKehote(), a, true, 'poiminta');
  const tulos = jasennaKuitti(raaka);
  if (tulos.ok) return tulos.kuitti;

  const korjattuRaaka = await kutsuFn(
    kuva,
    `${rakennaKuittiKehote()}\n\n${JSON_KORJAUS_LISAYS}`,
    a,
    true,
    'poiminta-korjaus',
  );
  const korjattuTulos = jasennaKuitti(korjattuRaaka);
  if (!korjattuTulos.ok) {
    // 'jasennys', not 'tyhja': the model DID answer (both times) with non-empty content — it just
    // never became valid Kuitti JSON. That is a different event from genuinely-empty content and
    // must not share a bucket with it (final review finding #3).
    throw new VisioVirhe(
      'jasennys',
      `vision-jäsennys epäonnistui myös korjausyrityksen jälkeen (yksi uusinta tehty): ${korjattuTulos.virhe}`,
    );
  }
  return korjattuTulos.kuitti;
}

/** ocr-tila: kuva → pelkkä teksti; kentät poimii tuttu poimiKuittiTekstista kutsujan päässä. */
export async function visioTeksti(kuva: Kuva, a: VisioAsetukset): Promise<string> {
  return kutsuVälimuistilla(kuva, OCR_KEHOTE, a, false, 'ocr');
}
