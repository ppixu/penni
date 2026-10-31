import { ibanModulo } from './iban.js';

/** Reference schemes (ViiteNumero enum): a base number turned into a reference. */
export const ViiteTyyppi = { LASKU: 1, VAKIOVIITE: 2, ASIAKAS: 3, HUONEISTO: 4 } as const;
export type ViiteTyyppi = (typeof ViiteTyyppi)[keyof typeof ViiteTyyppi];

/** 7-3-1 mod-10 check digit over a numeric base (viitenumero.cpp:126-144). */
export function laskeTarkaste(pohja: string): string {
  let summa = 0;
  let indeksi = 0;
  for (let i = pohja.length - 1; i >= 0; i--) {
    const numero = pohja.charCodeAt(i) - 48;
    summa += indeksi % 3 === 0 ? 7 * numero : indeksi % 3 === 1 ? 3 * numero : numero;
    indeksi++;
  }
  return String((10 - (summa % 10)) % 10);
}

/** Append the check digit -> full traditional reference. */
export function laskeViite(pohja: string): string {
  return pohja + laskeTarkaste(pohja);
}

/** Validate a traditional reference: length 3..20, digits, last digit is the 7-3-1 check. */
export function tarkistaViite(viite: string): boolean {
  const s = viite.replace(/\s/g, '');
  if (!/^\d{3,20}$/.test(s)) return false;
  const pohja = s.slice(0, -1);
  return laskeViite(pohja) === s;
}

/** Build an RF (ISO-11649) reference from a full traditional reference (viitenumero.cpp:100-107). */
export function rfViite(pohja: string): string {
  const raaka = `RF00${pohja}`;
  const tarkiste = 98 - ibanModulo(raaka);
  return muotoileRf(`RF${String(tarkiste).padStart(2, '0')}${pohja}`);
}

/** Validate an RF reference (mod-97 == 1 over the whole RF string). */
export function tarkistaRfViite(viite: string): boolean {
  const s = viite.replace(/\s/g, '').toUpperCase();
  if (!/^RF\d{2}\d+$/.test(s)) return false;
  return ibanModulo(s) === 1;
}

/** Traditional display grouping: blocks of 5 from the RIGHT (viitenumero.cpp:87-98). */
export function muotoileViite(viite: string): string {
  const s = viite.replace(/\s/g, '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += s[i];
    if ((s.length - i - 1) % 5 === 0 && i < s.length - 1) out += ' ';
  }
  return out;
}

/** RF/IBAN-style grouping: blocks of 4 from the LEFT (iban.cpp lisaaValit), trailing space trimmed. */
function muotoileRf(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += s[i];
    if (i % 4 === 3) out += ' ';
  }
  return out.trimEnd();
}

/**
 * Build a reference from a typed base id (viitenumero.cpp:26-124). VAKIOVIITE short form and the
 * short/long branches. For a base of length >= 5 the body is `kanta + typeDigit`; short bases pad.
 */
export function viiteEralle(tyyppi: ViiteTyyppi, kanta: number): string {
  const k = String(kanta);
  if (tyyppi === ViiteTyyppi.VAKIOVIITE) return laskeViite(k);
  const body = k.length >= 5 ? `${k}${tyyppi}` : `${tyyppi}${'0'.repeat(4 - k.length)}${k}9`;
  return laskeViite(body);
}
