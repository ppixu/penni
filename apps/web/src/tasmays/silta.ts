import type { TasmaysSilta } from '@penni/luku';

/**
 * Täsmäytys tarvitsee siltaa laajemmin kuin tuonti, joten portti tarkistaa nimenomaan
 * täsmäytysmetodin olemassaolon: vanha työpöytäversio voi tarjota `penni`-sillan ilman sitä.
 */
export function onkoTasmaysSilta(): boolean {
  const silta = typeof window !== 'undefined' ? window.penni : undefined;
  return typeof (silta as Partial<TasmaysSilta> | undefined)?.lueAineisto === 'function';
}

export function annaTasmaysSilta(): TasmaysSilta {
  if (!onkoTasmaysSilta())
    throw new Error('Tiliotteen tuonti on käytettävissä vain työpöytäsovelluksessa.');
  return window.penni as unknown as TasmaysSilta;
}
