import { KpClientProvider } from '@/app/KpClientProvider';
import { InProcessClient } from '@penni/asiakas';
import type { KpClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderOptions, type RenderResult, render } from '@testing-library/react';
import { type UserEvent, userEvent } from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Arrange book state through the SAME client the UI uses (no fetch mocks). */
  seed?: (client: KpClient) => void | Promise<void>;
  queryClient?: QueryClient;
}

export interface RenderWithProvidersResult extends RenderResult {
  user: UserEvent;
  client: KpClient;
  queryClient: QueryClient;
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: false },
    },
  });
}

export async function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): Promise<RenderWithProvidersResult> {
  const { seed, queryClient = makeQueryClient(), ...renderOptions } = options;
  const client = new InProcessClient(createMemoryStorage(), () => '2026-06-01T00:00:00.000Z');
  if (seed) await seed(client);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <KpClientProvider client={client}>{children}</KpClientProvider>
      </QueryClientProvider>
    );
  }

  const user = userEvent.setup();
  const result = render(ui, { wrapper: Wrapper, ...renderOptions });
  return { ...result, user, client, queryClient };
}
