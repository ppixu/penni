import type { Cents } from '@penni/euro';
import { bic } from './iban.js';

/** Raw IBAN, uppercased, non-alnum stripped. */
function valeitta(iban: string): string {
  return iban.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** yyMMdd from an ISO 'YYYY-MM-DD', or '000000' when absent/invalid. */
function yyMMdd(iso?: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '000000';
  return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
}

/** Amount as "N.NN" (Euro::toString, euro.cpp:48-59) — always 2 decimals, no separators. */
function euroMerkkijonoUS(maara: Cents): string {
  const eurot = Math.trunc(Math.abs(maara) / 100);
  const sentit = Math.abs(maara) % 100;
  const merkki = maara < 0 ? '-' : '';
  return `${merkki}${eurot}.${String(sentit).padStart(2, '0')}`;
}

/**
 * Finnish bank virtual barcode (lasku.cpp:68-91). Version 4 = traditional viite, 5 = RF viite.
 * Exactly 54 digits, or '' if amount out of range (<=0 or >99999999 cents) or IBAN not Finnish.
 * `viite` for v4 = the traditional reference (with its check digit); for v5 = the RF reference.
 */
export function virtuaaliviivakoodi(p: {
  iban: string;
  maara: Cents;
  viite: string;
  rf?: boolean;
  erapvm?: string;
}): string {
  if (p.maara <= 0 || p.maara > 99999999) return '';
  const kokoIban = valeitta(p.iban);
  if (!kokoIban.startsWith('FI') || kokoIban.length !== 18) return '';
  const ib = kokoIban.slice(2); // 16 digits after FI
  const summa = String(p.maara).padStart(8, '0');
  const paiva = yyMMdd(p.erapvm);
  let koodi: string;
  if (p.rf) {
    const rf = p.viite.replace(/\s/g, '');
    koodi = `5${ib}${summa}${rf.slice(2, 4)}${rf.slice(4).padStart(21, '0')}${paiva}`;
  } else {
    const viite = p.viite.replace(/\s/g, '');
    koodi = `4${ib}${summa}000${viite.padStart(20, '0')}${paiva}`;
  }
  return koodi.length === 54 ? koodi : '';
}

/** SEPA EPC ('BCD'/SCT) QR payload string (lasku.cpp:93-111). '' if the IBAN has no known BIC. */
export function sepaQr(p: {
  iban: string;
  saaja: string;
  maara: Cents;
  viite: string;
  erapvm?: string;
}): string {
  const b = bic(p.iban);
  if (!b) return '';
  let data = `BCD\n001\n1\nSCT\n${b}\n${p.saaja}\n${valeitta(p.iban)}\nEUR${euroMerkkijonoUS(p.maara)}\n\n${p.viite.replace(/\s/g, '')}\n\n`;
  if (p.erapvm && /^\d{4}-\d{2}-\d{2}$/.test(p.erapvm)) data += `ReqdExctnDt/${p.erapvm}`;
  return data;
}
