import type { KysySilta } from '@penni/kysy';
import type { TasmaysSilta } from '@penni/luku';
import type { MalliSilta, SuodatinSilta, TuontiSilta } from '@penni/tuonti';

declare global {
  interface Window {
    // `| undefined` (not just `?`) so tests may reset the bridge with `window.penni = undefined`
    // under exactOptionalPropertyTypes.
    penni?:
      | (TuontiSilta &
          Partial<TasmaysSilta> &
          Partial<KysySilta> &
          Partial<MalliSilta> &
          Partial<SuodatinSilta>)
      | undefined;
  }
}

/** True when running inside the Electron shell (the preload bridge is present). */
export function onkoTyopoyta(): boolean {
  return typeof window !== 'undefined' && window.penni !== undefined;
}

/** The desktop bridge. Throws if called in a plain browser — guard with onkoTyopoyta(). */
export function annaSilta(): TuontiSilta {
  const silta = typeof window !== 'undefined' ? window.penni : undefined;
  if (!silta) throw new Error('Tuonti on käytettävissä vain työpöytäsovelluksessa.');
  return silta;
}
