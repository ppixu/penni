import type { HyvityslaskuSyote } from '@penni/engine';

/** The wire shape of the POST /hyvityslaskut body. */
export interface WireHyvityslaskuSyote {
  alkuperainenTosite: number;
  pvm: string;
  otsikko?: string;
  [key: string]: unknown;
}

export function encodeHyvityslaskuSyote(s: HyvityslaskuSyote): WireHyvityslaskuSyote {
  const w: WireHyvityslaskuSyote = { alkuperainenTosite: s.alkuperainenTosite, pvm: s.pvm };
  if (s.otsikko !== undefined) w.otsikko = s.otsikko;
  return w;
}

export function decodeHyvityslaskuSyote(w: WireHyvityslaskuSyote): HyvityslaskuSyote {
  const s: HyvityslaskuSyote = {
    alkuperainenTosite: Number(w.alkuperainenTosite),
    pvm: String(w.pvm),
  };
  if (w.otsikko != null) s.otsikko = String(w.otsikko);
  return s;
}
