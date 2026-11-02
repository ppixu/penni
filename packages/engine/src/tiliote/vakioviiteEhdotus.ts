import { tarkistaRfViite } from '@penni/validator';
import type { Vakioviite } from '../laskutus/vakioviite.js';
import type { KirjausEhdotus } from './ehdotaKirjaus.js';
import type { Tilitapahtuma } from './poimiTiliote.js';

/**
 * Viite vertailumuotoon: välilyönnit pois; kelvollisesta RF-viitteestä jää RF-etuliitteen ja
 * kahden tarkistenumeron jälkeinen osa; etunollat pois. Tyhjä viite (tai pelkkiä nollia)
 * palauttaa tyhjän merkkijonon. Kitsas vertaa viitteitä samoin (tuontitulkki.cpp:59-100).
 */
export function normalisoiViite(viite: string): string {
  let s = viite.replace(/\s/g, '');
  if (/^rf/i.test(s) && tarkistaRfViite(s)) s = s.slice(4);
  return s.replace(/^0+/, '');
}

/**
 * Vakioviitteen mukainen kirjausehdotus: saapuvan maksun (`maara > 0`) viite vastaa
 * vakioviitettä → vastatili, kohdennus ja otsikko vakioviitteeltä, ei alv:tä. Lähtevät maksut
 * ja tuntemattomat viitteet eivät saa ehdotusta (kutsuja jatkaa historiaan).
 */
export function vakioviiteEhdotus(
  tapahtuma: Tilitapahtuma,
  vakioviitteet: readonly Vakioviite[],
): KirjausEhdotus | undefined {
  if (tapahtuma.maara <= 0 || !tapahtuma.viite) return undefined;
  const viite = normalisoiViite(tapahtuma.viite);
  if (viite === '') return undefined;
  const osuma = vakioviitteet.find((v) => normalisoiViite(v.viite) === viite);
  if (!osuma) return undefined;
  const e: KirjausEhdotus = {
    tili: osuma.tili,
    alvKoodi: 0,
    alvProsentti: 0,
    otsikko: osuma.otsikko,
    peruste: 'vakioviite',
  };
  if (osuma.kohdennus !== undefined) e.kohdennus = osuma.kohdennus;
  return e;
}
