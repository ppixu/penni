import type { Cents } from '@penni/euro';

/** Yksi CSV-kenttä: null ja undefined kirjoitetaan tyhjänä. */
export type CsvKentta = string | number | null | undefined;

const BOM = '\uFEFF';

/** Sentit desimaaliluvuksi pilkulla ("1234,50"), pelkällä kokonaislukulaskennalla. */
export function csvSentit(c: Cents): string {
  const n = Math.trunc(c);
  const etumerkki = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const sentteja = abs % 100;
  const euroa = (abs - sentteja) / 100;
  return `${etumerkki}${euroa},${String(sentteja).padStart(2, '0')}`;
}

const PELKKA_LUKU = /^-?\d+(,\d+)?$/;

/**
 * Estää taulukkolaskennan kaavainjektion (OWASP "CSV injection"): tekstikenttä, joka alkaa
 * merkillä `=`, `+`, `@`, sarkain tai CR, tai `-`-merkillä muulla kuin pelkällä luvulla,
 * saa eteensä heittomerkin, jotta Excel/LibreOffice ei tulkitse sitä kaavaksi. Numerokenttiä
 * ei koskaan muuteta. Tarkka teksti säilyy JSON-viennissä.
 */
function turvallinenTeksti(teksti: string): string {
  if (/^[=+@\t\r]/.test(teksti) || (teksti.startsWith('-') && !PELKKA_LUKU.test(teksti))) {
    return `'${teksti}`;
  }
  return teksti;
}

function csvKentta(kentta: CsvKentta): string {
  if (kentta === null || kentta === undefined) return '';
  const teksti = typeof kentta === 'string' ? turvallinenTeksti(kentta) : String(kentta);
  if (/[;"\r\n]/.test(teksti)) return `"${teksti.replaceAll('"', '""')}"`;
  return teksti;
}

/** Yksi CSV-rivi ilman rivinvaihtoa: puolipiste-erotin, RFC 4180 -lainaus. */
export function csvRivi(kentat: readonly CsvKentta[]): string {
  return kentat.map(csvKentta).join(';');
}

/** Koko CSV-tiedosto: UTF-8 BOM, otsikkorivi ja rivit, jokainen CRLF-päätteinen. */
export function csvTiedosto(
  otsikot: readonly string[],
  rivit: readonly (readonly CsvKentta[])[],
): Uint8Array {
  const sisalto = [otsikot, ...rivit].map((rivi) => `${csvRivi(rivi)}\r\n`).join('');
  return new TextEncoder().encode(BOM + sisalto);
}
