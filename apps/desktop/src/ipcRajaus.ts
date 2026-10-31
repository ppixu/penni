import { realpath } from 'node:fs/promises';
import { sep } from 'node:path';

/**
 * Se osa Electronin IpcMainInvokeEventista jota rajaus tarvitsee — rakenteellinen tyyppi, jotta
 * testit voivat antaa pelkän `{ senderFrame: { url } }`-olion.
 */
export interface IpcLahettaja {
  readonly senderFrame?: { readonly url: string } | null;
}

/**
 * Heittää, ellei IPC-kutsu tule Pennin omalta sivulta eli avoimen kirjan paikalliselta
 * palvelimelta (`istunto.osoite`). Esilataus annetaan vain pääikkunalle, mutta pääikkuna voi
 * silti päätyä näyttämään vierasta sisältöä (navigointi, upotettu kehys) — sellaisen sivun ei
 * pidä päästä käsiksi tiedostojärjestelmään. Puuttuva lähettäjäkehys tai osoite = hylkäys.
 */
export function tarkistaLahettaja(
  tapahtuma: IpcLahettaja,
  sallittuOsoite: string | null | undefined,
): void {
  const url = tapahtuma.senderFrame?.url;
  const lahettaja = alkupera(url);
  const sallittu = alkupera(sallittuOsoite);
  if (lahettaja === null || sallittu === null || lahettaja !== sallittu) {
    throw new Error(
      `IPC-kutsu hylättiin: lähettäjä ${url || '(tuntematon)'} ei ole Pennin oma sivu.`,
    );
  }
}

function alkupera(osoite: string | null | undefined): string | null {
  if (!osoite) return null;
  try {
    const origin = new URL(osoite).origin;
    // Läpinäkymättömät alkuperät (file:, data:, about:…) ovat kaikki "null" — eivät koskaan kelpaa.
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Pääprosessin muisti siitä, mitä käyttäjä on itse valinnut tiedostovalitsimella. Renderöijän
 * antama polku kelpaa luettavaksi vain, jos sen realpath on jokin valituista tiedostoista tai
 * on valitun kansion sisällä. Realpath ratkaisee sekä `../`-kierrot että symlinkit, joten
 * kansion sisällä oleva linkki kansion ulkopuolelle ei kelpaa.
 */
export class ValitutPolut {
  private readonly tiedostot = new Set<string>();
  private kansio: string | null = null;

  /** Muistaa dialogista palautetun tiedoston. Kaikki tämän istunnon valinnat pysyvät sallittuina. */
  async lisaaTiedosto(polku: string): Promise<void> {
    this.tiedostot.add(await realpath(polku));
  }

  /** Muistaa dialogista palautetun kansion; uusi valinta korvaa edellisen. */
  async asetaKansio(polku: string): Promise<void> {
    this.kansio = await realpath(polku);
  }

  /**
   * Palauttaa polun realpathin, jos se on sallittu; muuten heittää. Olematon polku hylätään
   * samalla viestillä, jottei renderöijä voi kysellä mielivaltaisten tiedostojen olemassaoloa.
   */
  async varmista(polku: string): Promise<string> {
    let todellinen: string;
    try {
      todellinen = await realpath(polku);
    } catch {
      throw estetty(polku);
    }
    if (this.tiedostot.has(todellinen) || this.kansionSisalla(todellinen)) return todellinen;
    throw estetty(polku);
  }

  private kansionSisalla(todellinen: string): boolean {
    if (this.kansio === null) return false;
    if (todellinen === this.kansio) return true;
    const etuliite = this.kansio.endsWith(sep) ? this.kansio : this.kansio + sep;
    return todellinen.startsWith(etuliite);
  }
}

function estetty(polku: string): Error {
  return new Error(
    `Pääsy estetty: ${polku} ei ole tiedostovalitsimella valittu tiedosto eikä valitun kansion sisällä.`,
  );
}
