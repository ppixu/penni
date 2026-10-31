import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.js';

function renderShell() {
  const root = createRootRoute({
    component: () => (
      <AppShell kirjanpito="Testi Oy">
        <p>sisältö</p>
      </AppShell>
    ),
  });
  const sivut = ['/', '/a', '/b'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren(sivut),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return { router, polku: () => router.state.location.pathname };
}

async function siirry(router: ReturnType<typeof renderShell>['router'], to: string) {
  await act(() => router.navigate({ to }));
}

const takaisin = () => screen.getByRole('button', { name: 'Takaisin' });
const eteenpain = () => screen.getByRole('button', { name: 'Eteenpäin' });

describe('Takaisin / Eteenpäin -napit', () => {
  it('ovat pois käytöstä, kun historiassa ei ole minne mennä', async () => {
    renderShell();
    expect(await screen.findByRole('button', { name: 'Takaisin' })).toBeDisabled();
    expect(eteenpain()).toBeDisabled();
  });

  it('kulkevat historiassa kuten selaimen napit', async () => {
    const user = userEvent.setup();
    const { router, polku } = renderShell();
    await screen.findByRole('button', { name: 'Takaisin' });
    await siirry(router, '/a');
    await siirry(router, '/b');
    expect(takaisin()).toBeEnabled();
    expect(eteenpain()).toBeDisabled();

    await user.click(takaisin());
    await vi.waitFor(() => expect(polku()).toBe('/a'));
    expect(eteenpain()).toBeEnabled();

    await user.click(takaisin());
    await vi.waitFor(() => expect(polku()).toBe('/'));
    expect(takaisin()).toBeDisabled();

    await user.click(eteenpain());
    await vi.waitFor(() => expect(polku()).toBe('/a'));
    expect(takaisin()).toBeEnabled();
    expect(eteenpain()).toBeEnabled();
  });

  it('uusi siirtymä katkaisee eteenpäin-historian', async () => {
    const user = userEvent.setup();
    const { router, polku } = renderShell();
    await screen.findByRole('button', { name: 'Takaisin' });
    await siirry(router, '/a');
    await user.click(takaisin());
    await vi.waitFor(() => expect(polku()).toBe('/'));
    expect(eteenpain()).toBeEnabled();
    await siirry(router, '/b');
    expect(eteenpain()).toBeDisabled();
  });
});

describe('Historiaeleet (työpöytä)', () => {
  afterEach(() => {
    window.penni = undefined;
    vi.restoreAllMocks();
  });

  function tyopoyta({ mac }: { mac: boolean }) {
    // Pelkkä sillan olemassaolo kertoo Electron-kuoresta (onkoTyopoyta).
    window.penni = {} as NonNullable<typeof window.penni>;
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(mac ? 'MacIntel' : 'Win32');
  }

  async function kahdenSivunJalkeen() {
    const r = renderShell();
    await screen.findByRole('button', { name: 'Takaisin' });
    await siirry(r.router, '/a');
    await siirry(r.router, '/b');
    return r;
  }

  it('macOS: Cmd+[ palaa ja Cmd+] etenee', async () => {
    tyopoyta({ mac: true });
    const { polku } = await kahdenSivunJalkeen();
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft', metaKey: true });
    await vi.waitFor(() => expect(polku()).toBe('/a'));
    fireEvent.keyDown(document.body, { key: ']', code: 'BracketRight', metaKey: true });
    await vi.waitFor(() => expect(polku()).toBe('/b'));
  });

  it('Alt+← palaa muilla alustoilla, mutta ei kentässä kirjoitettaessa', async () => {
    tyopoyta({ mac: false });
    const { polku } = await kahdenSivunJalkeen();
    const kentta = document.createElement('input');
    document.body.append(kentta);
    fireEvent.keyDown(kentta, { key: 'ArrowLeft', altKey: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(polku()).toBe('/b');
    kentta.remove();

    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    await vi.waitFor(() => expect(polku()).toBe('/a'));
  });

  it('Alt+← ei siirry, jos sivun oma kuuntelija (tositteen Edellinen) käsitteli sen', async () => {
    tyopoyta({ mac: false });
    const { polku } = await kahdenSivunJalkeen();
    // Rekisteröity Historiaeleiden JÄLKEEN, kuten tositesivulle siirryttäessä.
    const sivunOma = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', sivunOma);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    await new Promise((r) => setTimeout(r, 10));
    window.removeEventListener('keydown', sivunOma);
    expect(polku()).toBe('/b');
  });

  it('hiiren takaisin-sivunappi (button 3) palaa macOS:llä', async () => {
    tyopoyta({ mac: true });
    const { polku } = await kahdenSivunJalkeen();
    fireEvent.mouseUp(document.body, { button: 3 });
    await vi.waitFor(() => expect(polku()).toBe('/a'));
  });

  it('kahden sormen vaakapyyhkäisy palaa ja näyttää reunaosoittimen', async () => {
    tyopoyta({ mac: true });
    const { polku } = await kahdenSivunJalkeen();
    act(() => {
      fireEvent.wheel(document.body, { deltaX: -12, deltaY: 0 });
      fireEvent.wheel(document.body, { deltaX: -12, deltaY: 0 });
    });
    expect(screen.getByTestId('pyyhkaisyosoitin')).toHaveAttribute('data-suunta', 'takaisin');
    expect(polku()).toBe('/b');
    act(() => {
      for (let i = 0; i < 15; i++) fireEvent.wheel(document.body, { deltaX: -12, deltaY: 0 });
    });
    await vi.waitFor(() => expect(polku()).toBe('/a'));
  });

  it('pyyhkäisy vieritettävän taulukon päällä vierittää taulukkoa eikä siirry', async () => {
    tyopoyta({ mac: true });
    const { polku } = await kahdenSivunJalkeen();
    const taulukko = document.createElement('div');
    taulukko.style.overflowX = 'auto';
    Object.defineProperty(taulukko, 'scrollWidth', { value: 1000 });
    Object.defineProperty(taulukko, 'clientWidth', { value: 400 });
    taulukko.scrollLeft = 300;
    document.body.append(taulukko);
    act(() => {
      for (let i = 0; i < 30; i++) fireEvent.wheel(taulukko, { deltaX: -12, deltaY: 0 });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(polku()).toBe('/b');
    expect(screen.queryByTestId('pyyhkaisyosoitin')).toBeNull();
    taulukko.remove();
  });

  it('pääprosessin app-command (sillan kautta) siirtää historiassa', async () => {
    let kuuntelija: ((suunta: string) => void) | undefined;
    const lopeta = vi.fn();
    window.penni = {
      kuunteleNavigointi: (k: (suunta: string) => void) => {
        kuuntelija = k;
        return lopeta;
      },
    } as unknown as NonNullable<typeof window.penni>;
    const { polku } = await kahdenSivunJalkeen();
    act(() => kuuntelija?.('takaisin'));
    await vi.waitFor(() => expect(polku()).toBe('/a'));
    act(() => kuuntelija?.('eteenpain'));
    await vi.waitFor(() => expect(polku()).toBe('/b'));
  });

  it('tavallisessa selaimessa eleitä ei käsitellä (selain hoitaa ne itse)', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { polku } = await kahdenSivunJalkeen();
    fireEvent.keyDown(document.body, { key: '[', metaKey: true });
    fireEvent.mouseUp(document.body, { button: 3 });
    act(() => {
      for (let i = 0; i < 30; i++) fireEvent.wheel(document.body, { deltaX: -12, deltaY: 0 });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(polku()).toBe('/b');
  });
});
