export interface WireVanhennusSyote {
  loppupvm: string;
}

export function encodeVanhennusSyote(syote: { loppupvm: string }): WireVanhennusSyote {
  return { loppupvm: syote.loppupvm };
}

export function decodeVanhennusSyote(w: WireVanhennusSyote): { loppupvm: string } {
  return { loppupvm: String(w.loppupvm) };
}
