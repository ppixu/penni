import type { TasmaysSilta } from '@penni/luku';

/** Selaindemo antaa oman sillan (valmis tiliote ja kuittikansio muistista), ks. demo/. */
let korvaava: TasmaysSilta | null = null;

export function asetaTasmaysSilta(silta: TasmaysSilta | null): void {
  korvaava = silta;
}

/**
 * Täsmäytys tarvitsee siltaa laajemmin kuin tuonti, joten portti tarkistaa nimenomaan
 * täsmäytysmetodin olemassaolon: vanha työpöytäversio voi tarjota `penni`-sillan ilman sitä.
 */
export function onkoTasmaysSilta(): boolean {
  if (korvaava) return true;
  const silta = typeof window !== 'undefined' ? window.penni : undefined;
  return typeof (silta as Partial<TasmaysSilta> | undefined)?.lueAineisto === 'function';
}

export function annaTasmaysSilta(): TasmaysSilta {
  if (korvaava) return korvaava;
  if (!onkoTasmaysSilta())
    throw new Error('Tiliotteen tuonti on käytettävissä vain työpöytäsovelluksessa.');
  return window.penni as unknown as TasmaysSilta;
}
