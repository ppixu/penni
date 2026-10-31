import { type Zippable, unzipSync, zipSync } from 'fflate';

export interface ZipTiedosto {
  /** Polku zipin sisällä, `/`-erottimin. */
  polku: string;
  data: Uint8Array;
  /** Oletuksena pakataan (taso 6); `false` tallentaa sellaisenaan (jo pakatut liitteet). */
  pakkaa?: boolean;
}

export function pakkaa(tiedostot: readonly ZipTiedosto[]): Uint8Array {
  const sisalto: Zippable = {};
  for (const t of tiedostot) {
    sisalto[t.polku] = [t.data, { level: t.pakkaa === false ? 0 : 6 }];
  }
  return zipSync(sisalto);
}

/** Purkaa zipin; hakemistomerkinnät jätetään pois. */
export function pura(zip: Uint8Array): Map<string, Uint8Array> {
  const tulos = new Map<string, Uint8Array>();
  for (const [polku, data] of Object.entries(unzipSync(zip))) {
    if (!polku.endsWith('/')) tulos.set(polku, data);
  }
  return tulos;
}
