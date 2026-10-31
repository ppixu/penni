/** Runtime knobs for a Kysy conversation. All fields have defaults via {@link OLETUS_ASETUKSET}. */
export interface KysyAsetukset {
  malli: string;
  url: string;
  ajattelu: boolean;
  maxKierrokset: number;
  /** Yhden mallikutsun aikakatkaisu millisekunteina. Ilman arvoa oletus riippuu
   *  ajattelu-tilasta (ollama.ts AIKAKATKO_MS); isot paikallismallit tarvitsevat isomman. */
  aikakatkoMs?: number;
  /** Ollaman num_ctx. Ilman arvoa Ollaman oletus (tyypillisesti 4096) — työkalutulokset
   *  voivat ylittää sen, jolloin Ollama pudottaa keskustelun alun hiljaa pois. */
  kontekstiTokenit?: number;
}

export const OLETUS_ASETUKSET: KysyAsetukset = {
  malli: 'qwen3.5:2b',
  url: 'http://localhost:11434/api/chat',
  ajattelu: false,
  maxKierrokset: 8,
};

/** Ollama /api/chat message shapes, narrowed per role. */
export type OllamaViesti =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: OllamaTyokaluKutsu[] }
  | { role: 'tool'; tool_name: string; content: string };

export interface OllamaTyokaluKutsu {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface OllamaTyokalu {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface OllamaVastaus {
  message: { content: string; thinking?: string; tool_calls?: OllamaTyokaluKutsu[] };
  done_reason?: string;
}

/** Events the Kysy loop emits as it works through a question — one per UI-visible step. */
export type KysyTapahtuma =
  | { tyyppi: 'tyokalu_alkoi'; kutsuId: number; nimi: string; syote: unknown }
  | { tyyppi: 'tyokalu_valmis'; kutsuId: number; nimi: string; tulos: unknown }
  | { tyyppi: 'vastaus'; teksti: string }
  | { tyyppi: 'virhe'; koodi: KysyVirheKoodi; viesti: string; korjaus?: string };

export type KysyVirheKoodi = 'kutsu' | 'budjetti' | 'tyhja' | 'kierrokset' | 'peruttu';

export class KysyVirhe extends Error {
  constructor(
    public koodi: KysyVirheKoodi,
    viesti: string,
    public korjaus?: string,
  ) {
    super(viesti);
    this.name = 'KysyVirhe';
  }
}

/** Transport seam: one chat completion. Fake in tests, Ollama in production. */
export type MalliKutsu = (
  viestit: OllamaViesti[],
  tyokalut: OllamaTyokalu[] | undefined,
  asetukset: KysyAsetukset,
) => Promise<OllamaVastaus>;
