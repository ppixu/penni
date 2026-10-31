export type IsoDateTime = string;

export interface Kayttaja {
  id: number;
  email: string;
  nimi?: string;
  luotu: IsoDateTime;
}
export interface KayttajaTiedot extends Kayttaja {
  salasanaHash: string;
}
export interface Sessio {
  tokenHash: string;
  kayttajaId: number;
  luotu: IsoDateTime;
  vanhenee: IsoDateTime;
  viimeksiKaytetty: IsoDateTime;
}

/** Kontrollitason tallennusportti — pelkkä I/O, ei salasana-/sessiologiikkaa. */
export interface ControlStore {
  /** Heittää TunnistusVirhe('EMAIL_VARATTU') jos sähköposti on jo käytössä. */
  luoKayttaja(t: {
    email: string;
    salasanaHash: string;
    nimi?: string;
    aika: IsoDateTime;
  }): Promise<Kayttaja>;
  haeKayttajaTiedot(id: number): Promise<KayttajaTiedot | null>;
  haeKayttajaEmaililla(email: string): Promise<KayttajaTiedot | null>;
  paivitaSalasana(id: number, salasanaHash: string): Promise<void>;
  luoSessio(s: Sessio): Promise<void>;
  haeSessio(tokenHash: string): Promise<Sessio | null>;
  poistaSessio(tokenHash: string): Promise<void>;
}

/** Riisu tiiviste pois — julkinen käyttäjäesitys. */
export function julkinen(t: KayttajaTiedot): Kayttaja {
  return {
    id: t.id,
    email: t.email,
    luotu: t.luotu,
    ...(t.nimi !== undefined ? { nimi: t.nimi } : {}),
  };
}
