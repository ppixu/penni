import { useRouter } from '@tanstack/react-router';
import { useCallback, useSyncExternalStore } from 'react';
import type { Suunta } from './eleet.js';
import { annaSeuranta, voiEdeta, voiPalata } from './historia.js';

export interface Historia {
  voiPalata: boolean;
  voiEdeta: boolean;
  /** Siirtyy historiassa, jos suuntaan on minne mennä (ei koskaan ulos sovelluksesta). */
  siirry: (suunta: Suunta) => void;
}

/**
 * Sovelluksen takaisin/eteenpäin-tila reitittimen historiasta. Siirtyminen kulkee historian
 * kautta (ei router.navigate), joten selaimessa se on sama asia kuin selaimen omat napit ja
 * tallentamattomien muutosten varoitus (useBlocker) pätee.
 */
export function useHistoria(): Historia {
  const router = useRouter();
  const seuranta = annaSeuranta(router.history);
  const tila = useSyncExternalStore(seuranta.tilaa, seuranta.tila, seuranta.tila);
  const siirry = useCallback(
    (suunta: Suunta) => {
      const nyt = seuranta.tila();
      if (suunta === 'takaisin' && voiPalata(nyt)) router.history.back();
      else if (suunta === 'eteenpain' && voiEdeta(nyt)) router.history.forward();
    },
    [router, seuranta],
  );
  return { voiPalata: voiPalata(tila), voiEdeta: voiEdeta(tila), siirry };
}
