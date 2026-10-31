import type { KirjatSilta } from '@penni/tuonti';

/**
 * Kirjanvaihto tarvitsee siltaa laajemmin kuin tuonti, joten portti tarkistaa nimenomaan
 * kirjanvaihtometodin olemassaolon: vanha työpöytäversio voi tarjota `penni`-sillan ilman sitä.
 * Sama periaate kuin täsmäytyksellä (ks. tasmays/silta.ts).
 */
export function onkoKirjatSilta(): boolean {
  const silta = typeof window !== 'undefined' ? window.penni : undefined;
  return typeof (silta as Partial<KirjatSilta> | undefined)?.vaihdaKirja === 'function';
}

export function annaKirjatSilta(): KirjatSilta {
  if (!onkoKirjatSilta())
    throw new Error('Kirjanpidon vaihto on käytettävissä vain työpöytäsovelluksessa.');
  return window.penni as unknown as KirjatSilta;
}

/** Tiedostonimi polusta; toimii sekä macOS- että Windows-poluille. */
export function tiedostonimi(polku: string): string {
  return polku.split(/[\\/]/).pop() ?? polku;
}
