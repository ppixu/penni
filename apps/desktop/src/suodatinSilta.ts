import { ipcMain } from 'electron';
import type { Suodattimet } from './asetusvarasto.js';
import { type IpcLahettaja, tarkistaLahettaja } from './ipcRajaus.js';

export interface SuodatinRiippuvuudet {
  /** Avoimen kirjan paikallisen palvelimen osoite — ainoa alkuperä jolta kutsut hyväksytään. */
  annaOsoite: () => string | null | undefined;
  asetukset: () => {
    suodattimet(): Suodattimet;
    tallennaSuodatin(nakyma: string, arvo: unknown): void;
  };
}

/**
 * Näkymien suodatinmuistin IPC-käsittelijät (ks. malliSilta.ts). Valinnat ovat asetukset.json:ssa,
 * koska kirjan origin (127.0.0.1:<portti>) vaihtuu joka avauksella eikä localStorage säily.
 */
export function suodatinKasittelijat(r: SuodatinRiippuvuudet) {
  return {
    lue(tapahtuma: IpcLahettaja): Suodattimet {
      tarkistaLahettaja(tapahtuma, r.annaOsoite());
      return r.asetukset().suodattimet();
    },
    tallenna(tapahtuma: IpcLahettaja, nakyma: string, arvo: unknown): void {
      tarkistaLahettaja(tapahtuma, r.annaOsoite());
      r.asetukset().tallennaSuodatin(nakyma, arvo);
    },
  };
}

/** Rekisteröi suodatinmuistin IPC-kanavat. Kutsutaan kerran käynnistyksessä. */
export function rekisteroiSuodattimet(r: SuodatinRiippuvuudet): void {
  const k = suodatinKasittelijat(r);
  ipcMain.handle('suodattimet:lue', (t) => k.lue(t));
  ipcMain.handle('suodattimet:tallenna', (t, nakyma: string, arvo: unknown) =>
    k.tallenna(t, nakyma, arvo),
  );
}
