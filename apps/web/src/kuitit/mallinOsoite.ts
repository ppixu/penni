import { LUKUMALLI } from '@penni/engine';
import type { MallinLatausAsetukset } from './paattely.js';

const HF = 'https://huggingface.co/';
const ETUOSA = `${HF}${LUKUMALLI.id}/resolve/`;

/** transformers.js:n `env.fetch`-koukun muoto. */
export type MallinHaku = (osoite: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Lukumallin hakuosoite: `https://huggingface.co/<lukumalli>/resolve/<mikä tahansa>/<tiedosto>`
 * kiinnitetylle revisiolle ja tarvittaessa `kautta`-isännän kautta (työpöydällä pääprosessin
 * `penni-malli://hf/`-välimuisti). transformers.js tunnustelee tokenisoija- ja prosessoritiedostot
 * revisiolla `main` ja vain http(s)-osoitteista, joten etäisäntä pysyy https:nä ja ohjaus tehdään
 * vasta haun hetkellä. Muut osoitteet (esim. tekstimalli) palautetaan sellaisenaan.
 */
export function mallinOsoite(osoite: string, kautta?: string): string {
  if (!osoite.startsWith(ETUOSA)) return osoite;
  const loppu = osoite.slice(ETUOSA.length);
  const erotin = loppu.indexOf('/');
  if (erotin <= 0 || erotin === loppu.length - 1) return osoite;
  return `${kautta ?? HF}${LUKUMALLI.id}/resolve/${LUKUMALLI.revisio}/${loppu.slice(erotin + 1)}`;
}

/** Haku, joka ohjaa lukumallin osoitteet; metodi ja otsakkeet (myös Range) välitetään sellaisinaan. */
export function luoMallinHaku(haku: MallinHaku, kautta?: string): MallinHaku {
  return (osoite, init) => haku(mallinOsoite(String(osoite), kautta), init);
}

/** Asettaa transformers.js:n ympäristön latausasetusten mukaiseksi (päättelytyöntekijä kutsuu). */
export function kytkeMallinHaku(
  env: { fetch: unknown; useBrowserCache: boolean },
  asetukset: MallinLatausAsetukset,
  perusHaku: MallinHaku,
): void {
  env.fetch = luoMallinHaku(perusHaku, asetukset.kautta);
  env.useBrowserCache = asetukset.selainValimuisti;
}
