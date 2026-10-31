import type { KysySilta } from '@penni/kysy';

/**
 * Kysy tarvitsee siltaa laajemmin kuin muut ominaisuudet, joten portti tarkistaa nimenomaan
 * kysy-metodin olemassaolon: vanha työpöytäversio voi tarjota `penni`-sillan ilman sitä. Sama
 * periaate kuin täsmäytyksellä (ks. tasmays/silta.ts).
 */
export function onkoKysySilta(): boolean {
  const silta = typeof window !== 'undefined' ? window.penni : undefined;
  return typeof (silta as Partial<KysySilta> | undefined)?.kysy === 'function';
}

export function annaKysySilta(): KysySilta {
  if (!onkoKysySilta()) throw new Error('Kysy on käytettävissä vain työpöytäsovelluksessa.');
  return window.penni as unknown as KysySilta;
}
