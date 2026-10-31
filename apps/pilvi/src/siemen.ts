import { yritysAsetukset, yritysRaportit, yritysTilit } from '@penni/charts';
import type { TiliData } from '@penni/engine';
import type { SqliteCoreSeed } from '@penni/storage-sqlite-core';
import { z } from 'zod';

/**
 * Uuden pilvikirjan oletussiemen: yritys-tilikartta, sen asetukset ja raporttipohjat sekä
 * kuluvan kalenterivuoden tilikausi. Sama kokoonpano kuin web-velhon luoKirjanpidonSiemen
 * (apps/web/src/client/luoSiemen.ts): monimutkaiset asetusarvot JSON-merkkijonoina.
 */
export function oletusSiemen(nyt: Date): SqliteCoreSeed {
  const asetukset: Record<string, string> = {};
  for (const [avain, arvo] of Object.entries(yritysAsetukset)) {
    asetukset[avain] = typeof arvo === 'string' ? arvo : JSON.stringify(arvo);
  }
  for (const [avain, maaritys] of Object.entries(yritysRaportit)) {
    asetukset[avain] = JSON.stringify(maaritys);
  }
  asetukset.Nimi = 'Uusi kirjanpito';
  const vuosi = nyt.getUTCFullYear();
  return {
    tilit: yritysTilit as unknown as TiliData[],
    tilikaudet: [{ alkaa: `${vuosi}-01-01`, loppuu: `${vuosi}-12-31` }],
    asetukset,
  };
}

/**
 * POST /api/kirjat -runko. Valinnainen `siemen` korvaa oletussiemenen (testit ja tuonti käyttävät
 * omaa tilikarttaa); se päätyy vain luojan omaan, tuoreeseen kirjaan.
 */
export const LuoKirjaSyote = z
  .object({
    siemen: z
      .object({
        tilit: z.array(z.object({ numero: z.number().int() }).passthrough()).optional(),
        tilikaudet: z
          .array(z.object({ alkaa: z.string(), loppuu: z.string() }).passthrough())
          .optional(),
        asetukset: z.record(z.string()).optional(),
      })
      .optional(),
  })
  .strict();
