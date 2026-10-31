import { InProcessClient } from '@penni/asiakas';
import type { KpClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import type { MemorySeed } from '@penni/storage-memory';
import { HttpClient } from './HttpClient.js';
import type { KirjanpitoSyote } from './luoSiemen.js';
import { OLETUS_SYOTE, luoKirjanpidonSiemen } from './luoSiemen.js';

export type Tila = 'local' | 'cloud';

export interface MakeClientOptions {
  baseUrl?: string;
}

/** Synkroninen, muistipohjainen paikallisclient (Node-testit; ei pysyvyyttä). */
export function luoPaikallinenClient(siemen: MemorySeed): KpClient {
  return new InProcessClient(createMemoryStorage(siemen));
}

/**
 * Valitse kuljetuskerros ajonaikaisesti. local => pysyvä OPFS-kirjanpito (laiskasti ladattu
 * sqlite-wasm + Worker), siemennetään tyhjänä yritys-kartalla; cloud => HTTP.
 */
export async function makeClient(tila: Tila, options: MakeClientOptions = {}): Promise<KpClient> {
  if (tila === 'cloud') {
    return new HttpClient({ baseUrl: options.baseUrl ?? import.meta.env.VITE_API_URL ?? '/api' });
  }
  const { createOpfsStorage } = await import('@penni/storage-opfs');
  const storage = await createOpfsStorage('penni', luoKirjanpidonSiemen(OLETUS_SYOTE));
  return new InProcessClient(storage);
}

/** Velhon "Luo kirjanpito": pudota+rakenna ainoa OPFS-kanta uudelleen ja siemennä syötteellä. */
export async function luoOpfsKirjanpito(syote: KirjanpitoSyote): Promise<KpClient> {
  const { createOpfsStorage } = await import('@penni/storage-opfs');
  const storage = await createOpfsStorage('penni');
  await storage.nollaa(luoKirjanpidonSiemen(syote));
  return new InProcessClient(storage);
}
