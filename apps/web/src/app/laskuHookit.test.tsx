import { KpClientProvider } from '@/app/KpClientProvider';
import {
  useTallennaHyvityslasku,
  useTallennaMyyntilasku,
  useTallennaOstolasku,
  useTallennaSuoritus,
} from '@/app/kysely';
import type { KpClient } from '@penni/asiakas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

function ymparisto() {
  const tallennettu = vi.fn(async () => ({ id: 1 }));
  const client = {
    tallennaMyyntilasku: tallennettu,
    tallennaSuoritus: tallennettu,
    tallennaOstolasku: tallennettu,
    tallennaHyvityslasku: tallennettu,
  } as unknown as KpClient;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <KpClientProvider client={client}>{children}</KpClientProvider>
    </QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('laskujen tallennushookit', () => {
  it.each([
    ['useTallennaMyyntilasku', useTallennaMyyntilasku],
    ['useTallennaSuoritus', useTallennaSuoritus],
    ['useTallennaOstolasku', useTallennaOstolasku],
    ['useTallennaHyvityslasku', useTallennaHyvityslasku],
  ] as const)(
    '%s mitätöi kohdennusten käyttömäärät ja kohdennus-/budjettiraportit',
    async (_, hook) => {
      const { qc, wrapper } = ymparisto();
      const mitatoi = vi.spyOn(qc, 'invalidateQueries');
      const { result } = renderHook(() => hook(), { wrapper });
      await act(async () => {
        await result.current.tallenna({} as never);
      });
      for (const avain of ['kohdennukset', 'kohdennusRaportti', 'budjettivertailu'])
        expect(mitatoi).toHaveBeenCalledWith({ queryKey: [avain] });
    },
  );
});
