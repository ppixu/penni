import { BetaMerkki } from '@/components/ui/BetaMerkki';
import { Button } from '@/components/ui/button';
import { siivoaIpcVirhe } from '@/tasmays/ipcVirhe';
import type { KysyTapahtuma, KysyTila } from '@penni/kysy';
import { useEffect, useRef, useState } from 'react';
import { annaKysySilta, onkoKysySilta } from './silta.js';

/** Yksi keskustelun rivi: käyttäjän kysymys, mallin vastaus, työkaluaskel tai virhe. */
type Rivi =
  | { tyyppi: 'kayttaja'; teksti: string }
  | { tyyppi: 'vastaus'; teksti: string }
  | {
      tyyppi: 'tyokalu';
      kysymysId: number;
      kutsuId: number;
      nimi: string;
      kaynnissa: boolean;
      syote: unknown;
      tulos?: unknown;
    }
  | { tyyppi: 'virhe'; viesti: string; korjaus?: string };

/**
 * Julkinen paneeli: pelkkä auki- ja siltatarkistus, ei yhtään hookia — sama hooks-turvallinen
 * ehdollisuus kuin TasmaysNakyma:lla (ks. tasmays/TasmaysNakyma.tsx:105-112). Keskustelutila
 * (kaikki hookit) mountataan vain kun paneeli on auki ja silta on olemassa, joten suljettuna
 * tai selaimessa mikään hook ei koskaan yritä kutsua puuttuvaa siltaa — eikä keskustelu myöskään
 * säily seuraavaan avaamiseen, koska sisältö unmounttuu kokonaan kiinni ollessa.
 */
export function KysyPaneeli({
  auki,
  sulje,
}: {
  auki: boolean;
  sulje: () => void;
}): React.ReactElement | null {
  if (!auki || !onkoKysySilta()) return null;
  return <KysyPaneeliSisalto sulje={sulje} />;
}

function KysyPaneeliSisalto({ sulje }: { sulje: () => void }): React.ReactElement {
  const [tila, setTila] = useState<KysyTila | null>(null);
  const [rivit, setRivit] = useState<Rivi[]>([]);
  const [syote, setSyote] = useState('');
  const [kaynnissa, setKaynnissa] = useState(false);
  const seuraavaId = useRef(0);
  const aktiivinenId = useRef<number | null>(null);

  useEffect(() => {
    let peruttu = false;
    annaKysySilta()
      .kysyTila()
      .then((t) => {
        if (!peruttu) setTila(t);
      })
      .catch((e: unknown) => {
        if (!peruttu) {
          setTila({
            ok: false,
            viesti: siivoaIpcVirhe(e instanceof Error ? e.message : String(e)),
          });
        }
      });
    return () => {
      peruttu = true;
    };
  }, []);

  useEffect(() => {
    function kuuntele(e: KeyboardEvent) {
      if (e.key === 'Escape') sulje();
    }
    window.addEventListener('keydown', kuuntele);
    return () => window.removeEventListener('keydown', kuuntele);
  }, [sulje]);

  // Paneelin sulkeminen (Esc/⌘K/X) kesken kysymyksen unmounttaa tämän komponentin — ilman tätä
  // silmukka jää työpöytäsovelluksen `aktiiviset`-karttaan roikkumaan, kunnes Ollama joskus
  // vastaa, eikä paneelin uudelleenavaus enää onnistu ('kysely on jo käynnissä'). Peruutus
  // vapauttaa sen heti riippumatta siitä, miten paneeli suljettiin.
  useEffect(() => {
    return () => {
      if (aktiivinenId.current !== null) {
        annaKysySilta()
          .kysyPeruuta(aktiivinenId.current)
          .catch(() => {
            // Sama periaate kuin peruuta()-funktiossa: unmounttuvalla paneelilla ei ole enää
            // näkymää virheelle, ja silmukka näkee peruutuksen joka tapauksessa signaalin kautta.
          });
      }
    };
  }, []);

  function kasitteleTapahtuma(id: number, e: KysyTapahtuma & { kysymysId: number }) {
    if (e.kysymysId !== id) return;
    if (e.tyyppi === 'tyokalu_alkoi') {
      setRivit((r) => [
        ...r,
        {
          tyyppi: 'tyokalu',
          kysymysId: id,
          kutsuId: e.kutsuId,
          nimi: e.nimi,
          kaynnissa: true,
          syote: e.syote,
        },
      ]);
      return;
    }
    if (e.tyyppi === 'tyokalu_valmis') {
      // kutsuId-laskuri nollautuu jokaiselle kysymykselle (ks. silmukka.ts), joten pelkkä
      // kutsuId ei riitä rivin tunnistamiseen — täytyy täsmätä myös kysymysId, tai edellisen
      // kysymyksen samalla kutsuId:llä oleva rivi ylikirjoittuu tämän kysymyksen tuloksella.
      setRivit((r) =>
        r.map((rivi) =>
          rivi.tyyppi === 'tyokalu' && rivi.kysymysId === id && rivi.kutsuId === e.kutsuId
            ? { ...rivi, kaynnissa: false, tulos: e.tulos }
            : rivi,
        ),
      );
      return;
    }
    if (e.tyyppi === 'vastaus') {
      setRivit((r) => [...r, { tyyppi: 'vastaus', teksti: e.teksti }]);
      return;
    }
    setRivit((r) => [
      ...r,
      {
        tyyppi: 'virhe',
        viesti: e.viesti,
        ...(e.korjaus !== undefined ? { korjaus: e.korjaus } : {}),
      },
    ]);
  }

  async function laheta() {
    const kysymys = syote.trim();
    if (!kysymys || kaynnissa) return;
    seuraavaId.current += 1;
    const id = seuraavaId.current;
    aktiivinenId.current = id;
    setSyote('');
    setRivit((r) => [...r, { tyyppi: 'kayttaja', teksti: kysymys }]);
    setKaynnissa(true);
    try {
      await annaKysySilta().kysy(id, kysymys, (e) => kasitteleTapahtuma(id, e));
    } catch (e) {
      setRivit((r) => [
        ...r,
        { tyyppi: 'virhe', viesti: siivoaIpcVirhe(e instanceof Error ? e.message : String(e)) },
      ]);
    } finally {
      aktiivinenId.current = null;
      setKaynnissa(false);
    }
  }

  async function peruuta() {
    if (aktiivinenId.current === null) return;
    try {
      await annaKysySilta().kysyPeruuta(aktiivinenId.current);
    } catch {
      // Peruutus näkyy silti kysely-silmukan omana virhe-tapahtumana (koodi 'peruttu').
    }
  }

  const eiSyottoa = tila === null || tila.ok === false || kaynnissa;

  return (
    <section
      aria-label="Kysy kirjanpitäjältä"
      className="fixed right-0 top-0 z-20 flex h-full w-[380px] flex-col border-l border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <div className="flex items-center gap-[6px]">
            <h2 className="text-[13px] font-semibold">Kysy kirjanpitäjältä</h2>
            <BetaMerkki />
          </div>
          {tila?.ok && <p className="text-[11px] text-[var(--text-subtle)]">{tila.malli}</p>}
        </div>
        <button
          type="button"
          onClick={sulje}
          aria-label="Sulje"
          className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>

      {tila && !tila.ok && (
        <div role="alert" className="px-4 py-3 text-[12.5px] text-[var(--danger)]">
          <p>{tila.viesti}</p>
          {tila.korjaus && <code className="mt-1 block text-[11px]">{tila.korjaus}</code>}
        </div>
      )}

      <div aria-label="keskustelu" className="flex-1 overflow-auto px-4 py-3">
        {rivit.map((rivi, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rivit ovat append-only tämän istunnon ajan, ei uudelleenjärjestystä
          <RiviNaytto key={i} rivi={rivi} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void laheta();
        }}
        className="flex gap-2 border-t border-[var(--border)] p-3"
      >
        <input
          aria-label="Kysymys"
          // biome-ignore lint/a11y/noAutofocus: käyttäjän itse ⌘K:lla/napilla avaama sivupalkki, ei sivulataus — keyboard-first (ks. ux-design.md).
          autoFocus
          value={syote}
          onChange={(e) => setSyote(e.target.value)}
          disabled={eiSyottoa}
          className="flex-1 rounded-[var(--radius-input)] border border-[var(--border-strong)] px-2 py-1.5 text-[12.5px] disabled:opacity-50"
        />
        {kaynnissa ? (
          <Button type="button" variant="sec" onClick={() => void peruuta()}>
            Peruuta
          </Button>
        ) : (
          <Button type="submit" disabled={eiSyottoa || syote.trim() === ''}>
            Lähetä
          </Button>
        )}
      </form>
    </section>
  );
}

function RiviNaytto({ rivi }: { rivi: Rivi }): React.ReactElement {
  if (rivi.tyyppi === 'kayttaja') {
    return (
      <p className="mb-2 rounded-[var(--radius-card)] bg-[var(--accent-soft)] px-3 py-2 text-right text-[12.5px]">
        {rivi.teksti}
      </p>
    );
  }
  if (rivi.tyyppi === 'vastaus') {
    return <p className="mb-2 px-3 py-2 text-[12.5px]">{rivi.teksti}</p>;
  }
  if (rivi.tyyppi === 'virhe') {
    return (
      <div role="alert" className="mb-2 px-3 py-2 text-[12.5px] text-[var(--danger)]">
        <p>{rivi.viesti}</p>
        {rivi.korjaus && <code className="mt-1 block text-[11px]">{rivi.korjaus}</code>}
      </div>
    );
  }
  return (
    <details className="mb-2 px-3 py-1 text-[12px]">
      <summary className="cursor-pointer text-[var(--text-muted)]">
        {rivi.kaynnissa ? `Haen: ${rivi.nimi}…` : `Katsoin: ${rivi.nimi}`}
      </summary>
      <pre className="mt-1 overflow-auto rounded bg-[var(--bg-subtle)] p-2 text-[11px]">
        {JSON.stringify({ syote: rivi.syote, tulos: rivi.tulos }, null, 2)}
      </pre>
    </details>
  );
}
