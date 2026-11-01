import type { MaksumuistutusSyote } from '@penni/engine';
import { centsToWire, wireToCents } from '../wire/euro.js';

/** The wire shape of the POST /maksumuistutukset body. maksu is canonical "N.NN". */
export interface WireMaksumuistutusSyote {
  tositteet: number[];
  pvm: string;
  erapvm?: string;
  maksu?: string | number;
  korko: boolean;
  viivkorko?: number;
  [key: string]: unknown;
}

export function encodeMaksumuistutusSyote(s: MaksumuistutusSyote): WireMaksumuistutusSyote {
  const w: WireMaksumuistutusSyote = { tositteet: s.tositteet, pvm: s.pvm, korko: s.korko };
  if (s.erapvm !== undefined) w.erapvm = s.erapvm;
  if (s.maksu !== undefined) w.maksu = centsToWire(s.maksu);
  if (s.viivkorko !== undefined) w.viivkorko = s.viivkorko;
  return w;
}

export function decodeMaksumuistutusSyote(w: WireMaksumuistutusSyote): MaksumuistutusSyote {
  const s: MaksumuistutusSyote = {
    tositteet: w.tositteet.map(Number),
    pvm: String(w.pvm),
    korko: Boolean(w.korko),
  };
  if (w.erapvm != null) s.erapvm = String(w.erapvm);
  if (w.maksu != null) s.maksu = wireToCents(w.maksu);
  if (w.viivkorko != null) s.viivkorko = Number(w.viivkorko);
  return s;
}
