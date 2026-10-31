import type { Cents } from './euro.js';

const NBSP = ' '; // non-breaking space thousands separator
const MINUS = '−'; // typographic minus sign (not hyphen-minus)

/** Group integer digits in threes with a non-breaking space: 1234567 -> "1 234 567". */
function ryhmittele(kokonaisluku: string): string {
  return kokonaisluku.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Finnish money display: "1 234,56 €" (NBSP thousands, comma decimal, trailing € after NBSP). */
export function muotoileEuro(c: Cents): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const eurot = Math.trunc(abs / 100);
  const sentit = abs % 100;
  const merkki = neg ? MINUS : '';
  return `${merkki}${ryhmittele(String(eurot))},${String(sentit).padStart(2, '0')}${NBSP}€`;
}

/** Finnish short date: ISO 'YYYY-MM-DD' -> 'd.M.yyyy' (no leading zeros). Empty in -> empty out. */
export function muotoilePvm(iso: string): string {
  if (iso === '') return '';
  const [vuosi, kuukausi, paiva] = iso.split('-');
  if (vuosi === undefined || kuukausi === undefined || paiva === undefined) return iso;
  return `${Number(paiva)}.${Number(kuukausi)}.${vuosi}`;
}
