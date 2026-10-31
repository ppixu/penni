import { readFile } from 'node:fs/promises';
import {
  type LukuEdistyminen,
  type TasmaysAineisto,
  lueAineisto,
  pdfTekstiLukija,
} from '@penni/luku';
import { dialog, ipcMain } from 'electron';
import { type IpcLahettaja, ValitutPolut, tarkistaLahettaja } from './ipcRajaus.js';

/** Se osa Electronin dialog-moduulista jota tarvitaan — injektoitavissa testiä varten. */
export interface Valitsin {
  showOpenDialog(asetukset: {
    title: string;
    filters?: { name: string; extensions: string[] }[];
    properties: ('openFile' | 'openDirectory')[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

/** IPC-tapahtuma käsittelijän näkökulmasta: lähettäjäkehys ja edistymisviestien kanava. */
export interface TasmaysTapahtuma extends IpcLahettaja {
  readonly sender: { send(kanava: 'tasmays:edistyminen', e: LukuEdistyminen): void };
}

/** Levyltä lukeminen — injektoitavissa, jotta testit eivät tarvitse oikeaa PDF-tiliotetta. */
export interface TasmaysLukija {
  lueAineisto(
    tiliote: string,
    kansio: string | null,
    edistyminen: (e: LukuEdistyminen) => void,
  ): Promise<TasmaysAineisto>;
  lueTiedosto(polku: string): Promise<Uint8Array>;
}

const levyLukija: TasmaysLukija = {
  lueAineisto: (tiliote, kansio, edistyminen) =>
    lueAineisto(tiliote, kansio, pdfTekstiLukija(), edistyminen),
  lueTiedosto: async (polku) => new Uint8Array(await readFile(polku)),
};

/**
 * Täsmäytyksen IPC-käsittelijät. Renderöijä ei saa lukea mielivaltaisia polkuja: luettavaksi
 * kelpaavat vain tiedostovalitsimella valitut tiliotteet ja valitun kuittikansion sisältö, ja
 * vain Pennin omalta sivulta (`annaOsoite` = avoimen kirjan paikallinen palvelin) tulleet kutsut.
 */
export function tasmaysKasittelijat(
  valitsin: Valitsin,
  annaOsoite: () => string | null | undefined,
  lukija: TasmaysLukija = levyLukija,
) {
  const valitut = new ValitutPolut();

  async function valitse(
    title: string,
    properties: ('openFile' | 'openDirectory')[],
    filters?: { name: string; extensions: string[] }[],
  ): Promise<string | null> {
    const valinta = await valitsin.showOpenDialog(
      filters ? { title, properties, filters } : { title, properties },
    );
    const polku = valinta.filePaths[0];
    return valinta.canceled || !polku ? null : polku;
  }

  return {
    async valitseTiliote(tapahtuma: IpcLahettaja): Promise<string | null> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      const polku = await valitse(
        'Valitse tiliote',
        ['openFile'],
        [{ name: 'Tiliote (PDF)', extensions: ['pdf'] }],
      );
      if (polku !== null) await valitut.lisaaTiedosto(polku);
      return polku;
    },

    async valitseKuittikansio(tapahtuma: IpcLahettaja): Promise<string | null> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      const polku = await valitse('Valitse kuittikansio', ['openDirectory']);
      if (polku !== null) await valitut.asetaKansio(polku);
      return polku;
    },

    async lueAineisto(
      tapahtuma: TasmaysTapahtuma,
      tiliote: string,
      kansio: string | null,
    ): Promise<TasmaysAineisto> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      await valitut.varmista(tiliote);
      if (kansio !== null) await valitut.varmista(kansio);
      // Alkuperäiset polut eteenpäin: renderöijä näyttää niiden tiedostonimet sellaisinaan, ja
      // kuittien polut (kansio + nimi) palaavat myöhemmin lueTiedostoon, joka tarkistaa ne itse.
      return lukija.lueAineisto(tiliote, kansio, (e) =>
        tapahtuma.sender.send('tasmays:edistyminen', e),
      );
    },

    async lueTiedosto(tapahtuma: IpcLahettaja, polku: string): Promise<Uint8Array> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      return lukija.lueTiedosto(await valitut.varmista(polku));
    },
  };
}

/** Rekisteröi täsmäytyksen IPC-kanavat. Kutsutaan kerran käynnistyksessä. */
export function rekisteroiTasmays(annaOsoite: () => string | null | undefined): void {
  const kasittelijat = tasmaysKasittelijat(dialog, annaOsoite);
  ipcMain.handle('tasmays:valitseTiliote', (tapahtuma) => kasittelijat.valitseTiliote(tapahtuma));
  ipcMain.handle('tasmays:valitseKansio', (tapahtuma) =>
    kasittelijat.valitseKuittikansio(tapahtuma),
  );
  ipcMain.handle('tasmays:lueAineisto', (tapahtuma, tiliote: string, kansio: string | null) =>
    kasittelijat.lueAineisto(tapahtuma, tiliote, kansio),
  );
  ipcMain.handle('tasmays:lueTiedosto', (tapahtuma, polku: string) =>
    kasittelijat.lueTiedosto(tapahtuma, polku),
  );
}
