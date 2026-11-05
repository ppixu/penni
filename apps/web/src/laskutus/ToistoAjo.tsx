import { useKpClient } from '@/app/KpClientProvider';
import { avaimet, laskuVirheViesti } from '@/app/kysely';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import type { KpClient } from '@penni/asiakas';
import type { EpaonnistunutToisto } from '@penni/engine';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { epaonnistuneetTeksti } from './toistoVirheet';

/** Kirjat (clientit), joille toistoajo on jo käynnistetty: yksi ajo per avattu kirja. Moduulitason
 *  joukko kestää uudelleenrenderöinnit, StrictModen tuplaefektin ja komponentin remountin. */
const AJETUT = new WeakSet<KpClient>();

type Ilmoitus =
  | { laji: 'tulos'; maara: number; epaonnistuneet: EpaonnistunutToisto[] }
  | { laji: 'virhe'; viesti: string };

/** Luotujen määrä oikealla yksiköllä ("1 toistuva lasku"); nolla → null. */
function luotujenTeksti(maara: number): string | null {
  if (maara === 0) return null;
  return maara === 1
    ? '1 toistuva lasku odottaa Lähtevissä'
    : `${maara} toistuvaa laskua odottaa Lähtevissä`;
}

/**
 * Kirjan avauksen toistoajo (spec §5.3, Trigger): kun kirja on avattu, luodaan erääntyneet
 * toistuvat laskut luonnoksiksi kerran, ja jos luonnoksia syntyi, ilmoitetaan siitä. Ajo on
 * kertaluonteinen kirjaa kohden, ei sivunavigointia kohden. Virhe (esim. laskutilit puuttuvat) ja
 * yksittäisten toistojen epäonnistumiset (`epaonnistuneet`) näytetään ei-estävänä ilmoituksena; se ei koskaan estä sovelluksen käyttöä. "Tänään" on
 * paikallinen kalenteripäivä.
 */
export function ToistoAjo() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [ilmoitus, setIlmoitus] = useState<Ilmoitus | null>(null);

  useEffect(() => {
    if (AJETUT.has(client)) return;
    AJETUT.add(client);
    // Ei peruutuslippua: StrictModen simuloitu unmount ei saa niellä ainoaa ajoa, ja setState
    // oikean unmountin jälkeen on harmiton.
    void (async () => {
      try {
        const tulos = await client.luoErantyneetToistot(paikallinenTanaan());
        void qc.invalidateQueries({ queryKey: avaimet.toistot });
        if (tulos.luodut.length > 0)
          void qc.invalidateQueries({ queryKey: avaimet.laskuluonnokset });
        const epaonnistuneet = tulos.epaonnistuneet ?? [];
        if (tulos.luodut.length > 0 || epaonnistuneet.length > 0)
          setIlmoitus({ laji: 'tulos', maara: tulos.luodut.length, epaonnistuneet });
      } catch (e) {
        setIlmoitus({ laji: 'virhe', viesti: laskuVirheViesti(e) });
      }
    })();
  }, [client, qc]);

  // Toisen kirjan avaus nollaa edellisen kirjan ilmoituksen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: client on ainoa laukaisija
  useEffect(() => setIlmoitus(null), [client]);

  if (!ilmoitus) return null;
  const luotu = ilmoitus.laji === 'tulos' ? luotujenTeksti(ilmoitus.maara) : null;
  const epaonnistui =
    ilmoitus.laji === 'tulos' ? epaonnistuneetTeksti(ilmoitus.epaonnistuneet) : null;
  return (
    <output className="fixed right-4 bottom-4 z-20 flex max-w-[380px] items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[12.5px] shadow-[var(--shadow-pop)] print:hidden">
      <span className="flex flex-col gap-1">
        {ilmoitus.laji === 'virhe' && (
          <span>Toistuvien laskujen luonti epäonnistui: {ilmoitus.viesti}</span>
        )}
        {luotu && (
          <span>
            {luotu}{' '}
            <Link
              to="/tositteet"
              search={{ laji: 'tulot', valilehti: 'lahtevat' }}
              className="font-semibold text-[var(--accent)]"
            >
              Avaa Lähtevät
            </Link>
          </span>
        )}
        {epaonnistui && (
          <span className="text-[var(--danger)]">
            {epaonnistui}{' '}
            <Link to="/toistot" className="font-semibold text-[var(--accent)]">
              Avaa toistuvat laskut
            </Link>
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label="Sulje ilmoitus"
        onClick={() => setIlmoitus(null)}
        className="rounded-[4px] px-[5px] leading-none text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
      >
        ×
      </button>
    </output>
  );
}
