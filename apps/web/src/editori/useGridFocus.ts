import { useCallback, useEffect, useRef, useState } from 'react';
import { SARAKKEET, type Solu } from './types.js';

interface FokusPyynto {
  avain: string;
  solu: Solu;
}

/** Registry key for a cell input (module-level so it isn't a hook dependency). */
function avaa(avain: string, solu: Solu): string {
  return `${avain}:${solu}`;
}

/**
 * Focus coordination for the grid. All cell inputs are in the natural tab order (no -1
 * roving) so Tab works via the browser. This hook adds PROGRAMMATIC moves (after Enter or
 * a picker accept): register each input's ref, then `pyyda(avain, solu)` to focus it once
 * it exists (a post-commit effect drains the request). Solu, jota rivillä ei ole (esim.
 * kohdennus taseen tilillä), ohitetaan: fokus menee rivin seuraavaan olemassa olevaan soluun.
 */
export function useGridFocus() {
  const refs = useRef(new Map<string, HTMLElement | null>());
  const [pyynto, setPyynto] = useState<FokusPyynto | null>(null);

  const setRef = useCallback(
    (avain: string, solu: Solu) => (el: HTMLElement | null) => {
      refs.current.set(avaa(avain, solu), el);
    },
    [],
  );

  const pyyda = useCallback((avain: string, solu: Solu) => {
    setPyynto({ avain, solu });
  }, []);

  useEffect(() => {
    if (!pyynto) return;
    const solut = SARAKKEET.slice(SARAKKEET.indexOf(pyynto.solu));
    for (const solu of solut) {
      const el = refs.current.get(avaa(pyynto.avain, solu));
      if (el) {
        el.focus();
        break;
      }
    }
    setPyynto(null);
  }, [pyynto]);

  return { setRef, pyyda };
}
