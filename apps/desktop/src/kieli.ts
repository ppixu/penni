/** Sovelluksen käyttöliittymäkieli: Chromium muotoilee mm. <input type=date> -kentät tällä. */
export const SOVELLUKSEN_KIELI = 'fi-FI';

/** Electronin `app`-olion osa, jota kielen asetus tarvitsee (testattavissa ilman Electronia). */
export interface KomentoriviSovellus {
  commandLine: { appendSwitch: (kytkin: string, arvo?: string) => void };
}

/**
 * Asettaa Chromiumin kieleksi suomen. Ilman tätä Chromium käyttää oletuskieltä (en-US) ja
 * päivämääräkentät näkyvät muodossa mm/dd/yyyy. Kutsuttava ennen `ready`-tapahtumaa.
 */
export function asetaSovelluksenKieli(sovellus: KomentoriviSovellus): void {
  sovellus.commandLine.appendSwitch('lang', SOVELLUKSEN_KIELI);
}
