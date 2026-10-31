import type { KirjaTiedot } from '@penni/tuonti';
import { ipcMain } from 'electron';
import { type IpcLahettaja, tarkistaLahettaja } from './ipcRajaus.js';

export interface KirjatRiippuvuudet {
  /** Avoimen kirjan paikallisen palvelimen osoite — ainoa alkuperä jolta kutsut hyväksytään. */
  annaOsoite: () => string | null | undefined;
  /** Avoimen kirjan polku; null kun auki on sisäinen oletuskirja. */
  nykyinen: () => string | null;
  viimeisimmat: () => string[];
  /** Vaihtaa sovelluksen näyttämään annettua kirjaa (paa.ts:n avaaKirja). */
  avaaKirja: (polku: string) => Promise<void>;
  /** Natiivi avausdialogi + avaus (paa.ts:n valitseJaAvaa). */
  valitseJaAvaa: () => Promise<void>;
  /** Poistaa polun viimeisimpien listalta (tiedostoon ei kosketa) ja päivittää valikon. */
  poistaViimeisin: (polku: string) => void;
}

/**
 * Kirjanvaihdon IPC-käsittelijät. Sivu saa avata vain polun, joka on jo viimeisimpien listalla
 * — eli jonka käyttäjä on itse joskus avannut valikosta tai dialogista. Muuten sivun skripti
 * voisi avata (ja SQLite-migraatioilla muokata) mitä tahansa käyttäjän tiedostoa.
 */
export function kirjatKasittelijat(riippuvuudet: KirjatRiippuvuudet) {
  const { annaOsoite } = riippuvuudet;
  return {
    kirjat(tapahtuma: IpcLahettaja): KirjaTiedot {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      return { nykyinen: riippuvuudet.nykyinen(), viimeisimmat: riippuvuudet.viimeisimmat() };
    },

    async vaihda(tapahtuma: IpcLahettaja, polku: string): Promise<void> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      if (!riippuvuudet.viimeisimmat().includes(polku)) {
        throw new Error(
          `Pääsy estetty: ${polku} ei ole viimeksi avattujen kirjanpitojen listalla.`,
        );
      }
      await riippuvuudet.avaaKirja(polku);
    },

    async valitse(tapahtuma: IpcLahettaja): Promise<void> {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      await riippuvuudet.valitseJaAvaa();
    },

    /** Avoin kirja jää listalle: se lisättäisiin takaisin heti seuraavassa avauksessa. */
    poista(tapahtuma: IpcLahettaja, polku: string): void {
      tarkistaLahettaja(tapahtuma, annaOsoite());
      if (polku === riippuvuudet.nykyinen()) {
        throw new Error('Avointa kirjanpitoa ei voi poistaa viimeksi avattujen listalta.');
      }
      riippuvuudet.poistaViimeisin(polku);
    },
  };
}

/** Rekisteröi kirjanvaihdon IPC-kanavat. Kutsutaan kerran käynnistyksessä. */
export function rekisteroiKirjat(riippuvuudet: KirjatRiippuvuudet): void {
  const kasittelijat = kirjatKasittelijat(riippuvuudet);
  ipcMain.handle('kirjat:tiedot', (tapahtuma) => kasittelijat.kirjat(tapahtuma));
  ipcMain.handle('kirjat:vaihda', (tapahtuma, polku: string) =>
    kasittelijat.vaihda(tapahtuma, polku),
  );
  ipcMain.handle('kirjat:valitse', (tapahtuma) => kasittelijat.valitse(tapahtuma));
  ipcMain.handle('kirjat:poista', (tapahtuma, polku: string) =>
    kasittelijat.poista(tapahtuma, polku),
  );
}
