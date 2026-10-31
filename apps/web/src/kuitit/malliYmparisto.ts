import { MALLI_ISANTA } from '@penni/engine';
import type { MalliSilta } from '@penni/tuonti';
import type { MallinLatausAsetukset } from './paattely.js';

/** Lukumallin latauspaikka ja käyttäjän kertaluontoinen suostumus 0,85 Gt:n lataukseen. */
export interface MalliYmparisto {
  latausAsetukset: MallinLatausAsetukset;
  onkoLupa(): Promise<boolean>;
  annaLupa(): Promise<void>;
}

const LUPA_AVAIN = 'penni.kuitinLukuLupa';

function malliSilta(): MalliSilta | null {
  const silta = typeof window !== 'undefined' ? window.penni : undefined;
  return typeof silta?.malliLupa === 'function' && typeof silta.annaMalliLupa === 'function'
    ? (silta as MalliSilta)
    : null;
}

/**
 * Työpöydällä painot kulkevat pääprosessin `penni-malli://`-välimuistin kautta (kirjan origin
 * vaihtuu joka avauksella, joten selaimen välimuisti ja localStorage eivät säily) ja lupa on
 * asetukset.json:ssa. Selaimessa origin on pysyvä: selaimen välimuisti ja localStorage.
 */
export function annaMalliYmparisto(): MalliYmparisto {
  const silta = malliSilta();
  if (silta)
    return {
      latausAsetukset: { kautta: MALLI_ISANTA, selainValimuisti: false },
      onkoLupa: () => silta.malliLupa(),
      annaLupa: () => silta.annaMalliLupa(),
    };
  return {
    latausAsetukset: { selainValimuisti: true },
    onkoLupa: async () => {
      try {
        return localStorage.getItem(LUPA_AVAIN) === '1';
      } catch {
        return false;
      }
    },
    annaLupa: async () => {
      try {
        localStorage.setItem(LUPA_AVAIN, '1');
      } catch {
        // Estetty tallennus: kysytään uudelleen seuraavalla kerralla.
      }
    },
  };
}
