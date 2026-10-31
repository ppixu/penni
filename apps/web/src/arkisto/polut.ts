import type { IsoDate } from '@penni/engine';

/** Kauden hakemistonimi (Kitsas: Tilikausi::arkistoHakemistoNimi, tilikausi.cpp:97-105). */
export function kausiTunnus(alkaa: IsoDate): string {
  const vuosi = alkaa.slice(0, 4);
  const kuu = alkaa.slice(5, 7);
  const paiva = alkaa.slice(8, 10);
  if (kuu === '01' && paiva === '01') return vuosi;
  if (paiva === '01') return `${vuosi}-${kuu}`;
  return alkaa;
}

/** Tositteen tiedostonimen runko (Kitsas: arkistoija.cpp:773-779). */
export function tositeTiedosto(kausi: string, sarja: string, tunniste: number): string {
  return `${kausi}-${sarja}-${String(tunniste).padStart(8, '0')}`;
}

/** Liitteen tiedostopääte: nimen pääte, muuten MIME-alatyyppi, muuten `bin`. */
export function liitePaate(nimi: string, tyyppi: string): string {
  const piste = nimi.lastIndexOf('.');
  const nimiPaate = piste >= 0 ? nimi.slice(piste + 1) : '';
  if (/^[A-Za-z0-9]{1,8}$/.test(nimiPaate)) return nimiPaate.toLowerCase();
  const alatyyppi = tyyppi.split('/')[1] ?? '';
  return /^[a-z0-9]+$/.test(alatyyppi) ? alatyyppi : 'bin';
}

/** Liitteen tiedostonimi (Kitsas: arkistoija.cpp:347-352). `jarjestys` alkaa 1:stä. */
export function liiteTiedosto(
  kausi: string,
  sarja: string,
  tunniste: number,
  jarjestys: number,
  nimi: string,
  tyyppi: string,
): string {
  const nn = String(jarjestys).padStart(2, '0');
  return `${tositeTiedosto(kausi, sarja, tunniste)}_${nn}.${liitePaate(nimi, tyyppi)}`;
}

/** Tiedostonimeksi kelpaava muoto: sallitut `A-Za-zÅÄÖåäö0-9 _-`, muut merkit `_`. */
export function turvallinenNimi(s: string): string {
  const siivottu = s.replace(/[^A-Za-z0-9ÅÄÖåäö _-]/g, '_').trim();
  return siivottu === '' ? 'kirjanpito' : siivottu;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
