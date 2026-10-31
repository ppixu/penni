import type { KitsasYhteenveto, TuontiEdistyminen } from '@penni/tuonti';
import { lueKitsas, yhteenveto } from '@penni/tuonti';
import { dialog, ipcMain } from 'electron';
import { type IpcLahettaja, ValitutPolut, tarkistaLahettaja } from './ipcRajaus.js';
import { type TuonninTulos, tuoKirja } from './tuoKirja.js';

/** Se osa Electronin dialog-moduulista jota tuonti tarvitsee — injektoitavissa testiä varten. */
export interface TuontiDialogi {
  showOpenDialog(asetukset: {
    title: string;
    filters: { name: string; extensions: string[] }[];
    properties: 'openFile'[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(asetukset: {
    title: string;
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

export interface TuontiTapahtuma extends IpcLahettaja {
  readonly sender: { send(kanava: 'tuonti:edistyminen', e: TuontiEdistyminen): void };
}

export interface TuontiRiippuvuudet {
  /** Avoimen kirjan paikallisen palvelimen osoite — ainoa alkuperä jolta kutsut hyväksytään. */
  annaOsoite: () => string | null | undefined;
  /** Vaihtaa sovelluksen näyttämään annettua kirjaa (paa.ts:n avaaKirja). */
  avaaKirja: (polku: string) => Promise<void>;
  esikatsele?: (polku: string) => KitsasYhteenveto;
  tuo?: (
    lahde: string,
    kohde: string,
    edistyminen: (e: TuontiEdistyminen) => void,
  ) => Promise<TuonninTulos>;
}

/**
 * Kitsas-tuonnin IPC-käsittelijät. Renderöijän antamat polut kelpaavat vain, jos pääprosessi on
 * itse saanut ne tiedostovalitsimesta: `tuonti:suorita` lukee vain `tuonti:valitse`-dialogissa
 * valitun Kitsas-tiedoston, ja `kirja:avaa` avaa vain tässä istunnossa tuodun kirjan — muuten
 * sivun skripti voisi lukea tai (SQLite-migraatioilla) muokata mitä tahansa käyttäjän tiedostoa.
 */
export function tuontiKasittelijat(dialogi: TuontiDialogi, riippuvuudet: TuontiRiippuvuudet) {
  const { annaOsoite, avaaKirja } = riippuvuudet;
  const esikatsele = riippuvuudet.esikatsele ?? ((polku) => yhteenveto(lueKitsas(polku)));
  const tuo = riippuvuudet.tuo ?? tuoKirja;
  const lahteet = new ValitutPolut();
  const tuodut = new ValitutPolut();

  return {
    async valitse(
      tapahtuma: IpcLahettaja,
    ): Promise<{ polku: string; yhteenveto: KitsasYhteenveto } | null> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      const valinta = await dialogi.showOpenDialog({
        title: 'Valitse Kitsas-kirjanpito',
        filters: [{ name: 'Kitsas-kirjanpito', extensions: ['kitsas'] }],
        properties: ['openFile'],
      });
      const polku = valinta.filePaths[0];
      if (valinta.canceled || !polku) return null;
      await lahteet.lisaaTiedosto(polku);
      // lueKitsas heittää TuontiVirheen; Electron välittää viestin renderöijälle sellaisenaan.
      return { polku, yhteenveto: esikatsele(polku) };
    },

    async suorita(tapahtuma: TuontiTapahtuma, polku: string): Promise<TuonninTulos | null> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      await lahteet.varmista(polku);
      const valinta = await dialogi.showSaveDialog({
        title: 'Tallenna kirjanpito nimellä',
        defaultPath: 'kirjanpito.penni',
        filters: [{ name: 'Penni-kirjanpito', extensions: ['penni'] }],
      });
      if (valinta.canceled || !valinta.filePath) return null;
      const tulos = await tuo(polku, valinta.filePath, (e) =>
        tapahtuma.sender.send('tuonti:edistyminen', e),
      );
      await tuodut.lisaaTiedosto(tulos.kohde);
      return tulos;
    },

    async avaa(tapahtuma: IpcLahettaja, polku: string): Promise<void> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      await tuodut.varmista(polku);
      await avaaKirja(polku);
    },
  };
}

/** Rekisteröi Kitsas-tuonnin ja kirjan avauksen IPC-kanavat. Kutsutaan kerran käynnistyksessä. */
export function rekisteroiTuonti(riippuvuudet: TuontiRiippuvuudet): void {
  const kasittelijat = tuontiKasittelijat(dialog, riippuvuudet);
  ipcMain.handle('tuonti:valitse', (tapahtuma) => kasittelijat.valitse(tapahtuma));
  ipcMain.handle('tuonti:suorita', (tapahtuma, polku: string) =>
    kasittelijat.suorita(tapahtuma, polku),
  );
  ipcMain.handle('kirja:avaa', (tapahtuma, polku: string) => kasittelijat.avaa(tapahtuma, polku));
}
