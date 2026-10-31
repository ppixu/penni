import { KuitinLukuKonteksti } from '@/kuitit/useKuitinLuku';
import { asetaTasmaysSilta } from '@/tasmays/silta';
import type { KpClient } from '@penni/asiakas';
import type { ReactNode } from 'react';
import { luoDemokirja } from './demoKirja.js';
import { luoDemoTasmaysSilta } from './demoTasmaysSilta.js';
import { demonKuitinLuku } from './kuitinLuku.js';

function DemoKehys({ children }: { children: ReactNode }) {
  return (
    <KuitinLukuKonteksti.Provider value={demonKuitinLuku}>{children}</KuitinLukuKonteksti.Provider>
  );
}

/**
 * Selaindemon käynnistys: muistikirja rakennetaan joka latauksella moottorin kautta samasta
 * siemenestä, täsmäytys saa demon tapahtumaluettelon ja kuitinluku toimii ilman näkömallia.
 */
export async function kaynnistaDemo(): Promise<{
  client: KpClient;
  Kehys: (p: { children: ReactNode }) => ReactNode;
}> {
  const { client, aineisto } = await luoDemokirja();
  asetaTasmaysSilta(luoDemoTasmaysSilta(aineisto));
  return { client, Kehys: DemoKehys };
}
