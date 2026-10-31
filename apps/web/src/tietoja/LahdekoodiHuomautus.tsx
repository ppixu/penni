import { LISENSSI, TEKIJANOIKEUS } from '@penni/contract';
import { LAHDEKOODI } from './tietoja.js';

/**
 * Lisenssi ja lähdekoodilinkki kirjautumis- ja rekisteröintisivun alareunassa. Pilvessä nämä
 * sivut näkyvät ennen sovellusta (ja Tietoja-näkymää), joten AGPL §13 -tarjous tarvitaan myös
 * tässä kirjautumattomalle käyttäjälle.
 */
export function LahdekoodiHuomautus() {
  return (
    <p className="mt-6 text-center text-[11px] text-[var(--text-subtle)]">
      Penni {TEKIJANOIKEUS} · {LISENSSI}, ei takuuta ·{' '}
      <a href={LAHDEKOODI} rel="noreferrer" className="underline">
        Lähdekoodi
      </a>
    </p>
  );
}
