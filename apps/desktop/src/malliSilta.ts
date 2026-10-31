import { ipcMain } from 'electron';
import { type IpcLahettaja, tarkistaLahettaja } from './ipcRajaus.js';

export interface MalliRiippuvuudet {
  /** Avoimen kirjan paikallisen palvelimen osoite — ainoa alkuperä jolta kutsut hyväksytään. */
  annaOsoite: () => string | null | undefined;
  asetukset: () => { malliLupa(): boolean; annaMalliLupa(): void };
}

/** Kuitinlukumallin suostumuksen IPC-käsittelijät (ks. kirjatSilta.ts:n lähettäjätarkistus). */
export function malliKasittelijat(r: MalliRiippuvuudet) {
  return {
    lupa(tapahtuma: IpcLahettaja): boolean {
      tarkistaLahettaja(tapahtuma, r.annaOsoite());
      return r.asetukset().malliLupa();
    },
    annaLupa(tapahtuma: IpcLahettaja): void {
      tarkistaLahettaja(tapahtuma, r.annaOsoite());
      r.asetukset().annaMalliLupa();
    },
  };
}

/** Rekisteröi suostumuksen IPC-kanavat. Kutsutaan kerran käynnistyksessä. */
export function rekisteroiMalli(r: MalliRiippuvuudet): void {
  const k = malliKasittelijat(r);
  ipcMain.handle('malli:lupa', (t) => k.lupa(t));
  ipcMain.handle('malli:annaLupa', (t) => k.annaLupa(t));
}
