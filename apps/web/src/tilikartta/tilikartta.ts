import { type Tili, type TiliTyyppi, tilityypit } from '@penni/engine';

/** Special account types whose deletion is blocked and whose (re)assignment needs confirming. */
export const VARO_TYYPIT = ['AJ', 'AL', 'ALM', 'AV', 'BE', 'T', 'BL', 'BJ', 'BLM', 'BV'] as const;

/** True iff `koodi` is one of the special (varo) types. */
export function onVaroTyyppi(koodi: string): boolean {
  return (VARO_TYYPIT as readonly string[]).includes(koodi);
}

/**
 * Selectable account types for the picker, filtered by the leading digit of the account number
 * (verbatim from tilinmuokkausdialog.cpp:161-166):
 *   1… → assets (koodi starts 'A'); 2… → equity/liability (koodi starts 'B' or 'T');
 *   3…–9… → income/expense (koodi starts 'C' or 'D'). Empty/short numbers → no choices.
 */
export function tyyppiSuodatin(numero: string): TiliTyyppi[] {
  const eka = numero.trim()[0];
  if (!eka) return [];
  const tyypit = tilityypit();
  if (eka === '1') return tyypit.filter((t) => t.koodi.startsWith('A'));
  if (eka === '2') return tyypit.filter((t) => /^[BT]/.test(t.koodi));
  return tyypit.filter((t) => /^[CD]/.test(t.koodi));
}

/**
 * Validate a new account number (add mode): a 4-digit-ish integer in [1000, 9999] and not already
 * used by a leaf account. Returns a Finnish error string, or null when valid.
 */
export function tarkistaNumero(numero: number, kartta: readonly Tili[]): string | null {
  if (!Number.isInteger(numero) || numero < 1000 || numero > 9999) {
    return 'Tilinumeron on oltava välillä 1000–9999.';
  }
  if (kartta.some((t) => t.otsikkotaso === 0 && t.numero === numero)) {
    return 'Tilinumero on jo käytössä.';
  }
  return null;
}

/** Whether changing the type from `vanha` to `uusi` requires a confirmation (to/from a varo-type). */
export function tarvitseekoVahvistuksen(vanha: string, uusi: string): boolean {
  if (vanha === uusi) return false;
  return onVaroTyyppi(uusi) || onVaroTyyppi(vanha);
}
