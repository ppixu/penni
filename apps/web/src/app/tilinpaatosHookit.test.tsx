import { createMemoryStorage } from '@penni/storage-memory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { KpClientProvider } from '@/app/KpClientProvider';
import { usePaataTilikausi } from '@/app/kysely';
import { InProcessClient } from '@penni/asiakas';

function wrapper(client: InProcessClient, qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <KpClientProvider client={client}>{children}</KpClientProvider>
    </QueryClientProvider>
  );
}

describe('usePaataTilikausi', () => {
  it('lukitsee tilikauden (TilitPaatetty = kauden loppu)', async () => {
    const client = new InProcessClient(
      createMemoryStorage({ tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }] }),
      () => '2026-06-01T00:00:00.000Z',
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePaataTilikausi(), { wrapper: wrapper(client, qc) });

    let ok = false;
    await act(async () => {
      ok = await result.current.lukitse('2026-01-01');
    });
    expect(ok).toBe(true);
    await waitFor(async () =>
      expect((await client.haeInit()).asetukset.TilitPaatetty).toBe('2026-12-31'),
    );
  });
});
