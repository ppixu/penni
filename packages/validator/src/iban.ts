/** Strip everything that is not A-Z or 0-9 (legacy Iban ctor removeNonvalidPattern). */
function normalisoi(iban: string): string {
  return iban.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * IBAN mod-97 (verbatim port of Iban::ibanModulo, iban.cpp:143-184). Rearrange first 4 chars to
 * the end; letters A..Z -> (code-55) as 2 zero-padded digits; piecewise mod-97 (first 9 digits,
 * then repeatedly zeroPad2(remainder)+next7). Valid IBAN iff result === 1. Returns -1 on bad char.
 */
export function ibanModulo(iban: string): number {
  const puhdas = normalisoi(iban);
  const siirto = puhdas.slice(4) + puhdas.slice(0, 4);
  let apu = '';
  for (const merkki of siirto) {
    if (merkki >= '0' && merkki <= '9') apu += merkki;
    else if (merkki >= 'A' && merkki <= 'Z')
      apu += String(merkki.charCodeAt(0) - 55).padStart(2, '0');
    else return -1;
  }
  let jaannos = Number(apu.slice(0, 9)) % 97;
  if (apu.length < 10) return jaannos;
  let loput = apu.slice(9);
  while (loput.length > 0) {
    jaannos = Number(String(jaannos).padStart(2, '0') + loput.slice(0, 7)) % 97;
    loput = loput.length > 6 ? loput.slice(7) : '';
  }
  return jaannos;
}

/** Validate an IBAN (isValid rules from iban.cpp:115-127 + mod-97 == 1). */
export function tarkistaIban(iban: string): boolean {
  const s = normalisoi(iban);
  if (s.startsWith('FI') && s.length !== 18) return false;
  if (s.length < 10 || s.length > 32) return false;
  if (!/^[A-Z]{2}\d{2}/.test(s)) return false;
  return ibanModulo(s) === 1;
}

/** Group into 4s (lisaaValit, iban.cpp:129-141), trailing space trimmed for display. */
export function muotoileIban(iban: string): string {
  const s = normalisoi(iban);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += s[i];
    if (i % 4 === 3) out += ' ';
  }
  return out.trimEnd();
}

/** Finnish bank BIC from the account-part prefix (iban.cpp:31-80). FIRST MATCH WINS — order matters. */
export function bic(iban: string): string {
  const s = normalisoi(iban);
  if (!s.startsWith('FI')) return '';
  const t = s.slice(4); // account part, after FI + 2 check digits
  if (t.startsWith('405') || t.startsWith('497')) return 'HELSFIHH';
  if (t.startsWith('714')) return 'EVSEFIHH';
  if (t.startsWith('8')) return 'DABAFIHH';
  if (t.startsWith('34')) return 'DABAFIHX';
  if (t.startsWith('31')) return 'HANDFIHH';
  if (t.startsWith('1') || t.startsWith('2')) return 'NDEAFIHH';
  if (t.startsWith('5')) return 'OKOYFIHH';
  if (t.startsWith('39') || t.startsWith('36')) return 'SBANFIHH';
  if (t.startsWith('6')) return 'AABAFI22';
  if (t.startsWith('47')) return 'POPFFI22';
  if (t.startsWith('715') || t.startsWith('4')) return 'ITELFIHH';
  if (t.startsWith('717')) return 'BIGKFIH1';
  if (t.startsWith('713')) return 'CITIFIHX';
  if (t.startsWith('37')) return 'DNBAFIHX';
  if (t.startsWith('799')) return 'HOLVFIHH';
  if (t.startsWith('33')) return 'ESSEFIHX';
  if (t.startsWith('38')) return 'SWEDFIHH';
  if (t.startsWith('798')) return 'VPAYFIH2';
  return '';
}

const PANKIT: Record<string, string> = {
  HELSFIHH: 'Aktia',
  BIGKFIH1: 'Bigbank',
  EVSEFIHH: 'Alisa Pankki',
  CITIFIHX: 'Citibank',
  DABAFIHH: 'Danske Bank',
  DABAFIHX: 'Danske Bank',
  DNBAFIHX: 'DnB NOR Bank',
  HANDFIHH: 'Handelsbanken',
  HOLVFIHH: 'Holvi',
  NDEAFIHH: 'Nordea',
  ITELFIHH: 'Säästöpankki',
  OKOYFIHH: 'Osuuspankki',
  POPFFI22: 'POP Pankki',
  SBANFIHH: 'S-Pankki',
  ESSEFIHX: 'SEB',
  AABAFI22: 'Ålandsbanken',
  SWEDFIHH: 'Swedbank',
  VPAYFIH2: 'Viva Payment',
};

/** Finnish bank name for an IBAN (via bic). '' if unknown/non-FI. */
export function pankki(iban: string): string {
  return PANKIT[bic(iban)] ?? '';
}
