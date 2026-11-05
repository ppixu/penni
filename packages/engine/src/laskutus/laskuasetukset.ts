/**
 * Laskutuksen lukuasetukset (`LaskuPeruskorko`, `LaskuMaksuaika`) luetaan yhden vartioidun
 * jäsentimen kautta: asetus on merkkijono (käyttäjän syöttämä tai Kitsaksesta tuotu), eikä roska
 * saa koskaan päätyä NaN- tai Infinity-arvona korko- tai päivälaskentaan.
 */

export interface AsetuslukuRajat {
  min: number;
  max: number;
  /** true: vain kokonaisluku (esim. päivät). */
  kokonaisluku?: boolean;
}

/** Viivästyskoron peruskorko prosentteina: 0–100. */
export const PERUSKORKO_RAJAT: AsetuslukuRajat = { min: 0, max: 100 };
/** Maksuaika päivinä: kokonaisluku 0–365. */
export const MAKSUAIKA_RAJAT: AsetuslukuRajat = { min: 0, max: 365, kokonaisluku: true };

/** Oletukset, kun asetus puuttuu tai on kelvoton. */
export const OLETUS_PERUSKORKO = 0;
export const OLETUS_MAKSUAIKA = 14;

/** Tavallinen desimaaliluku: numerot ja valinnainen yksi pilkku- tai pisteosa (ei eksponenttia,
 *  heksaa, etumerkkiä eikä Infinityä). */
const DESIMAALILUKU = /^\d+(?:[.,]\d+)?$/;
const KOKONAISLUKU = /^\d+$/;

/**
 * Jäsentää asetusarvon luvuksi; kelvoton tai rajojen ulkopuolinen arvo → null. Pilkku ja piste
 * kelpaavat desimaalierottimeksi; ympäröivät välit ohitetaan.
 */
export function jasennaAsetusluku(arvo: string | undefined, rajat: AsetuslukuRajat): number | null {
  const siisti = (arvo ?? '').trim();
  if (!(rajat.kokonaisluku ? KOKONAISLUKU : DESIMAALILUKU).test(siisti)) return null;
  const luku = Number(siisti.replace(/,/g, '.'));
  if (!Number.isFinite(luku) || luku < rajat.min || luku > rajat.max) return null;
  return luku;
}

/** `LaskuPeruskorko` prosentteina; puuttuva tai kelvoton → 0. */
export function luePeruskorko(asetukset: Readonly<Record<string, string>>): number {
  return jasennaAsetusluku(asetukset.LaskuPeruskorko, PERUSKORKO_RAJAT) ?? OLETUS_PERUSKORKO;
}

/** `LaskuMaksuaika` päivinä; puuttuva tai kelvoton → 14. */
export function lueMaksuaika(asetukset: Readonly<Record<string, string>>): number {
  return jasennaAsetusluku(asetukset.LaskuMaksuaika, MAKSUAIKA_RAJAT) ?? OLETUS_MAKSUAIKA;
}
