import { type LuonneArvo, tyyppiKoodilla } from './luonne.js';

/** Multilingual text as stored in the chart: { fi: "...", sv: "...", ... }. */
export type Monikielinen = Record<string, string>;

/** A chart-of-accounts account (engine-internal shape; luonne resolved at load). */
export interface Tili {
  numero: number;
  nimi: Monikielinen;
  tyyppiKoodi: string;
  luonne: LuonneArvo;
  /** Heading level for 'H<n>' accounts; 0 for leaf accounts. */
  otsikkotaso: number;
  /** tase-erittely level (0 = not itemised). */
  erittely: number;
  /** Any other chart keys (iban, poistotili, laajuus, ...) preserved verbatim. */
  data: Record<string, unknown>;
}

/** Raw account object as it appears in a chart JSON file. */
export type TiliData = Record<string, unknown> & {
  numero?: unknown;
  tyyppi?: unknown;
  nimi?: unknown;
};

function lueNimi(v: unknown): Monikielinen {
  if (v && typeof v === 'object') return v as Monikielinen;
  if (typeof v === 'string') return { fi: v };
  return {};
}

/**
 * The chart key's level component. Leaf accounts are level 0; a heading's level comes from
 * its 'H<n>' type code. Chart rows are keyed by (numero, taso) because Kitsas lets a heading
 * and an account — or two headings at different levels — share a number.
 *
 * Delegates to `tyyppiKoodilla` rather than re-parsing the code: `Tili.otsikkotaso` is derived
 * the same way, and two independent parsers would eventually disagree, keying one logical chart
 * row two different ways in storage.
 */
export function tasoTyypista(tyyppi: string): number {
  return tyyppiKoodilla(tyyppi).otsikkotaso;
}

/** Parse one chart account object, resolving its luonne from the type-code. */
export function lataaTili(data: TiliData): Tili {
  const tyyppiKoodi = typeof data.tyyppi === 'string' ? data.tyyppi : '';
  const tyyppi = tyyppiKoodilla(tyyppiKoodi);
  return {
    numero: typeof data.numero === 'number' ? data.numero : Number(data.numero) || 0,
    nimi: lueNimi(data.nimi),
    tyyppiKoodi,
    luonne: tyyppi.luonne,
    otsikkotaso: tyyppi.otsikkotaso,
    erittely: typeof data.erittely === 'number' ? data.erittely : 0,
    data,
  };
}

/** Parse a whole chart (array of account objects), preserving order. */
export function lataaKartta(accounts: readonly TiliData[]): Tili[] {
  return accounts.map(lataaTili);
}

/** The account's name in the given language (default Finnish), falling back to fi then any. */
export function nimi(tili: Tili, kieli = 'fi'): string {
  return tili.nimi[kieli] ?? tili.nimi.fi ?? Object.values(tili.nimi)[0] ?? '';
}

/** Whether the account uses tase-erittely (mirrors Tili::eritellaankoTase). */
export function eritellaankoTase(tili: Tili): boolean {
  return tili.erittely > 0;
}

/**
 * Resolve a singleton system account by its nature, using EXACT mask equality
 * (mirrors TiliModel::tiliTyypilla, tilimodel.cpp:301-308 — NOT the subset test).
 * Masks can collide (VELKATILI === SIIRTOVELKA === 722); pass `suosittu` (the
 * account number named in settings) to disambiguate. Returns undefined if none.
 */
export function tiliTyypilla(
  chart: readonly Tili[],
  mask: LuonneArvo,
  suosittu?: number,
): Tili | undefined {
  if (suosittu !== undefined) {
    const s = chart.find((t) => t.numero === suosittu && t.luonne === mask);
    if (s) return s;
  }
  return chart.find((t) => t.luonne === mask);
}
