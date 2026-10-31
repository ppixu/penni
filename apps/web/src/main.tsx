import { KpClientProvider } from '@/app/KpClientProvider';
import { PilviPortti } from '@/auth/PilviPortti';
import { makeClient } from '@/client/makeClient';
import { DEMO } from '@/demo/tila';
import { alustaMuisti } from '@/lib/muisti';
import type { KpClient } from '@penni/asiakas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import '@fontsource-variable/inter';
import './index.css';

const queryClient = new QueryClient();

// Router-tehdas: pitää reititinkontekstin TÄYSIN tyypitettynä (ReturnType säilyttää konkreettisen
// routeTreen) ilman top-level awaitia — Viten build-target (es2020) ei tue top-level awaitia, ja
// makeClient('local') on async (avaa OPFS-kannan Workerissa).
function luoRouter(client: KpClient) {
  return createRouter({ routeTree, context: { client, queryClient } });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof luoRouter>;
  }
}

export type SovellusTila = 'local' | 'cloud' | 'tyopoyta';

/**
 * Which transport this build uses.
 * - 'local'     selain + OPFS (sqlite-wasm), ei palvelinta
 * - 'cloud'     HTTP + kirjautumisportti
 * - 'tyopoyta'  HTTP paikalliseen Electron-palvelimeen, ei kirjautumista (yksi käyttäjä)
 */
export function paataTila(env: { VITE_TILA?: string }): SovellusTila {
  if (env.VITE_TILA === 'cloud') return 'cloud';
  if (env.VITE_TILA === 'tyopoyta') return 'tyopoyta';
  return 'local';
}

// import.meta.env:in ImportMetaEnv-tyyppi ei nimeä VITE_TILA-avainta (vain indeksisignatuuri), joten
// koko envin välittäminen paataTilalle kaatuisi TS2559:ään (exactOptionalPropertyTypes); poimitaan
// avain erikseen olio-literaaliksi.
const TILA = paataTila({ VITE_TILA: import.meta.env.VITE_TILA });
const API = import.meta.env.VITE_API_URL ?? '/api';

function Sovellus({ client }: { client: KpClient }) {
  // Yksi reititin clientia kohden: uusi reititin jokaisella renderöinnillä (esim. kun
  // PilviPortti renderöi uudelleen) remounttaisi koko sovelluksen ja hukkaisi lomakkeiden tilan.
  // Uusi client (uusi kirjautuminen) saa uuden reitittimen, jottei konteksti jää vanhaan.
  const router = useMemo(() => luoRouter(client), [client]);
  return (
    <QueryClientProvider client={queryClient}>
      <KpClientProvider client={client}>
        <RouterProvider router={router} />
      </KpClientProvider>
    </QueryClientProvider>
  );
}

// Bootstrap ajetaan vain oikeassa selainympäristössä. Testeissä (Vitest asettaa
// import.meta.env.MODE === 'test') tämä tiedosto importataan pelkän paataTila-funktion vuoksi;
// jsdom-dokumentissa ei ole juuri-elementtiä eikä OPFS-avaus toimi siellä (ks. makeClient.test.ts).
if (import.meta.env.MODE !== 'test') {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('root-elementti puuttuu');

  // Paikallistilassa odotetaan async OPFS-clientia ennen renderiä; pilvitilassa PilviPortti hoitaa
  // kirjautumisen ja tuottaa autentikoidun clientin vasta tunnistautumisen jälkeen.
  void (async () => {
    if (TILA === 'cloud') {
      createRoot(rootEl).render(
        <StrictMode>
          <PilviPortti baseUrl={API} lapset={(client) => <Sovellus client={client} />} />
        </StrictMode>,
      );
      return;
    }
    if (TILA === 'tyopoyta') {
      // Työpöydällä palvelin on paikallinen ja käyttäjä on jo koneellaan — ei kirjautumisporttia.
      // Suodatinmuisti ladataan asetuksista ennen renderöintiä (reitit lukevat sen synkronisesti).
      const [client] = await Promise.all([makeClient('cloud', { baseUrl: API }), alustaMuisti()]);
      createRoot(rootEl).render(
        <StrictMode>
          <Sovellus client={client} />
        </StrictMode>,
      );
      return;
    }
    if (DEMO) {
      // Selaindemo: muistissa oleva demokirjanpito, ks. demo/kaynnistaDemo.tsx.
      const { kaynnistaDemo } = await import('@/demo/kaynnistaDemo');
      const { client, Kehys } = await kaynnistaDemo();
      createRoot(rootEl).render(
        <StrictMode>
          <Kehys>
            <Sovellus client={client} />
          </Kehys>
        </StrictMode>,
      );
      return;
    }
    const client = await makeClient('local');
    createRoot(rootEl).render(
      <StrictMode>
        <Sovellus client={client} />
      </StrictMode>,
    );
  })();
}
