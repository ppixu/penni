import { useInit, useTositteet } from '@/app/kysely';
import { Button } from '@/components/ui/button';
import type { StoredTosite } from '@penni/engine';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { listanNaapurit, lueListanJarjestys } from './listanJarjestys.js';
import { type Naapurit, type NumeroAvain, naapurit, tositteenBucket } from './naapurit.js';

const EI_NAAPUREITA: Naapurit = { edellinen: null, seuraava: null };

/**
 * Tositteen naapurit. Jos tosite avattiin tositelistalta (`listalta`, ks. LISTALTA) ja se on
 * listan viimeksi näyttämällä listalla (ks. listanJarjestys.ts), selataan sitä järjestystä — suodattimet, haku ja lajittelu sellaisina kuin
 * käyttäjä ne viimeksi näki — ja ohitetaan naapurit, jotka eivät enää kuulu listan tila-ryhmään
 * (poistettu tai siirtynyt). Muuten (avattu raportista, täsmäytyksestä, linkistä…) naapurit ovat
 * numerojärjestyksessä saman tila-ryhmän sisällä (kirjatut, luonnokset, poistetut…). Yksi
 * listakysely ryhmälle; ennen latausta naapureita ei ole.
 */
export function useTositeNaapurit(
  tosite: StoredTosite | null | undefined,
  listalta: boolean,
): Naapurit {
  const { data: init } = useInit();
  // Moduulin tila luetaan renderöinnissä ilman tilausta: lista ja tositesivu eivät ole koskaan
  // yhtä aikaa näkyvissä, joten järjestys ei muutu tämän sivun ollessa auki.
  const jarjestys = listalta ? lueListanJarjestys() : null;
  const listalla = tosite != null && jarjestys !== null && jarjestys.idt.includes(tosite.id);
  const bucket = listalla ? jarjestys.bucket : tositteenBucket(tosite?.tila ?? 100);
  const { data: lista } = useTositteet({ bucket }, tosite != null);
  const numeroittain = useNaapurit(listalla ? undefined : lista, tosite?.id, init?.tilikaudet);
  const listanMukaan = useMemo(() => {
    if (!listalla || !lista || tosite == null) return EI_NAAPUREITA;
    const olemassa = new Set(lista.map((t) => t.id));
    return listanNaapurit(jarjestys, tosite.id, (id) => olemassa.has(id)) ?? EI_NAAPUREITA;
  }, [listalla, lista, jarjestys, tosite]);
  return listalla ? listanMukaan : numeroittain;
}

/** Laskulistan rivien naapurit (rivin `tosite` = tositteen id, `pvm` = laskupäivä). */
export function useLaskuNaapurit(
  rivit: readonly { tosite: number; pvm?: string; sarja: string; tunniste: number }[] | undefined,
  id: number,
): Naapurit {
  const { data: init } = useInit();
  const avaimet = useMemo(
    () =>
      rivit?.map((r) => ({ id: r.tosite, pvm: r.pvm ?? '', sarja: r.sarja, tunniste: r.tunniste })),
    [rivit],
  );
  return useNaapurit(avaimet, id, init?.tilikaudet);
}

function useNaapurit(
  lista: readonly NumeroAvain[] | undefined,
  id: number | undefined,
  kaudet: Parameters<typeof naapurit>[2] | undefined,
): Naapurit {
  return useMemo(
    () => (lista && id !== undefined ? naapurit(lista, id, kaudet ?? []) : EI_NAAPUREITA),
    [lista, id, kaudet],
  );
}

/** Kirjoituskohteet, joissa Alt+nuolet kuuluvat kentälle (sanan yli siirtyminen) eivätkä selaukselle. */
const KIRJOITUSKOHDE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="grid"], [role="dialog"]';

/**
 * Yläpalkin "Edellinen / Seuraava" -napit. Alt+← / Alt+→ selaavat, kun fokus ei ole kentässä,
 * ruudukossa tai dialogissa (ruudukkoeditori on näppäimistöpainotteinen). Siirtyminen on tavallista
 * reititystä, joten tallentamattomien muutosten varoitus pätee.
 */
export function EdellinenSeuraava({
  naapurit: { edellinen, seuraava },
  onSiirry,
  kohde = 'tosite',
}: {
  naapurit: Naapurit;
  onSiirry: (id: number) => void;
  /** Saavutettavan nimen kohde: "Edellinen tosite" / "Edellinen lasku". */
  kohde?: 'tosite' | 'lasku';
}) {
  // Kuuntelija rekisteröidään kerran; viite lukee aina tuoreimmat naapurit.
  const nykyiset = useRef({ edellinen, seuraava, onSiirry });
  nykyiset.current = { edellinen, seuraava, onSiirry };

  useEffect(() => {
    function nappain(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.target instanceof Element && e.target.closest(KIRJOITUSKOHDE)) return;
      const n = nykyiset.current;
      const kohde = e.key === 'ArrowLeft' ? n.edellinen : n.seuraava;
      // Estetään myös selaimen Alt+← "takaisin" tällä sivulla.
      e.preventDefault();
      if (kohde !== null) n.onSiirry(kohde);
    }
    window.addEventListener('keydown', nappain);
    return () => window.removeEventListener('keydown', nappain);
  }, []);

  return (
    <div className="flex gap-1">
      <Button
        variant="sec"
        size="compact"
        type="button"
        aria-label={`Edellinen ${kohde}`}
        title={`Edellinen ${kohde} (Alt+←)`}
        disabled={edellinen === null}
        onClick={() => edellinen !== null && onSiirry(edellinen)}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </Button>
      <Button
        variant="sec"
        size="compact"
        type="button"
        aria-label={`Seuraava ${kohde}`}
        title={`Seuraava ${kohde} (Alt+→)`}
        disabled={seuraava === null}
        onClick={() => seuraava !== null && onSiirry(seuraava)}
      >
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
