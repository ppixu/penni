import {
  oletusSuosikit,
  pienyrittajanPiilotilit,
  yritysAsetukset,
  yritysRaportit,
  yritysTilit,
} from '@penni/charts';
import type { TiliData } from '@penni/engine';
import type { MemorySeed } from '@penni/storage-memory';

/** The decisions the new-book wizard collects (the irreducible Tier-0 set). */
export interface KirjanpitoSyote {
  nimi: string;
  muoto: string; // 'oy' | 'tmi' | 'ay' | 'ky' | 'osk'
  alvVelvollinen: boolean;
  kausiAlkaa: string; // 'YYYY-MM-DD'
  kausiLoppuu: string;
}

/** Strings pass through; everything else (objects/arrays/bools/numbers) becomes a JSON string —
 * matching the legacy Asetus table, where complex values are stored JSON-encoded. */
function arvoMerkkijonoksi(arvo: unknown): string {
  return typeof arvo === 'string' ? arvo : JSON.stringify(arvo);
}

/** Build a complete in-memory book seed from the yritys template + the wizard inputs.
 * Backend-agnostic: the same bundle feeds createMemoryStorage today and OPFS/cloud later. */
export function luoKirjanpidonSiemen(syote: KirjanpitoSyote): MemorySeed {
  const asetukset: Record<string, string> = {};
  // 1. template settings (nested objects -> JSON strings)
  for (const [avain, arvo] of Object.entries(yritysAsetukset)) {
    asetukset[avain] = arvoMerkkijonoksi(arvo);
  }
  // 2. fold the report layouts into settings — laadiRaportti reads asetukset[muoto] (0E-3b)
  for (const [avain, maaritys] of Object.entries(yritysRaportit)) {
    asetukset[avain] = JSON.stringify(maaritys);
  }
  // 3. user overrides on top
  asetukset.Nimi = syote.nimi;
  asetukset.muoto = syote.muoto;
  asetukset.AlvVelvollinen = syote.alvVelvollinen ? 'true' : 'false';
  // 4. toiminimelle pienyrittäjän näkymä: kartta pysyy täytenä, harvoin tarvitut tilit piiloon
  //    (muut yritysmuodot tarvitsevat omat pääomatilinsä — niille koko kartta näkyy).
  if (syote.muoto === 'tmi') asetukset.piilotilit = pienyrittajanPiilotilit(yritysTilit);
  // 5. perustarpeiden suosikkitilit (pankki, myynti, tavallisimmat kulut, ALV, yksityistilit)
  //    tilikartan ja tilivalitsimen Suosikit-välilehdelle.
  asetukset.suosikkitilit = oletusSuosikit(syote.muoto, syote.alvVelvollinen).join(',');

  return {
    tilit: yritysTilit as unknown as TiliData[],
    tilikaudet: [{ alkaa: syote.kausiAlkaa, loppuu: syote.kausiLoppuu }],
    asetukset,
  };
}

/** Defaults for the auto-seeded local book (no wizard). Keeps the 2026 fiscal year the existing
 * app + tests assume. */
export const OLETUS_SYOTE: KirjanpitoSyote = {
  nimi: 'Oma kirjanpito',
  muoto: 'oy',
  alvVelvollinen: false,
  kausiAlkaa: '2026-01-01',
  kausiLoppuu: '2026-12-31',
};
