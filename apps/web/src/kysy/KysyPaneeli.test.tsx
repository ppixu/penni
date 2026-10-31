import type { KysySilta, KysyTapahtuma, KysyTila } from '@penni/kysy';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../components/shell/AppShell.js';
import { KysyPaneeli } from './KysyPaneeli.js';

afterEach(() => {
  window.penni = undefined;
});

/** window.penni tukee vain Kysy-metodeja — muut sillat eivät kuulu tähän testiin. */
function luoSilta(yliajot: Partial<KysySilta> = {}): KysySilta {
  return {
    kysyTila: vi.fn(async (): Promise<KysyTila> => ({ ok: true, malli: 'qwen3.5:2b' })),
    kysy: vi.fn(async () => {}),
    kysyPeruuta: vi.fn(async () => {}),
    ...yliajot,
  };
}

function asetaSilta(silta: KysySilta): void {
  window.penni = silta as unknown as typeof window.penni;
}

/** Ajaa annetut tapahtumat kysy():n käsittelijän läpi synkronisesti — kuvaa mallin työkalukutsuja. */
function skriptoituKysy(tapahtumat: readonly KysyTapahtuma[]): KysySilta['kysy'] {
  const fn: KysySilta['kysy'] = (kysymysId, _kysymys, kasittelija) => {
    for (const e of tapahtumat) kasittelija({ ...e, kysymysId });
    return Promise.resolve();
  };
  return vi.fn(fn);
}

describe('KysyPaneeli', () => {
  it('näyttää mallin ja sallii kysymyksen syöttämisen kun tila on ok', async () => {
    asetaSilta(luoSilta());
    render(<KysyPaneeli auki sulje={vi.fn()} />);

    expect(await screen.findByText('qwen3.5:2b')).toBeInTheDocument();
    expect(screen.getByLabelText('Kysymys')).toBeEnabled();
  });

  it('merkitsee ominaisuuden betaksi otsikossa', async () => {
    asetaSilta(luoSilta());
    render(<KysyPaneeli auki sulje={vi.fn()} />);

    const paneeli = await screen.findByLabelText('Kysy kirjanpitäjältä');
    expect(within(paneeli).getByText('beta')).toBeInTheDocument();
  });

  it('näyttää korjausohjeen ja poistaa syötteen käytöstä kun tila ei ole ok', async () => {
    asetaSilta(
      luoSilta({
        kysyTila: vi.fn(
          async (): Promise<KysyTila> => ({
            ok: false,
            viesti: 'Ollamaan ei saatu yhteyttä.',
            korjaus: 'ollama serve',
          }),
        ),
      }),
    );
    render(<KysyPaneeli auki sulje={vi.fn()} />);

    expect(await screen.findByText('Ollamaan ei saatu yhteyttä.')).toBeInTheDocument();
    expect(screen.getByText('ollama serve')).toBeInTheDocument();
    expect(screen.getByLabelText('Kysymys')).toBeDisabled();
  });

  it('lähettää kysymyksen ja näyttää työkaluaskeleen sekä vastauksen', async () => {
    const kysy = skriptoituKysy([
      { tyyppi: 'tyokalu_alkoi', kutsuId: 1, nimi: 'saldot', syote: {} },
      { tyyppi: 'tyokalu_valmis', kutsuId: 1, nimi: 'saldot', tulos: { saldo: 100 } },
      { tyyppi: 'vastaus', teksti: 'Kassassa on 100 euroa.' },
    ]);
    asetaSilta(luoSilta({ kysy }));
    const user = userEvent.setup();
    render(<KysyPaneeli auki sulje={vi.fn()} />);

    await screen.findByText('qwen3.5:2b');
    await user.type(screen.getByLabelText('Kysymys'), 'Paljonko kassassa on rahaa?');
    await user.click(screen.getByRole('button', { name: 'Lähetä' }));

    expect(screen.getByText('Paljonko kassassa on rahaa?')).toBeInTheDocument();
    expect(screen.getByText('Katsoin: saldot')).toBeInTheDocument();
    expect(await screen.findByText('Kassassa on 100 euroa.')).toBeInTheDocument();
    expect(kysy).toHaveBeenCalledWith(1, 'Paljonko kassassa on rahaa?', expect.any(Function));
  });

  it('näyttää virhetapahtuman viestin ja korjauksen, ja sallii uuden kysymyksen', async () => {
    const kysy = skriptoituKysy([
      {
        tyyppi: 'virhe',
        koodi: 'kutsu',
        viesti: 'Ollama katkaisi yhteyden.',
        korjaus: 'ollama serve',
      },
    ]);
    asetaSilta(luoSilta({ kysy }));
    const user = userEvent.setup();
    render(<KysyPaneeli auki sulje={vi.fn()} />);

    await screen.findByText('qwen3.5:2b');
    await user.type(screen.getByLabelText('Kysymys'), 'Kysymys');
    await user.click(screen.getByRole('button', { name: 'Lähetä' }));

    expect(await screen.findByText('Ollama katkaisi yhteyden.')).toBeInTheDocument();
    expect(screen.getByText('ollama serve')).toBeInTheDocument();
    expect(screen.getByLabelText('Kysymys')).toBeEnabled();
  });

  it('säilyttää edellisen kysymyksen työkaluaskeleen tuloksen kun seuraava kysymys käyttää samaa kutsuId:tä', async () => {
    // silmukka.ts nollaa kutsuId-laskurin joka kysymykselle, joten molemmat kysymykset käyttävät
    // tässä kutsuId:tä 1 — rivit on silti eroteltava kysymysId:llä, tai toisen kysymyksen tulos
    // ylikirjoittaisi ensimmäisen jo valmiin askeleen (ks. korjattava löydös).
    const vastaukset: Record<number, readonly KysyTapahtuma[]> = {
      1: [
        { tyyppi: 'tyokalu_alkoi', kutsuId: 1, nimi: 'saldot', syote: {} },
        { tyyppi: 'tyokalu_valmis', kutsuId: 1, nimi: 'saldot', tulos: { saldo: 100 } },
        { tyyppi: 'vastaus', teksti: 'Ensimmäinen vastaus.' },
      ],
      2: [
        { tyyppi: 'tyokalu_alkoi', kutsuId: 1, nimi: 'saldot', syote: {} },
        { tyyppi: 'tyokalu_valmis', kutsuId: 1, nimi: 'saldot', tulos: { saldo: 200 } },
        { tyyppi: 'vastaus', teksti: 'Toinen vastaus.' },
      ],
    };
    const kysy: KysySilta['kysy'] = vi.fn((kysymysId, _kysymys, kasittelija) => {
      for (const e of vastaukset[kysymysId] ?? []) kasittelija({ ...e, kysymysId });
      return Promise.resolve();
    });
    asetaSilta(luoSilta({ kysy }));
    const user = userEvent.setup();
    render(<KysyPaneeli auki sulje={vi.fn()} />);

    await screen.findByText('qwen3.5:2b');
    await user.type(screen.getByLabelText('Kysymys'), 'Ensimmäinen kysymys');
    await user.click(screen.getByRole('button', { name: 'Lähetä' }));
    await screen.findByText('Ensimmäinen vastaus.');

    await user.type(screen.getByLabelText('Kysymys'), 'Toinen kysymys');
    await user.click(screen.getByRole('button', { name: 'Lähetä' }));
    await screen.findByText('Toinen vastaus.');

    const askeleet = screen.getAllByText('Katsoin: saldot').map((el) => el.closest('details'));
    expect(askeleet).toHaveLength(2);
    // Ensimmäisen kysymyksen askel: tulos on yhä 100, ei ylikirjoittunut toisen kysymyksen 200:lla.
    expect(askeleet[0]?.textContent).toContain('"saldo": 100');
    expect(askeleet[1]?.textContent).toContain('"saldo": 200');
  });

  it('peruuttaa aktiivisen kysymyksen, jos paneeli suljetaan (unmount) kesken kyselyn', async () => {
    // kysy() ei koskaan ratkea tässä testissä — kuvaa Ollamalta odottavaa käynnissä olevaa
    // kyselyä sillä hetkellä kun käyttäjä sulkee paneelin (Esc/⌘K/X-nappi unmounttaa sisällön).
    const kysy: KysySilta['kysy'] = vi.fn(() => new Promise<void>(() => {}));
    const kysyPeruuta = vi.fn(async () => {});
    asetaSilta(luoSilta({ kysy, kysyPeruuta }));
    const user = userEvent.setup();
    const { unmount } = render(<KysyPaneeli auki sulje={vi.fn()} />);

    await screen.findByText('qwen3.5:2b');
    await user.type(screen.getByLabelText('Kysymys'), 'Kysymys kesken');
    await user.click(screen.getByRole('button', { name: 'Lähetä' }));
    await screen.findByRole('button', { name: 'Peruuta' });

    unmount();

    expect(kysyPeruuta).toHaveBeenCalledWith(1);
  });

  it('ei näytä paneelia eikä sivupalkin Kysy-nappia ilman siltaa', async () => {
    window.penni = undefined;
    const root = createRootRoute({
      component: () => (
        <AppShell kirjanpito="Testi Oy">
          <main aria-label="sisalto">sisältö</main>
        </AppShell>
      ),
    });
    const index = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
    const router = createRouter({
      routeTree: root.addChildren([index]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Penni')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kysy' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Kysy kirjanpitäjältä')).not.toBeInTheDocument();
  });
});
