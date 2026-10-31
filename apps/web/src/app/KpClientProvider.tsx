import { tyhjennaListanJarjestys } from '@/tositteet/listanJarjestys';
import type { KpClient } from '@penni/asiakas';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface KpClientCtx {
  client: KpClient;
  asetaKirjanpito: (uusi: KpClient) => void;
}

const KpClientContext = createContext<KpClientCtx | null>(null);

export function KpClientProvider({
  client: alkuClient,
  children,
}: {
  client: KpClient;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const [client, setClient] = useState<KpClient>(alkuClient);
  const asetaKirjanpito = useCallback(
    (uusi: KpClient) => {
      setClient(uusi);
      qc.clear(); // the new book has different data at the same query keys
      tyhjennaListanJarjestys(); // tositelistan id:t kuuluivat edelliseen kirjaan
    },
    [qc],
  );
  const arvo = useMemo<KpClientCtx>(() => ({ client, asetaKirjanpito }), [client, asetaKirjanpito]);
  return <KpClientContext.Provider value={arvo}>{children}</KpClientContext.Provider>;
}

function ctx(): KpClientCtx {
  const c = useContext(KpClientContext);
  if (!c) throw new Error('useKpClient: KpClientProvider puuttuu');
  return c;
}

/** Read the active KpClient. Throws if used outside a provider (a real wiring bug). */
export function useKpClient(): KpClient {
  return ctx().client;
}

/** Swap the active book (local-first new-book creation). Clears the query cache. */
export function useAsetaKirjanpito(): (uusi: KpClient) => void {
  return ctx().asetaKirjanpito;
}
