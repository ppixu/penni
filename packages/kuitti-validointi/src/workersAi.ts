import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Kuva } from './rasterointi.js';
import { OCR_KEHOTE, type VastausTulos, VisioVirhe, cacheAvain } from './vision.js';

/**
 * Workers AI -litteraattori (Q5): sama `ocr`-kehote kuin Ollama-sarakkeessa, mutta malli on pilvessä.
 * Kutsu menee paikalliselle `wrangler dev` -Workerille (workers-ai/) jonka `ai`-sidonta välittää
 * kutsun tilille. Vain synteettisiä fikstuureja — ks. spec 2026-10-10 §6.
 */

export const WORKERS_AI_OLETUS_URL = 'http://localhost:8799/ajo';

/** Kova katto Workers AI -kutsuille koko spiken ajan (kaikki ajot, debuggaus mukaan lukien). */
export const AI_KUTSURAJA = 60;

/** Välimuistiavaimeen mennyt "endpoint": paikallisen portin vaihtuminen ei saa mitätöidä välimuistia. */
const AVAIN_LAHDE = 'workers-ai';

/** Litteroinnin tokenikatto; ajattelu on kytketty pois, joten tämä riittää pitkällekin kuitille. */
const TOKENIT = 1500;
const AIKAKATKO_MS = 180_000;

export interface WorkersAiAsetukset {
  /** Workers AI -mallin id, esim. `@cf/qwen/qwen3.8-27b`. */
  malli: string;
  url: string;
  cacheDir: string;
  raja?: number;
}

/** Pysyvä kutsulaskuri: kirjataan ENNEN kutsua (epäonnistunutkin kutsu voi kuluttaa kiintiötä). */
export class AiLaskuri {
  constructor(
    readonly polku: string,
    private readonly raja: number = AI_KUTSURAJA,
  ) {}

  luku(): number {
    if (!existsSync(this.polku)) return 0;
    const data: unknown = JSON.parse(readFileSync(this.polku, 'utf8'));
    const n =
      typeof data === 'object' && data !== null && 'kutsuja' in data
        ? (data as { kutsuja: unknown }).kutsuja
        : 0;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
  }

  /** Asettaa laskurin arvon (migraatio vanhasta laskurista); ei koskaan pienennä olemassa olevaa. */
  aseta(n: number): void {
    mkdirSync(dirname(this.polku), { recursive: true });
    const vali = `${this.polku}.tmp-${randomUUID()}`;
    writeFileSync(vali, JSON.stringify({ kutsuja: Math.max(n, this.luku()) }));
    renameSync(vali, this.polku);
  }

  /** Varaa yhden kutsun tai heittää kun katto olisi ylittymässä. */
  varaa(): number {
    const nyt = this.luku();
    if (nyt >= this.raja) {
      throw new Error(
        `Workers AI -kutsukatto ${this.raja} täynnä (${this.polku}); ei kutsuta. Katto on spiken kova raja.`,
      );
    }
    mkdirSync(dirname(this.polku), { recursive: true });
    const vali = `${this.polku}.tmp-${randomUUID()}`;
    writeFileSync(vali, JSON.stringify({ kutsuja: nyt + 1 }));
    renameSync(vali, this.polku);
    return nyt + 1;
  }
}

/** Kutsun runko Workerille: OpenAI-tyylinen chat, kuva data-URI:na, ajattelu pois. Pure — unit-tested. */
export function rakennaAiPyynto(
  kuva: Kuva,
  kehote: string,
  malli: string,
): Record<string, unknown> {
  const b64 = Buffer.from(kuva.tavut).toString('base64');
  const syote: Record<string, unknown> = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: kehote },
          { type: 'image_url', image_url: { url: `data:${kuva.mime};base64,${b64}` } },
        ],
      },
    ],
    temperature: 0,
    max_completion_tokens: TOKENIT,
    // Litterointi ei tarvitse päättelyä; ajatteluun palaava malli jättäisi `content`in tyhjäksi.
    chat_template_kwargs: { enable_thinking: false },
  };
  if (malli.includes('kimi')) syote.reasoning_effort = 'none';
  return { malli, syote };
}

/** Workers AI:n vastaus → teksti. Tukee sekä chat-completions- että `{response}`-muotoa. Pure — unit-tested. */
export function tulkitseAiVastaus(v: unknown): VastausTulos {
  const juuri = (o: unknown): unknown =>
    typeof o === 'object' && o !== null && 'result' in o ? (o as { result: unknown }).result : o;
  const r = juuri(v);
  if (typeof r !== 'object' || r === null) return { ok: false, syy: 'tyhja' };

  const suora = (r as { response?: unknown }).response;
  if (typeof suora === 'string' && suora.trim() !== '') return { ok: true, sisalto: suora };

  const valinnat = (r as { choices?: unknown }).choices;
  const viesti =
    Array.isArray(valinnat) && typeof valinnat[0] === 'object' && valinnat[0] !== null
      ? (valinnat[0] as { message?: unknown; finish_reason?: unknown })
      : undefined;
  const m = viesti?.message;
  const sisalto =
    typeof m === 'object' && m !== null && typeof (m as { content?: unknown }).content === 'string'
      ? (m as { content: string }).content
      : '';
  if (sisalto.trim() !== '') return { ok: true, sisalto };

  const ajatus =
    typeof m === 'object' && m !== null
      ? ((m as { reasoning_content?: unknown; reasoning?: unknown }).reasoning_content ??
        (m as { reasoning?: unknown }).reasoning)
      : undefined;
  if ((typeof ajatus === 'string' && ajatus.trim() !== '') || viesti?.finish_reason === 'length') {
    return { ok: false, syy: 'budjetti' };
  }
  return { ok: false, syy: 'tyhja' };
}

type HakuFn = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Litteroi kuvan Workers AI:lla. Välimuisti (malli + kuvan sha + kehote) ensin — osuma ei kuluta
 * kutsukiintiötä; muuten varataan laskurista, kutsutaan, kirjoitetaan välimuistiin atomisesti.
 * `hae` on injektoitava testejä varten.
 */
export async function workersAiTeksti(
  kuva: Kuva,
  a: WorkersAiAsetukset,
  laskuri: AiLaskuri,
  hae: HakuFn = fetch,
): Promise<string> {
  mkdirSync(a.cacheDir, { recursive: true });
  const polku = join(
    a.cacheDir,
    cacheAvain(kuva.tavut, a.malli, 'ocr', false, OCR_KEHOTE, AVAIN_LAHDE),
  );
  if (existsSync(polku)) return readFileSync(polku, 'utf8');

  laskuri.varaa();
  let data: unknown;
  try {
    const vastaus = await hae(a.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rakennaAiPyynto(kuva, OCR_KEHOTE, a.malli)),
      signal: AbortSignal.timeout(AIKAKATKO_MS),
    });
    if (!vastaus.ok) {
      const runko = await vastaus.text().catch(() => '');
      throw new VisioVirhe(
        'kutsu',
        `Workers AI vastasi HTTP ${vastaus.status}: ${runko.slice(0, 500)}`,
      );
    }
    data = await vastaus.json();
  } catch (e) {
    if (e instanceof VisioVirhe) throw e;
    throw new VisioVirhe('kutsu', e instanceof Error ? e.message : String(e));
  }
  const tulos = tulkitseAiVastaus(data);
  if (!tulos.ok) throw new VisioVirhe(tulos.syy, `malli ei palauttanut sisältöä (${tulos.syy})`);
  const vali = `${polku}.tmp-${randomUUID()}`;
  writeFileSync(vali, tulos.sisalto);
  renameSync(vali, polku);
  return tulos.sisalto;
}
