import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type { Kayttaja } from './authClient.js';

export interface KayttajaCtx {
  kayttaja: Kayttaja;
  kirjauduUlos: () => void;
  vaihdaSalasana: (syote: { vanhaSalasana: string; uusiSalasana: string }) => Promise<void>;
}
const Konteksti = createContext<KayttajaCtx | null>(null);

export function KayttajaProvider({
  kayttaja,
  kirjauduUlos,
  vaihdaSalasana,
  children,
}: {
  kayttaja: Kayttaja;
  kirjauduUlos: () => void;
  vaihdaSalasana: (syote: { vanhaSalasana: string; uusiSalasana: string }) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <Konteksti.Provider value={{ kayttaja, kirjauduUlos, vaihdaSalasana }}>
      {children}
    </Konteksti.Provider>
  );
}

/** null paikallistilassa (ei providerin sisällä). */
export function useKayttaja(): KayttajaCtx | null {
  return useContext(Konteksti);
}
