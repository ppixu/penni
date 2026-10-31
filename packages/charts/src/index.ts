import asetukset from '../../../charts/yritys/asetukset.json' with { type: 'json' };
import raportit from '../../../charts/yritys/raportit.json' with { type: 'json' };
import tilit from '../../../charts/yritys/tilit.json' with { type: 'json' };

/** One report layout: localized title/variant + the DSL rows. */
export interface RaporttiLayout {
  nimi?: Record<string, string>;
  muoto?: Record<string, string>;
  rivit: Record<string, unknown>[];
}

/** The 1079-entry yritys chart (accounts AND `H<n>` headings), in tree order. */
export const yritysTilit = tilit as unknown as Record<string, unknown>[];
/** Report layouts keyed by settings key (`tulos/yleinen`, `tase/yleinen`, …). */
export const yritysRaportit = raportit as unknown as Record<string, RaporttiLayout>;
/** Template settings (nested objects: `muodot`, `laajuudet`, `maksutavat±`, …). */
export const yritysAsetukset = asetukset as unknown as Record<string, unknown>;

export { PIENYRITTAJAN_TILIT, pienyrittajanPiilotilit } from './pienyrittaja.js';
export { oletusSuosikit } from './suosikit.js';
