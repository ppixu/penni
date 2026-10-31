import { type Cents, Euro, roundHalfAway } from '@penni/euro';

/** Canonical wire money: integer cents -> "N.NN" (verbatim Euro.toString / euro.cpp:48-59). */
export function centsToWire(c: Cents): string {
  return Euro.toString(c);
}

/**
 * Decode wire money, liberally. Accepts the canonical "N.NN" string, a comma-decimal
 * string, or a raw JS number (legacy double euros); empty/null/undefined/0 -> 0 cents.
 * Strings go through Euro.fromString; numbers mirror the legacy inbound parse
 * qRound64(toDouble()*100) via roundHalfAway.
 */
export function wireToCents(v: string | number | null | undefined): Cents {
  if (v === null || v === undefined || v === '') return Euro.fromCents(0);
  if (typeof v === 'number') return Euro.fromCents(roundHalfAway(v * 100));
  return Euro.fromString(v);
}

/** A VAT percent as the legacy 2-decimal wire string (mirrors QString::number(d,'f',2)). */
export function prosenttiToWire(p: number): string {
  return p.toFixed(2);
}
