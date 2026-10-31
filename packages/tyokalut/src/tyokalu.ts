import type { KpClient } from '@penni/asiakas';
import { type Cents, muotoileEuro } from '@penni/euro';
import { z } from 'zod/v4';

/** Per-call environment. Attribution (lahde) rides on the client instance, not here. */
export interface TyokaluEnv {
  aika: string; // ISO datetime, injected by the caller (CLI/loop) — registry is clock-free
}

/** Tool-level rejection, distinct from ResourceError (engine) and zod's own errors. */
export class TyokaluVirhe extends Error {
  constructor(
    public koodi: string,
    viesti: string,
  ) {
    super(viesti);
    this.name = 'TyokaluVirhe';
  }
}

export interface Tyokalu {
  nimi: string;
  /** Finnish, one paragraph, written for an LLM reader. */
  kuvaus: string;
  kirjoittava: boolean;
  syote: z.ZodType;
  suorita(client: KpClient, syote: unknown, env: TyokaluEnv): Promise<unknown>;
}

/** Wrap a typed tool definition so suorita always zod-parses its raw input first. */
export function maaritaTyokalu<S extends z.ZodType>(m: {
  nimi: string;
  kuvaus: string;
  kirjoittava: boolean;
  syote: S;
  suorita(client: KpClient, syote: z.output<S>, env: TyokaluEnv): Promise<unknown>;
}): Tyokalu {
  return {
    nimi: m.nimi,
    kuvaus: m.kuvaus,
    kirjoittava: m.kirjoittava,
    syote: m.syote,
    suorita: async (client, raaka, env) => m.suorita(client, m.syote.parse(raaka), env),
  };
}

/** Money for tool output: integer cents (the truth) + Finnish display string. */
export function raha(c: Cents): { sentit: number; eur: string } {
  return { sentit: c, eur: muotoileEuro(c) };
}

/** ISO date (YYYY-MM-DD) of the env clock. */
export function pvmTanaan(env: TyokaluEnv): string {
  return env.aika.slice(0, 10);
}

/** Shared date input schema for every tool: strict ISO calendar date 'YYYY-MM-DD'. */
export const pvmSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Chart account name as stored: either a plain string or a { fi, sv, ... } multilingual map. */
export function nimiTekstina(nimi: unknown): string {
  if (typeof nimi === 'string') return nimi;
  if (nimi && typeof nimi === 'object') return String((nimi as Record<string, unknown>).fi ?? '');
  return '';
}

/** Tilinimihaun vertailumuoto. Tilikartat kirjoittavat arvonlisäveron sekä auki ("Arvonlisäverovelka")
 *  että lyhenteenä ("ALV SUORITUKSET"); molemmat normalisoidaan lyhenteeksi, jotta haku "alv" löytää
 *  myös tilin, jolla alv-velka oikeasti on. Väliviivat ja välilyönnit pois, koska yhdyssana
 *  kirjoitetaan hakuun usein osiin ("alv-velka", "alv velka"). */
export function hakuMuoto(teksti: string): string {
  return teksti
    .toLowerCase()
    .replaceAll('arvonlisävero', 'alv')
    .replace(/[\s-]+/g, '');
}
