import type { Kuitti, Kuittilahde, Tiliote } from '@penni/engine';

export type LukuVirheKoodi = 'EI_TEKSTIA' | 'VAARA_MUOTO' | 'EI_TIEDOSTOJA';

/** Luettavan aineiston virhe, jonka käyttöliittymä osaa kääntää ohjeeksi. */
export class LukuVirhe extends Error {
  readonly koodi: LukuVirheKoodi;
  constructor(koodi: LukuVirheKoodi, viesti: string) {
    super(viesti);
    this.name = 'LukuVirhe';
    this.koodi = koodi;
  }
}

/** Yhden kuitin lukija. Maksullinen paikallinen näkömalli on tämän toinen toteutus. */
export interface KuittiLukija {
  /** Lukijan nimi käyttöliittymään ja lokiin, esim. 'PDF-teksti'. */
  readonly nimi: string;
  lue(tiedosto: string): Promise<{ ok: true; kuitti: Kuitti } | { ok: false; virhe: string }>;
}

export interface LukemattaJaanyt {
  tiedosto: string;
  syy: string;
}

export interface LukuEdistyminen {
  vaihe: 'tiliote' | 'kuitit';
  valmiina: number;
  yhteensa: number;
  tiedosto?: string;
}

export interface TasmaysAineisto {
  /** Luettu tiliote: muoto, tapahtumat sekä kuukausitiliotteelta kausi ja alku-/loppusaldo. */
  tiliote: Tiliote & { tiedosto: string };
  kuitit: Kuittilahde[];
  lukematta: LukemattaJaanyt[];
}

/** Työpöytäsilta: natiivivalitsimet + luku. Renderöijä käyttää vain näitä tyyppejä. */
export interface TasmaysSilta {
  valitseTiliote(): Promise<string | null>;
  valitseKuittikansio(): Promise<string | null>;
  /** `kansio` = null: luetaan pelkkä tiliote, jolloin jokainen rivi on kuititon. */
  lueAineisto(
    tiliote: string,
    kansio: string | null,
    edistyminen: (e: LukuEdistyminen) => void,
  ): Promise<TasmaysAineisto>;
  lueTiedosto(polku: string): Promise<Uint8Array>;
}
