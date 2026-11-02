import type { Asetukset } from '../../resources/storage.js';
import { type CsvSarakkeet, PVM_MUODOT } from './csv.js';

/** Kirjan asetus, johon käyttäjän vahvistamat CSV-sarakejaot muistetaan otsikkorivin mukaan. */
export const CSV_SARAKKEET_ASETUS = 'TiliotteenCsvSarakkeet';

/** Muistettujen sarakejakojen enimmäismäärä. */
const ENINTAAN = 20;

/** Yksi muistettu sarakejako: `otsikko` on normalisoitu otsikkorivi (`otsikkoAvain`). */
export interface TallennettuCsvSarakkeet {
  otsikko: string;
  sarakkeet: CsvSarakkeet;
}

const onIndeksi = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
const VALINNAISET = [
  'maara',
  'debet',
  'kredit',
  'maksaja',
  'saaja',
  'viite',
  'arkistotunnus',
  'iban',
  'saldo',
  'valuutta',
] as const;

/**
 * Onko tallennettu arvo rakenteeltaan kelvollinen sarakejako: indeksit ei-negatiivisia
 * kokonaislukuja, tunnettu päivämuoto ja rahamäärä joko `maara` tai `debet` + `kredit`.
 */
export function onkoCsvSarakkeet(x: unknown): x is CsvSarakkeet {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  if (!onIndeksi(s.pvm) || !(PVM_MUODOT as readonly unknown[]).includes(s.pvmMuoto)) return false;
  for (const avain of ['nimi', 'viesti'] as const) {
    const lista = s[avain];
    if (!Array.isArray(lista) || !lista.every(onIndeksi)) return false;
  }
  if (!VALINNAISET.every((avain) => s[avain] === undefined || onIndeksi(s[avain]))) return false;
  return (s.maara !== undefined) !== (s.debet !== undefined && s.kredit !== undefined);
}

/**
 * Muistetut sarakejaot uusin ensin; puuttuva tai rikkinäinen arvo on tyhjä lista, ja
 * rakenteeltaan kelvottomat jaot pudotetaan.
 */
function lue(asetukset: Asetukset): TallennettuCsvSarakkeet[] {
  const arvo = asetukset[CSV_SARAKKEET_ASETUS];
  if (!arvo) return [];
  try {
    const luettu: unknown = JSON.parse(arvo);
    if (!Array.isArray(luettu)) return [];
    return luettu.filter(
      (x): x is TallennettuCsvSarakkeet =>
        typeof x === 'object' &&
        x !== null &&
        typeof x.otsikko === 'string' &&
        onkoCsvSarakkeet(x.sarakkeet),
    );
  } catch {
    return [];
  }
}

/** Otsikkoavaimelle muistettu sarakejako, jos sellainen on. */
export function haeCsvSarakkeet(asetukset: Asetukset, avain: string): CsvSarakkeet | undefined {
  return lue(asetukset).find((x) => x.otsikko === avain)?.sarakkeet;
}

/**
 * Asetuksen uusi arvo (JSON), kun sarakejako muistetaan: uusin ensin, saman otsikon vanha jako
 * korvataan, ja enintään 20 jakoa säilyy.
 */
export function csvSarakkeetAsetukseksi(
  asetukset: Asetukset,
  avain: string,
  sarakkeet: CsvSarakkeet,
): string {
  const muut = lue(asetukset).filter((x) => x.otsikko !== avain);
  return JSON.stringify([{ otsikko: avain, sarakkeet }, ...muut].slice(0, ENINTAAN));
}
