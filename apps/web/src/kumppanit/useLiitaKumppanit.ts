import { useKpClient } from '@/app/KpClientProvider';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Liitos } from './kumppaninTositteet.js';

export interface LiitosTulos {
  liitetty: number;
  epaonnistui: number;
}

/**
 * Liittää tositteet kumppaneihinsa yksi kerrallaan (paivitaTosite: numero ja muut kentät
 * säilyvät, muutos kirjautuu tositelokiin). Yksittäinen epäonnistuminen, esim. juuri lukittu
 * kausi, ei keskeytä muita.
 */
export function useLiitaKumppanit() {
  const client = useKpClient();
  const qc = useQueryClient();
  const [kaynnissa, setKaynnissa] = useState(false);

  async function liita(liitokset: readonly Liitos[]): Promise<LiitosTulos> {
    setKaynnissa(true);
    const tulos: LiitosTulos = { liitetty: 0, epaonnistui: 0 };
    try {
      for (const { tosite, kumppani } of liitokset) {
        try {
          await client.paivitaTosite(tosite.id, { ...tosite, kumppani });
          tulos.liitetty++;
        } catch {
          tulos.epaonnistui++;
        }
      }
    } finally {
      setKaynnissa(false);
      for (const avain of ['tositteet', 'tosite', 'menot', 'tulot', 'myyntilaskut', 'ostolaskut'])
        void qc.invalidateQueries({ queryKey: [avain] });
    }
    return tulos;
  }

  return { liita, kaynnissa };
}
