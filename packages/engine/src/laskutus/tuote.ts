import { roundHalfAway } from '@penni/euro';
import { AlvKoodi } from '../alv/koodit.js';
import type { IsoDate, TositeRivi } from '../vouchers/types.js';
import { paivitaMyyntiAlvProsentti } from './toisto.js';

/** Tuote (tuoterekisterin rivi): hinta on euroina (`number`), pyöristys vasta rivisummassa. */
export interface Tuote {
  id: number;
  nimike: string;
  unKoodi?: string; // yksikkökoodi (UN/ECE rec 20, esim. "C62")
  yksikko?: string;
  aNetto: number; // á-hinta alvittomana, euroa
  alvKoodi: number;
  alvProsentti: number;
  tili?: number;
  kohdennus?: number;
  koodi?: string;
  [avain: string]: unknown; // tuntemattomat avaimet säilyvät sellaisenaan
}

/**
 * Uusi/päivitettävä tuote; id annettu => päivitys, puuttuu => lisäys.
 * Kentät kirjoitettu auki (ei Omit), koska indeksisignatuuri pudottaisi nimetyt kentät.
 */
export interface UusiTuote {
  id?: number;
  nimike: string;
  unKoodi?: string;
  yksikko?: string;
  aNetto: number;
  alvKoodi: number;
  alvProsentti: number;
  tili?: number;
  kohdennus?: number;
  koodi?: string;
  [avain: string]: unknown;
}

/**
 * Tuotteen poiminta laskuriville (Kitsas TositeRivit::lisaaTuote, tositerivit.cpp:380-417).
 * Hinta ja alv kopioidaan riville; `tuote` jää viittaukseksi. Vanha yleinen kanta (24, 25.5, …)
 * muuttuu `yleinenAlv(pvm)`:ksi vain MYYNNIT_NETTO-tuotteella; alennetut kannat säilyvät.
 * Alv-velvoittamaton: alvKoodi 0 ja alvProsentti 0. Yksikkö: `unKoodi` voittaa; pelkkä vapaa
 * `yksikko` kopioituu ilman unKoodia; ei kumpaakaan => 'C62'. Määrittelemättömät kentät jätetään pois.
 */
export function riviTuotteesta(
  tuote: Tuote,
  pvm: IsoDate,
  alvVelvollinen: boolean,
): Partial<TositeRivi> {
  const yksikko: Partial<TositeRivi> = tuote.unKoodi
    ? { unKoodi: tuote.unKoodi }
    : tuote.yksikko
      ? { yksikko: tuote.yksikko }
      : { unKoodi: 'C62' };
  return {
    selite: tuote.nimike,
    ...yksikko,
    aNetto: tuote.aNetto,
    alvKoodi: alvVelvollinen ? tuote.alvKoodi : AlvKoodi.EIALV,
    alvProsentti: alvVelvollinen
      ? paivitaMyyntiAlvProsentti(tuote.alvKoodi, tuote.alvProsentti, pvm)
      : 0,
    ...(tuote.tili !== undefined ? { tili: tuote.tili } : {}),
    ...(tuote.kohdennus !== undefined ? { kohdennus: tuote.kohdennus } : {}),
    tuote: tuote.id,
  };
}

/**
 * Nettohinta bruttohinnasta (euroa sisään, euroa ulos): brutto*100/(100+p), pyöristetty
 * enintään neljään desimaaliin (puoli poispäin nollasta), kuten `aNetto` syötetään lomakkeella.
 */
export function nettoBrutosta(brutto: number, alvProsentti: number): number {
  if (alvProsentti === 0) return brutto;
  return roundHalfAway(((brutto * 100) / (100 + alvProsentti)) * 10000) / 10000;
}
