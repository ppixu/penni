export interface WireMarginaaliveroSyote {
  alkupvm: string;
  loppupvm: string;
}

export function encodeMarginaaliveroSyote(s: {
  alkupvm: string;
  loppupvm: string;
}): WireMarginaaliveroSyote {
  return { alkupvm: s.alkupvm, loppupvm: s.loppupvm };
}

export function decodeMarginaaliveroSyote(w: WireMarginaaliveroSyote): {
  alkupvm: string;
  loppupvm: string;
} {
  return { alkupvm: String(w.alkupvm), loppupvm: String(w.loppupvm) };
}
