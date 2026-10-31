import { createContext, useContext } from 'react';
import type { TilinKaytto } from './tilinakyma.js';

/** Tilivalitsimen välilehtien aineisto: avoimen kirjan suosikit ja tilien viimeisin käyttö. */
export interface TiliValinta {
  suosikit: ReadonlySet<number>;
  kaytto: ReadonlyMap<number, TilinKaytto> | undefined;
}

const TYHJA: TiliValinta = { suosikit: new Set(), kaytto: undefined };

/**
 * Juurireitti tarjoaa, tilivalitsimet lukevat. Ilman tarjoajaa (yksikkötestit) ei ole
 * suosikkeja eikä käyttöhistoriaa, jolloin valitsin näyttää pelkät kaikki tilit.
 */
export const TiliValintaKonteksti = createContext<TiliValinta>(TYHJA);

export function useTiliValinta(): TiliValinta {
  return useContext(TiliValintaKonteksti);
}
