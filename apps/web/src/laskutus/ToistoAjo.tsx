import { useKpClient } from '@/app/KpClientProvider';
import { avaimet, laskuVirheViesti } from '@/app/kysely';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import type { KpClient } from '@penni/asiakas';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

/** Kirjat (clientit), joille toistoajo on jo käynnistetty: yksi ajo per avattu kirja. Moduulitason
 *  joukko kestää uudelleenrenderöinnit, StrictModen tuplaefektin ja komponentin remountin. */
const AJETUT = new WeakSet<KpClient>();

type Ilmoitus = { laji: 'luotu'; maara: number } | { laji: 'virhe'; viesti: string };

/** Ilmoituksen teksti; yksikkö kirjoitetaan oikein ("1 toistuva lasku"). */
function ilmoituksenTeksti(i: Ilmoitus): string {
  if (i.laji === 'virhe') return `Toistuvien laskujen luonti epäonnistui: ${i.viesti}`;
  return i.maara === 1
    ? '1 toistuva lasku odottaa Lähtevissä'
    : `${i.maara} toistuvaa laskua odottaa Lähtevissä`;
}

/**
 * Kirjan avauksen toistoajo (spec §5.3, Trigger): kun kirja on avattu, luodaan erääntyneet
 * toistuvat laskut luonnoksiksi kerran, ja jos luonnoksia syntyi, ilmoitetaan siitä. Ajo on
 * kertaluonteinen kirjaa kohden, ei sivunavigointia kohden. Virhe (esim. laskutilit puuttuvat)
 * näytetään ei-estävänä ilmoituksena; se ei koskaan estä sovelluksen käyttöä. "Tänään" on
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
        if (tulos.luodut.length > 0) {
          void qc.invalidateQueries({ queryKey: avaimet.laskuluonnokset });
          setIlmoitus({ laji: 'luotu', maara: tulos.luodut.length });
        }
      } catch (e) {
        setIlmoitus({ laji: 'virhe', viesti: laskuVirheViesti(e) });
      }
    })();
  }, [client, qc]);

  // Toisen kirjan avaus nollaa edellisen kirjan ilmoituksen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: client on ainoa laukaisija
  useEffect(() => setIlmoitus(null), [client]);

  if (!ilmoitus) return null;
  return (
    <output className="fixed right-4 bottom-4 z-20 flex max-w-[380px] items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[12.5px] shadow-[var(--shadow-pop)] print:hidden">
      <span>{ilmoituksenTeksti(ilmoitus)}</span>
      {ilmoitus.laji === 'luotu' && (
        <Link
          to="/tositteet"
          search={{ laji: 'tulot', valilehti: 'lahtevat' }}
          className="font-semibold text-[var(--accent)]"
        >
          Avaa Lähtevät
        </Link>
      )}
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
