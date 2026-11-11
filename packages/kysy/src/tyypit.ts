/** Runtime knobs for a Kysy conversation. All fields have defaults via {@link OLETUS_ASETUKSET}. */
export interface KysyAsetukset {
  malli: string;
  url: string;
  ajattelu: boolean;
  /** Kun ajattelu on päällä ja ajatteleva kutsu katkeaa tokenrajaan (pienet mallit jäävät
   *  ahneella dekoodauksella toistosilmukkaan) tai vastaus jää ajatteluun tyhjänä, kysymys
   *  toistetaan alusta ilman ajattelua. Mitattu qwen3.5:2b:llä oikealla kirjalla
   *  (kysy-validointi, 35 kysymystä, 2026-11-05): ajattelu pois 86 % (~6 s/kysymys), ajattelu
   *  ilman varatietä 77 %, ajattelu + varatie 94 % (~29 s/kysymys). Striimaavalla kehän
   *  katkaisulla (kehavahti.ts) ja `qwen3.5:2b-mtp-q8_0`:lla 97 % (34/35), ka. 21 s, p90 35 s
   *  (2026-11-06). Oletus päällä; ei vaikutusta, kun ajattelu on pois. */
  ajattelunVaratie: boolean;
  maxKierrokset: number;
  /** Yhden mallikutsun aikakatkaisu millisekunteina. Ilman arvoa oletus riippuu
   *  ajattelu-tilasta (ollama.ts AIKAKATKO_MS); isot paikallismallit tarvitsevat isomman. */
  aikakatkoMs?: number;
  /** Ollaman num_ctx. Ilman arvoa Ollaman oletus (tyypillisesti 4096) — työkalutulokset
   *  voivat ylittää sen, jolloin Ollama pudottaa keskustelun alun hiljaa pois. */
  kontekstiTokenit?: number;
}

export const OLETUS_ASETUKSET: KysyAsetukset = {
  /** Sama Q8-GGUF kuin `qwen3.5:2b` + MTP-ennustepää (spekulatiivinen dekoodaus): sama teksti,
   *  nopeampi. Mitattu oikealla kirjalla 2026-11-05 (M4, ajattelu pois): Kysy 86 % kuten
   *  `qwen3.5:2b` (samat virheet), 4,4 s vs 4,8 s/kysymys; MLX-tagit hävisivät tarkkuudessa
   *  (`-mlx` 71 %, `-nvfp4` 31 %). */
  malli: 'qwen3.5:2b-mtp-q8_0',
  url: 'http://localhost:11434/api/chat',
  ajattelu: false,
  ajattelunVaratie: true,
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
  /** Mallin ajattelua sitä mukaa kuin Ollama sitä striimaa. Sama `ajatusId` = sama mallikutsu;
   *  `osa` liitetään edellisten perään. Tulee vain, kun ajattelu on päällä. */
  | { tyyppi: 'ajatus'; ajatusId: number; osa: string }
  /** Ajatteleva yritys hylättiin (toistosilmukka tai tyhjä vastaus); kysymys ajetaan alusta
   *  ilman ajattelua. Sitä edeltäneet ajatukset ja työkalukutsut jäävät näkyviin historiaksi. */
  | { tyyppi: 'varatie' }
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

/** Optional per-call hooks. `ajatus` receives thinking deltas as they stream (the transport then
 *  streams); `signal` aborts the call mid-flight (user cancel / book switch). */
export interface MalliKutsuValinnat {
  ajatus?: (osa: string) => void;
  signal?: AbortSignal;
}

/** Transport seam: one chat completion. Fake in tests, Ollama in production. */
export type MalliKutsu = (
  viestit: OllamaViesti[],
  tyokalut: OllamaTyokalu[] | undefined,
  asetukset: KysyAsetukset,
  valinnat?: MalliKutsuValinnat,
) => Promise<OllamaVastaus>;
