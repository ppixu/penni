import { tallennaPalkkaAjo } from '@/palkat/tallennaPalkkaAjo';
import { luonnosA, palkkaSiemen } from '@/test/palkkaFikstuuri';
import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { TositeTila } from '@penni/engine';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const NYT = '2026-11-01T08:00:00.000Z';

async function ajoA(client: KpClient) {
  await tallennaPalkkaAjo(client, luonnosA(), undefined, () => NYT);
}

const alkuperaiset = {
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

afterEach(() => {
  Object.assign(URL, alkuperaiset);
  vi.restoreAllMocks();
});

/** Selaimen lataus: palauttaa ladattujen tiedostojen nimet. */
function seuraaLatauksia(): string[] {
  const nimet: string[] = [];
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:palkka'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    nimet.push(this.download);
  });
  return nimet;
}

describe('/palkat/$id', () => {
  it('näyttää yhteenvedon, määräpäivän ja toiminnot', async () => {
    await renderRoute('/palkat/1', { seed: palkkaSiemen(), arrange: ajoA });
    const yhteenveto = await screen.findByRole('table', { name: 'Palkka-ajon henkilöt' });
    expect(within(yhteenveto).getByText('Testinen Aino')).toBeInTheDocument();
    expect(within(yhteenveto).getAllByText('2 203,66 €').length).toBeGreaterThan(0);
    // Maksupäivä 31.10.2026 (la) + 5 päivää = to 5.11.2026
    expect(screen.getByText(/Määräpäivä 5\.11\.2026/)).toBeInTheDocument();
    for (const nimi of [
      'Lataa palkkalaskelmat',
      'Lataa XML',
      'Muokkaa',
      'Poista',
      'Merkitse lähetetyksi',
    ]) {
      expect(
        screen.getByRole(nimi === 'Muokkaa' ? 'link' : 'button', { name: nimi }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(/merkitse ilmoitus lähetetyksi/)).toBeInTheDocument();
    expect(screen.getByText(/Tulorekisterin asiointipalvelussa/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Avaa tosite' })).toHaveAttribute(
      'href',
      '/tositteet/1',
    );
  });

  it('Lataa XML ja palkkalaskelmat lataavat tiedostot, eivät tallenna liitteitä', async () => {
    const nimet = seuraaLatauksia();
    const { user, client } = await renderRoute('/palkat/1', {
      seed: palkkaSiemen(),
      arrange: ajoA,
    });
    await user.click(await screen.findByRole('button', { name: 'Lataa XML' }));
    await waitFor(() => expect(nimet).toContain('palkkatietoilmoitus-2026-10-31.xml'));
    await user.click(screen.getByRole('button', { name: 'Lataa palkkalaskelmat' }));
    await waitFor(() => expect(nimet).toContain('palkkalaskelma-testinen-2026-10-31.pdf'));
    expect(await client.haeLiitteet(1)).toHaveLength(0);
  });

  it('puuttuva Y-tunnus estää XML:n ja ohjaa kirjan asetuksiin', async () => {
    seuraaLatauksia();
    const { user } = await renderRoute('/palkat/1', {
      seed: palkkaSiemen({ Ytunnus: '' }),
      arrange: ajoA,
    });
    await user.click(await screen.findByRole('button', { name: 'Lataa XML' }));
    const viesti = await screen.findByRole('alert');
    expect(viesti).toHaveTextContent('Y-tunnus puuttuu');
    expect(within(viesti).getByRole('link')).toHaveAttribute('href', '/asetukset');
  });

  it('Merkitse lähetetyksi: tiiviste ja liitteet, sen jälkeen vain lataukset', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, client } = await renderRoute('/palkat/1', {
      seed: palkkaSiemen(),
      arrange: ajoA,
    });
    await user.click(await screen.findByRole('button', { name: 'Merkitse lähetetyksi' }));

    expect(await screen.findByText(/^Lähetetty \d+\.\d+\.\d{4}$/)).toBeInTheDocument();
    const t = await client.haeTosite(1);
    expect(t?.palkka?.ilmoitus?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await client.haeLiitteet(1)).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Muokkaa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Poista' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merkitse lähetetyksi' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lataa XML' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lataa palkkalaskelmat' })).toBeInTheDocument();
  });

  it('Poista poistaa tositteen pehmeästi vahvistuksen jälkeen', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, client, router } = await renderRoute('/palkat/1', {
      seed: palkkaSiemen(),
      arrange: ajoA,
    });
    await user.click(await screen.findByRole('button', { name: 'Poista' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tositteet'));
    expect((await client.haeTosite(1))?.tila).toBe(TositeTila.POISTETTU);
  });

  it('muu kuin palkka-ajo: ohjataan tositteelle', async () => {
    await renderRoute('/palkat/1', {
      seed: palkkaSiemen(),
      arrange: async (c) => {
        await c.luoTosite({ pvm: '2026-10-31', tyyppi: 0, sarja: '', tila: 100, viennit: [] });
      },
    });
    expect(await screen.findByText('Tosite ei ole palkka-ajo.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Avaa tosite' })).toHaveAttribute(
      'href',
      '/tositteet/1',
    );
  });
});

describe('/palkat/$id/muokkaa', () => {
  it('avaa tallennetun ajon lomakkeelle ja tallentaa saman tositteen', async () => {
    const { user, client, router } = await renderRoute('/palkat/1/muokkaa', {
      seed: palkkaSiemen(),
      arrange: ajoA,
    });
    const osio = await screen.findByRole('region', { name: 'Testinen Aino' });
    expect(within(osio).getByLabelText('Kilometrikorvaus: määrä')).toHaveValue('100');
    expect(screen.getByText(/Tulorekisterin asiointipalvelussa/)).toBeInTheDocument();
    await user.selectOptions(within(osio).getByLabelText('Lisää rivi'), 'lisa');
    const lisa = within(osio).getByLabelText('Kertaluonteinen lisä: summa');
    await user.type(lisa, '100');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/palkat/1'));
    const t = await client.haeTosite(1);
    expect(t?.palkka?.henkilot[0]?.tulos.rahapalkka).toBe(310_000);
    expect(t?.palkka?.laskettu).not.toBe(NYT);
    expect(await client.listaaTositteet({})).toHaveLength(1);
  });

  it('lähetetyksi merkittyä ajoa ei voi muokata', async () => {
    const { merkitseLahetetyksi } = await import('@/palkat/tallennaPalkkaAjo');
    await renderRoute('/palkat/1/muokkaa', {
      seed: palkkaSiemen(),
      arrange: async (c) => {
        await ajoA(c);
        await merkitseLahetetyksi(c, 1, () => NYT);
      },
    });
    expect(await screen.findByText(/merkitty lähetetyksi/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tallenna' })).not.toBeInTheDocument();
  });
});
