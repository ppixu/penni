import type { KysyTapahtuma } from './tyypit.js';

/** Onko Ollama valmis vastaamaan — käytetty malli tai syy miksei, korjausohjeineen. */
export type KysyTila =
  | { ok: true; malli: string }
  | { ok: false; viesti: string; korjaus?: string };

/**
 * Työpöytäsilta: Kysy-kirjanpitäjän IPC-rajapinta. Renderöijä käyttää vain näitä tyyppejä —
 * sama sijoitteluperiaate kuin `TasmaysSilta`:lla (`packages/luku/src/tyypit.ts`).
 */
export interface KysySilta {
  kysyTila(): Promise<KysyTila>;
  kysy(
    kysymysId: number,
    kysymys: string,
    tapahtuma: (e: KysyTapahtuma & { kysymysId: number }) => void,
  ): Promise<void>;
  kysyPeruuta(kysymysId: number): Promise<void>;
}
