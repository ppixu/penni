import { Button } from '@/components/ui/button';
import { useBlocker } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Varoitus tallentamattomista muutoksista. Estää sovelluksen sisäisen navigoinnin
 * (TanStack Routerin useBlocker) ja ikkunan/välilehden sulkemisen (beforeunload) silloin,
 * kun lomake on likainen, ja palauttaa vahvistusdialogin renderöitäväksi lomakkeen sisään.
 *
 * `likainen` voi olla arvo tai funktio. Funktio (useMuutosseurannan `onkoLikainen`) luetaan
 * vasta navigointihetkellä, joten tallennuksen jälkeinen välitön navigointi ei varoita,
 * vaikka uusi pohja ei olisi vielä renderöitynyt. Pelkkä arvo päivittyy vasta renderöinnissä.
 *
 * Desktop-kuoressa (Electron) beforeunloadin preventDefault saa pääprosessin
 * `will-prevent-unload`-tapahtuman laukeamaan.
 */
export function useTallentamatonVaroitus(likainen: boolean | (() => boolean)): ReactNode {
  const likainenRef = useRef(likainen);
  useLayoutEffect(() => {
    likainenRef.current = likainen;
  }, [likainen]);

  // Vakaa viite: useBlocker rekisteröi estäjän uudelleen aina, kun funktio vaihtuu.
  const onkoLikainen = useCallback(() => {
    const l = likainenRef.current;
    return typeof l === 'function' ? l() : l;
  }, []);

  const esto = useBlocker({
    shouldBlockFn: onkoLikainen,
    enableBeforeUnload: onkoLikainen,
    withResolver: true,
  });

  // TanStackin selainhistoria tekee saman (preventDefault + returnValue), mutta se ohittaa
  // seuraavan beforeunloadin history.back()-kutsun jälkeen eikä toimi muistihistorialla.
  // Oma kuuntelija pitää sulkemisvaroituksen varmana kaikissa historiatyypeissä.
  useEffect(() => {
    function ennenPoistumista(e: BeforeUnloadEvent) {
      if (!onkoLikainen()) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', ennenPoistumista);
    return () => window.removeEventListener('beforeunload', ennenPoistumista);
  }, [onkoLikainen]);

  if (esto.status !== 'blocked') return null;
  return <TallentamatonDialogi onJaa={esto.reset} onPoistu={esto.proceed} />;
}

/** Vahvistusdialogi (sovelluksen dialogimalli, ks. HyvitaVahvistus). Esc = jää sivulle. */
function TallentamatonDialogi({ onJaa, onPoistu }: { onJaa: () => void; onPoistu: () => void }) {
  // Turvallinen valinta saa fokuksen, joten Enter ei hävitä muutoksia vahingossa.
  const sisaltoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sisaltoRef.current?.querySelector<HTMLButtonElement>('button[data-oletus]')?.focus();
  }, []);

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: peittävä modaali vaatii oman overlay-<div>:n; natiivi <dialog> ei tyylity näin
      role="dialog"
      aria-modal="true"
      aria-label="Tallentamattomia muutoksia"
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onJaa();
        }
      }}
    >
      <div
        ref={sisaltoRef}
        className="w-[400px] rounded-[var(--radius-panel)] bg-[var(--surface)] p-5 shadow-[var(--shadow-pop)]"
      >
        <h2 className="mb-4 text-[15px] font-[650]">Tallentamattomia muutoksia</h2>
        <p className="text-[13px]">
          Lomakkeella on tallentamattomia muutoksia. Jos poistut nyt, muutokset menetetään.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="sec" type="button" onClick={onPoistu}>
            Poistu tallentamatta
          </Button>
          <Button data-oletus type="button" onClick={onJaa}>
            Jää sivulle
          </Button>
        </div>
      </div>
    </div>
  );
}
