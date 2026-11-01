import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 9170, tyyppi: 'C', nimi: { fi: 'Korkotuotot myyntisaamisista' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'false',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    LaskuMaksutili: '1910',
    LaskuMaksumuistutustili: '9170',
    LaskuViivastyskorkotili: '9170',
    LaskuIban: 'FI2112345600000785',
  },
};

/** Lasku 1 (1000 €, eräpäivä 30.4.) ja sille muistutusluonnos 2 (maksu 5 €, korko 11,5 %). */
async function luonnos(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  await c.tallennaMyyntilasku({
    pvm: '2026-04-01',
    erapvm: '2026-04-30',
    kumppani: asiakas.id,
    rivit: [{ myyntiKpl: 1, aNetto: 1000, alvKoodi: 0, alvProsentti: 0 }],
  });
  await c.luoMaksumuistutukset({
    tositteet: [1],
    pvm: '2026-05-30',
    korko: true,
    viivkorko: 11.5,
    maksu: 500 as never,
  });
}

async function kirjattu(c: KpClient) {
  await luonnos(c);
  await c.kirjaaLaskuluonnos(2);
}

const alkuperaiset = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
afterEach(() => {
  Object.assign(URL, alkuperaiset);
  vi.restoreAllMocks();
});

describe('Kirjattu maksumuistutus', () => {
  it('näyttää erittelyn ja linkin alkuperäiseen laskuun', async () => {
    const { router, user } = await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: kirjattu,
    });
    const erittely = await screen.findByRole('region', { name: 'muistutuksen erittely' });
    expect(within(erittely).getByText('Laskun avoin saldo').closest('div')).toHaveTextContent(
      '1 000,00 €',
    );
    expect(within(erittely).getByText('Huomautuskulut').closest('div')).toHaveTextContent('5,00 €');
    const korko = within(erittely).getByText(/^Viivästyskorko 1\.5\.2026–30\.5\.2026, 11,50 %/);
    expect(korko.closest('div')).toHaveTextContent('9,45 €');
    expect(within(erittely).getByText('Maksettava yhteensä').closest('div')).toHaveTextContent(
      '1 014,45 €',
    );
    expect(screen.getByText('Maksumuistutus 2')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Lataa PDF' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Kirjaa ja lataa PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Poista' })).not.toBeInTheDocument();
    // Dokumenttireitti ei ohjaa tositenäkymään.
    expect(router.state.location.pathname).toBe('/myyntilaskut/2');

    const linkki = await screen.findByRole('link', { name: 'Lasku 1' });
    expect(linkki).toHaveAttribute('href', '/myyntilaskut/1');
    await user.click(linkki);
    await waitFor(() => expect(router.state.location.pathname).toBe('/myyntilaskut/1'));
  });

  it('Lataa PDF lataa muistutuksen aiempine asiakirjoineen', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:m'), revokeObjectURL: vi.fn() });
    const klikki = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user, client } = await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: kirjattu,
    });
    const haeTosite = vi.spyOn(client, 'haeTosite');
    await user.click(await screen.findByRole('button', { name: 'Lataa PDF' }));
    await waitFor(() => expect(klikki).toHaveBeenCalledTimes(1));
    expect(haeTosite).toHaveBeenCalledWith(1); // aiemmat-ketjun alkuperäinen lasku
  }, 30_000);
});

describe('Maksumuistutusluonnos', () => {
  it('näyttää erittelyn, Kirjaa ja lataa PDF -napin ja Poista-napin', async () => {
    const { router } = await renderRoute('/myyntilaskut/2', { seed: SEED, arrange: luonnos });
    const erittely = await screen.findByRole('region', { name: 'muistutuksen erittely' });
    expect(within(erittely).getByText('Laskun avoin saldo')).toBeInTheDocument();
    expect(within(erittely).getByText('Huomautuskulut')).toBeInTheDocument();
    expect(within(erittely).getByText(/^Viivästyskorko/)).toBeInTheDocument();
    expect(within(erittely).getByText('Maksettava yhteensä').closest('div')).toHaveTextContent(
      '1 014,45 €',
    );
    expect(screen.getByRole('button', { name: 'Kirjaa ja lataa PDF' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Poista' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Lataa PDF' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/myyntilaskut/2');
  });

  it('Kirjaa ja lataa PDF kirjaa luonnoksen, lataa PDF:n ja vaihtaa kirjattuun näkymään', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:m'), revokeObjectURL: vi.fn() });
    const klikki = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user, client } = await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: luonnos,
    });
    const kirjaa = vi.spyOn(client, 'kirjaaLaskuluonnos');
    await user.click(await screen.findByRole('button', { name: 'Kirjaa ja lataa PDF' }));

    await waitFor(() => expect(kirjaa).toHaveBeenCalledWith(2, undefined));
    await waitFor(() => expect(klikki).toHaveBeenCalledTimes(1));
    expect((await client.haeTosite(2))?.tila).toBe(100);
    await waitFor(async () => expect(await client.haeLiitteet(2)).toHaveLength(1));
    // Näkymä vaihtuu kirjattuun muistutukseen.
    expect(await screen.findByRole('button', { name: 'Lataa PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kirjaa ja lataa PDF' })).not.toBeInTheDocument();
  }, 30_000);

  it('estetty PDF (ei IBANia): muistutus kirjataan ja syy näkyy kirjatussa näkymässä', async () => {
    const klikki = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { LaskuIban: _pois, ...ilmanIbania } = SEED.asetukset;
    const { user, client } = await renderRoute('/myyntilaskut/2', {
      seed: { ...SEED, asetukset: ilmanIbania },
      arrange: luonnos,
    });
    await user.click(await screen.findByRole('button', { name: 'Kirjaa ja lataa PDF' }));
    expect(
      await screen.findByText(/PDF:ää ei ladattu: Lisää IBAN asetuksissa/),
    ).toBeInTheDocument();
    expect((await client.haeTosite(2))?.tila).toBe(100);
    expect(klikki).not.toHaveBeenCalled();
  });

  it('kirjausvirhe näytetään eikä luonnos katoa', async () => {
    const { user, client } = await renderRoute('/myyntilaskut/2', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, LaskuMaksumuistutustili: '' } },
      arrange: luonnos,
    });
    const kirjaa = vi.spyOn(client, 'kirjaaLaskuluonnos');
    await user.click(await screen.findByRole('button', { name: 'Kirjaa ja lataa PDF' }));
    await waitFor(() => expect(kirjaa).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toHaveTextContent('Laskutuksen tili puuttuu');
    expect(screen.getByRole('button', { name: 'Kirjaa ja lataa PDF' })).toBeInTheDocument();
  });

  it('Poista poistaa luonnoksen vahvistuksen jälkeen ja palaa Lähtevät-listaan', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user, client, router } = await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: luonnos,
    });
    await user.click(await screen.findByRole('button', { name: 'Poista' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tositteet'));
    expect(router.state.location.search).toMatchObject({ laji: 'tulot', valilehti: 'lahtevat' });
    expect(await client.listaaLaskuluonnokset()).toHaveLength(0);
  });

  it('Poista ei tee mitään, jos käyttäjä ei vahvista', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, client } = await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: luonnos,
    });
    await user.click(await screen.findByRole('button', { name: 'Poista' }));
    expect(await client.listaaLaskuluonnokset()).toHaveLength(1);
  });
});

describe('Lähtevät — muistutusluonnos', () => {
  it('rivi avaa muistutusluonnoksen /myyntilaskut/$id', async () => {
    const { user, router } = await renderRoute('/tositteet?laji=tulot&valilehti=lahtevat', {
      seed: SEED,
      arrange: luonnos,
    });
    await user.click(await screen.findByRole('row', { name: /Maksumuistutus/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/myyntilaskut/2'));
    expect(
      await screen.findByRole('region', { name: 'muistutuksen erittely' }),
    ).toBeInTheDocument();
  });
});
