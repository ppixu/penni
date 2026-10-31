import { env, runInDurableObject } from 'cloudflare:test';
import type { Storage } from '@penni/engine';
import { type ConformanceSeed, runResourceConformance } from '@penni/engine/conformance';

type Metodit = Record<string, (...args: unknown[]) => unknown>;

/**
 * Jokainen tapaus saa tuoreen KirjaDO:n (migraatiot + siemen ensimmäisellä käytöllä). Jokainen
 * Storage-kutsu ajetaan DO:n omassa kontekstissa (runInDurableObject), kuten Workerin RPC-kutsu
 * ajaisi sen: aktori sarjallistaa kirjoitukset. Arvot kulkevat sellaisenaan (ei sarjallistusta).
 */
async function kirjaDOssa(seed: ConformanceSeed): Promise<Storage> {
  const stub = env.KIRJA.get(env.KIRJA.newUniqueId());
  const nimet = await runInDurableObject(stub, (o) => Object.keys(o.kirja(seed)));
  const storage: Metodit = {};
  for (const nimi of nimet) {
    storage[nimi] = (...args) =>
      runInDurableObject(stub, (o) => (o.kirja(seed) as unknown as Metodit)[nimi]?.(...args));
  }
  return storage as unknown as Storage;
}

runResourceConformance('@penni/storage-do', kirjaDOssa);
