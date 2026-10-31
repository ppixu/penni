import { KpClientProvider } from '@/app/KpClientProvider';
import { routeTree } from '@/routeTree.gen';
import { AutotallennusAjat } from '@/tallennus/useAutomaattinenTallennus';
import { InProcessClient } from '@penni/asiakas';
import type { KpClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import type { MemorySeed } from '@penni/storage-memory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';

interface RenderRouteOptions {
  /** Master-data seed (accounts/fiscal years/settings) for the in-memory storage. */
  seed?: MemorySeed;
  /**
   * Optional arrange step run through the real client BEFORE the first render — so any data it
   * creates (e.g. finalized vouchers via client.luoTosite) is present on the first query on mount
   * (no reliance on refetch; avoids flaky waitFor).
   */
  arrange?: (client: KpClient) => Promise<void>;
  /** Valinnainen kääre RouterProviderin ympärille (esim. testikontekstit). */
  wrapper?: (children: ReactNode) => ReactNode;
}

export async function renderRoute(initialPath: string, opts: RenderRouteOptions = {}) {
  const storage = createMemoryStorage(opts.seed ?? {});
  const client = new InProcessClient(storage, () => '2026-06-01T00:00:00.000Z');
  if (opts.arrange) await opts.arrange(client);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({ routeTree, history, context: { client, queryClient } });
  const user = userEvent.setup();
  const reititin = <RouterProvider router={router} />;
  const result = render(
    <QueryClientProvider client={queryClient}>
      <KpClientProvider client={client}>
        {/* Pitkä tauko: reittitesteissä tallennus tapahtuu kentästä tai sivulta poistuttaessa
            ja erikseen pyydettäessä, joten tallennusten (lokirivien) määrä on ennustettava. */}
        <AutotallennusAjat.Provider value={{ viive: 60_000, uudelleenyritys: 60_000 }}>
          {opts.wrapper ? opts.wrapper(reititin) : reititin}
        </AutotallennusAjat.Provider>
      </KpClientProvider>
    </QueryClientProvider>,
  );
  return { ...result, user, client, queryClient, router, storage };
}
