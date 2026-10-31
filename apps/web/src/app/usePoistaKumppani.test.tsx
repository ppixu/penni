import { createMemoryStorage } from '@penni/storage-memory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { KpClientProvider } from '@/app/KpClientProvider';
import { usePoistaKumppani } from '@/app/kysely';
import { InProcessClient } from '@penni/asiakas';

function wrapper(client: InProcessClient, qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <KpClientProvider client={client}>{children}</KpClientProvider>
    </QueryClientProvider>
  );
}

describe('usePoistaKumppani', () => {
  it('poistaa kumppanin oikean clientin kautta', async () => {
    const client = new InProcessClient(createMemoryStorage({}), () => '2026-06-01T00:00:00.000Z');
    const luotu = await client.tallennaKumppani({ nimi: 'Poistettava Oy' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePoistaKumppani(), { wrapper: wrapper(client, qc) });

    let ok = false;
    await act(async () => {
      ok = await result.current.poista(luotu.id);
    });
    expect(ok).toBe(true);
    await waitFor(async () => expect(await client.haeKumppanit()).toHaveLength(0));
  });
});
