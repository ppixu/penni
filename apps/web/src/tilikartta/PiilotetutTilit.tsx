import { createContext, useContext } from 'react';

const TYHJA: ReadonlySet<number> = new Set();

/**
 * Avoimen kirjan piilotetut tilit (`piilotilit`) koko sovellukselle: juurireitti tarjoaa,
 * tilivalitsimet lukevat. Ilman tarjoajaa (yksikkötestit) mitään ei piiloteta.
 */
export const PiilotetutTilitKonteksti = createContext<ReadonlySet<number>>(TYHJA);

export function usePiilotetutTilit(): ReadonlySet<number> {
  return useContext(PiilotetutTilitKonteksti);
}
