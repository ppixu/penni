/**
 * Aja fn pitäen kirjan yksinomaista kirjoituslukkoa (single-writer). Lukko vapautuu
 * automaattisesti, kun välilehti/Worker kuolee. Tier-0: pidetään koko istunnon ajan.
 */
export async function withBookLock<T>(kirjaId: string, fn: () => Promise<T>): Promise<T> {
  // DOM:n LockGrantedCallback<T> odottaa T:tä, ei Promise<T>:tä; async-callback leventää
  // tyyppiparametrin Promise<T>:ksi -> request palauttaa Promise<Promise<T>>. `await` litistää.
  return await navigator.locks.request(`penni-book:${kirjaId}`, { mode: 'exclusive' }, () => fn());
}

/** BroadcastChannel toisten välilehtien refetch-herätteeseen kirjoituksen jälkeen. */
export function makeBookChannel(kirjaId: string, onMuutos: () => void) {
  const ch = new BroadcastChannel(`penni:${kirjaId}`);
  ch.onmessage = (e: MessageEvent<{ tyyppi?: string }>) => {
    if (e.data?.tyyppi === 'muutos') onMuutos();
  };
  return {
    ilmoitaMuutos: () => ch.postMessage({ tyyppi: 'muutos' }),
    close: () => ch.close(),
  };
}
