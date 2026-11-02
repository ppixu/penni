import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { type TiliotetiedostonValinnat, onkoCsvSarakkeet } from '@penni/engine';
import {
  type LukuEdistyminen,
  type TasmaysAineisto,
  type TilioteEsikatselu,
  esikatseleTiliote,
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
    valinnat?: TiliotetiedostonValinnat,
  ): Promise<TasmaysAineisto>;
  /** Tunnistaa tiedoston muodon ja ehdottaa CSV:n sarakejaon. Saa vain pääprosessin lukemat tavut. */
  esikatseleTiliote(tavut: Uint8Array): TilioteEsikatselu;
  lueTiedosto(polku: string): Promise<Uint8Array>;
}

/** Tiliotetiedoston enimmäiskoko: suurempaa ei lueta pääprosessin muistiin. */
export const TILIOTTEEN_ENIMMAISKOKO = 50 * 1024 * 1024;

const liianSuuri = () => new Error('Tiedosto on liian suuri tiliotteeksi.');

async function tarkistaKoko(polku: string): Promise<void> {
  if ((await stat(polku)).size > TILIOTTEEN_ENIMMAISKOKO) throw liianSuuri();
}

/**
 * Renderöijän lähettämät valinnat ennen jäsentäjää: puuttuvat tai objekti, jonka sarakejako
 * puuttuu tai on rakenteeltaan kelvollinen. Eteenpäin menee vain tunnettu kenttä.
 */
function tarkistaValinnat(valinnat: unknown): TiliotetiedostonValinnat | undefined {
  if (valinnat === undefined) return undefined;
  if (typeof valinnat === 'object' && valinnat !== null) {
    const { csvSarakkeet } = valinnat as { csvSarakkeet?: unknown };
    if (csvSarakkeet === undefined) return {};
    if (onkoCsvSarakkeet(csvSarakkeet)) return { csvSarakkeet };
  }
  throw new Error('Sarakejako on virheellinen.');
}

const levyLukija: TasmaysLukija = {
  lueAineisto: (tiliote, kansio, edistyminen, valinnat) =>
    lueAineisto(tiliote, kansio, pdfTekstiLukija(), edistyminen, valinnat),
  esikatseleTiliote: (tavut) => esikatseleTiliote(tavut),
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
        [
          // TITO-tiedostoilla on usein outo tai ei lainkaan päätettä, siksi myös "Kaikki tiedostot".
          {
            name: 'Tiliote (PDF, XML, CSV, TITO)',
            extensions: ['pdf', 'xml', 'csv', 'txt', 'tito', 'nda'],
          },
          { name: 'Kaikki tiedostot', extensions: ['*'] },
        ],
      );
      if (polku !== null) await valitut.lisaaTiedosto(polku);
      return polku;
    },

    /**
     * Pudotetun tai `<input>`-valitun tiedoston polku sallittujen listalle. Polun antaa esilataus
     * (`webUtils.getPathForFile`), mutta renderöijäkään ei voi väärentää levyllä olevaa Filea —
     * muistissa luodulle Filelle polku on ''. Hylätyn polun arvoa ei toisteta virheviestissä.
     */
    async pudotettu(tapahtuma: IpcLahettaja, polku: string): Promise<string> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      const virhe = new Error('Pudotettu tiedosto ei ole luettavissa.');
      if (typeof polku !== 'string' || polku === '' || !isAbsolute(polku)) throw virhe;
      const tiedot = await stat(polku).catch(() => {
        throw virhe;
      });
      if (!tiedot.isFile()) throw virhe;
      if (tiedot.size > TILIOTTEEN_ENIMMAISKOKO) throw liianSuuri();
      try {
        await valitut.lisaaTiedosto(polku);
      } catch {
        throw virhe;
      }
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
      valinnat?: unknown,
    ): Promise<TasmaysAineisto> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      const tarkistetut = tarkistaValinnat(valinnat);
      await tarkistaKoko(await valitut.varmista(tiliote));
      if (kansio !== null) await valitut.varmista(kansio);
      // Alkuperäiset polut eteenpäin: renderöijä näyttää niiden tiedostonimet sellaisinaan, ja
      // kuittien polut (kansio + nimi) palaavat myöhemmin lueTiedostoon, joka tarkistaa ne itse.
      return lukija.lueAineisto(
        tiliote,
        kansio,
        (e) => tapahtuma.sender.send('tasmays:edistyminen', e),
        tarkistetut,
      );
    },

    /** Muoto ja CSV:n sarakeehdotus; tavut luetaan täällä, vain sallitulta polulta. */
    async esikatsele(tapahtuma: IpcLahettaja, polku: string): Promise<TilioteEsikatselu> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      const sallittu = await valitut.varmista(polku);
      await tarkistaKoko(sallittu);
      return lukija.esikatseleTiliote(await lukija.lueTiedosto(sallittu));
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
  ipcMain.handle('tasmays:pudotettu', (tapahtuma, polku: string) =>
    kasittelijat.pudotettu(tapahtuma, polku),
  );
  ipcMain.handle('tasmays:esikatsele', (tapahtuma, polku: string) =>
    kasittelijat.esikatsele(tapahtuma, polku),
  );
  ipcMain.handle(
    'tasmays:lueAineisto',
    // Valinnat tulevat renderöijältä tarkistamattomina; lueAineisto tarkistaa ne.
    (tapahtuma, tiliote: string, kansio: string | null, valinnat?: unknown) =>
      kasittelijat.lueAineisto(tapahtuma, tiliote, kansio, valinnat),
  );
  ipcMain.handle('tasmays:lueTiedosto', (tapahtuma, polku: string) =>
    kasittelijat.lueTiedosto(tapahtuma, polku),
  );
}
