import { LAHDEKOODI_URL } from '@penni/contract';
import { version } from '../../package.json';

/** Sovelluksen versio (apps/web/package.json). Työpöytäsovellus näyttää saman web-rakennelman. */
export const VERSIO = version;

/**
 * Lähdekoodin osoite Tietoja-näkymään ja kirjautumissivulle. Muokatun version ylläpitäjä asettaa
 * oman lähdekoodinsa osoitteen rakennusaikaisella VITE_LAHDEKOODI_URL-muuttujalla (AGPL §13),
 * kuten palvelimille PENNI_LAHDEKOODI_URL / LAHDEKOODI_URL.
 */
export const LAHDEKOODI: string = import.meta.env.VITE_LAHDEKOODI_URL || LAHDEKOODI_URL;
