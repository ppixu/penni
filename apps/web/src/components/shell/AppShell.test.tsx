import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell.js';

function renderShell(polku = '/') {
  const root = createRootRoute({
    component: () => (
      <AppShell kirjanpito="Testi Oy">
        <main aria-label="sisalto">sisältö</main>
      </AppShell>
    ),
  });
  const reitti = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([reitti('/'), reitti('/tositteet/uusi'), reitti('/tositteet/$id')]),
    history: createMemoryHistory({ initialEntries: [polku] }),
  });
  return render(<RouterProvider router={router} />);
}

describe('AppShell', () => {
  it('renders the brand, nav, and book footer', async () => {
    renderShell();
    expect(await screen.findByText('Penni')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /kojelauta/i })).toBeInTheDocument();
    expect(screen.getByText('Testi Oy')).toBeInTheDocument();
  });

  it('highlights Uusi tosite, not Tositteet, on the new-voucher form', async () => {
    renderShell('/tositteet/uusi');
    const uusi = await screen.findByRole('link', { name: 'Uusi tosite' });
    expect(uusi).toHaveAttribute('href', '/tositteet/uusi');
    expect(uusi).toHaveClass('font-semibold');
    expect(screen.getByRole('link', { name: 'Tositteet' })).not.toHaveClass('font-semibold');
  });

  it('keeps Tositteet highlighted on an opened voucher', async () => {
    renderShell('/tositteet/12');
    expect(await screen.findByRole('link', { name: 'Tositteet' })).toHaveClass('font-semibold');
    expect(screen.getByRole('link', { name: 'Uusi tosite' })).not.toHaveClass('font-semibold');
  });

  it('lets content flow over several pages in print', async () => {
    renderShell();
    // renderShell's child <main aria-label="sisalto"> sits inside AppShell's own <main>.
    const sisalto = await screen.findByLabelText('sisalto');
    const main = sisalto.parentElement as HTMLElement;
    expect(main.tagName).toBe('MAIN');
    expect(main).toHaveClass('print:overflow-visible');
    expect(main.parentElement).toHaveClass('print:block', 'print:h-auto');
  });
});
