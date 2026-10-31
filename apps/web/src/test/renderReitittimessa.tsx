import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { type RenderWithProvidersOptions, renderWithProviders } from './renderWithProviders.js';

/**
 * Renderöi komponentin minimaalisen muistireitittimen juurisivulle ('/'), kun komponentti
 * tarvitsee reititinkontekstia (esim. useBlocker), mutta koko sovelluksen reittipuu olisi
 * liikaa. Toinen reitti '/tositteet' on navigoinnin kohde ("Toinen sivu").
 */
export async function renderReitittimessa(ui: ReactElement, options?: RenderWithProvidersOptions) {
  const juuri = createRootRoute({ component: Outlet });
  const etusivu = createRoute({ getParentRoute: () => juuri, path: '/', component: () => ui });
  const toinen = createRoute({
    getParentRoute: () => juuri,
    path: '/tositteet',
    component: () => <p>Toinen sivu</p>,
  });
  const router = createRouter({
    routeTree: juuri.addChildren([etusivu, toinen]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const tulos = await renderWithProviders(<RouterProvider router={router} />, options);
  return { ...tulos, router };
}
