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
