/**
 * Historiassa siirtyminen pääprosessista. Windowsissa hiiren sivunapit ja näppäimistöjen
 * selainnäppäimet saapuvat BrowserWindowin `app-command`-tapahtumana (Linuxissa samoin
 * browser-backward/-forward), eivät sivulle — ne välitetään renderöijälle, joka siirtyy
 * reitittimen historiassa (ei webContentsin omassa, jotta sovelluksen alusta ei pääse ohi).
 */

/** Pääprosessi → sivu. Sama merkkijono on esilataus.cts:ssä (esilataus ei voi tuoda moduuleja). */
export const NAVIGOINTI_KANAVA = 'navigointi:siirry';

export type NavigointiSuunta = 'takaisin' | 'eteenpain';

export function appKomennonSuunta(komento: string): NavigointiSuunta | null {
  if (komento === 'browser-backward') return 'takaisin';
  if (komento === 'browser-forward') return 'eteenpain';
  return null;
}

/** `ikkuna.on('app-command', …)`-kuuntelija, joka lähettää navigointikomennot eteenpäin. */
export function appKomentoKuuntelija(
  laheta: (suunta: NavigointiSuunta) => void,
): (tapahtuma: unknown, komento: string) => void {
  return (_tapahtuma, komento) => {
    const suunta = appKomennonSuunta(komento);
    if (suunta) laheta(suunta);
  };
}

/**
 * Pääikkunan ylätason navigoinnin päätös. Ikkunassa näytetään myös käyttäjän tuomia,
 * epäluotettavia liitteitä (PDF-esikatselu), joten ikkuna ei saa siirtyä pois kirjan
 * istunnon originista: siellä sivulla olisi yhä esilataus (window.penni) käytössään.
 *
 * - `salli`: sama origin kuin avoimen kirjan istunnolla (sovelluksen oma navigointi).
 * - `ulkoinen`: http(s)-linkki muualle; estetään ikkunassa, käyttäjältä kysytään avataanko se
 *   järjestelmän selaimessa.
 * - `esta`: kaikki muu (file:, data:, javascript:, blob:, virheellinen osoite…).
 *
 * Ohjelmallinen loadURL (kirjan avaus ja vaihto) ei laukaise will-navigate-tapahtumaa, joten
 * istunnon vaihto ei kulje tämän kautta.
 */
export type NavigointiPaatos = 'salli' | 'ulkoinen' | 'esta';

export function navigointiPaatos(
  url: string,
  istunnonOsoite: string | undefined,
): NavigointiPaatos {
  let kohde: URL;
  try {
    kohde = new URL(url);
  } catch {
    return 'esta';
  }
  const http = kohde.protocol === 'http:' || kohde.protocol === 'https:';
  // blob:-osoitteen origin on sen luoneen sivun origin, mutta ylätason blob-sivu saisi
  // esilatauksen — vain istunnon oma http(s) kelpaa.
  if (http && istunnonOsoite !== undefined) {
    try {
      if (kohde.origin === new URL(istunnonOsoite).origin) return 'salli';
    } catch {
      // virheellinen istunnon osoite: ei sallita mitään sen perusteella
    }
  }
  return http ? 'ulkoinen' : 'esta';
}
