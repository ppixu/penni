import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  },
};

const rivit = [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0 }];

/** Laskut 1 ja 2 erääntyneitä, lasku 3 ei vielä erääntynyt. */
async function laskut(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  for (const erapvm of ['2026-05-24', '2026-05-25', '2026-12-24'])
    await c.tallennaMyyntilasku({ pvm: '2026-05-10', erapvm, kumppani: asiakas.id, rivit });
}

/** Lasku 1 on muistutettu kahdesti (kirjatut muistutukset 4 ja 5). */
async function muistutettuKahdesti(c: KpClient) {
  await laskut(c);
  for (const pvm of ['2026-06-01', '2026-07-01']) {
    const [luonnos] = await c.luoMaksumuistutukset({
      tositteet: [1],
      pvm,
      korko: false,
      maksu: 500 as never,
    });
    await c.kirjaaLaskuluonnos(luonnos?.id as number);
  }
}

// Päivä kiinnitetään: "erääntynyt" ja muistutuksen päivä riippuvat ajopäivästä.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Tulot — maksumuistutukset', () => {
  it('valitsee kaksi erääntynyttä laskua, luo muistutukset ja ohjaa Lähtevät-listaan', async () => {
    const { user, client } = await renderRoute('/tositteet?laji=tulot', {
      seed: SEED,
      arrange: laskut,
    });
    await screen.findByRole('row', { name: /1 .*Asiakas Oy/ });
    // Valintaruutu vain erääntyneillä laskuilla.
    expect(screen.queryByLabelText('Valitse lasku 3 muistutettavaksi')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Muistuta \(/ })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Valitse lasku 1 muistutettavaksi'));
    await user.click(screen.getByLabelText('Valitse lasku 2 muistutettavaksi'));
    const luo = vi.spyOn(client, 'luoMaksumuistutukset');
    await user.click(screen.getByRole('button', { name: 'Muistuta (2)' }));

    const dialogi = await screen.findByRole('dialog', { name: 'Maksumuistutus' });
    await user.click(within(dialogi).getByRole('button', { name: 'Luo muistutukset' }));

    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    const syote = luo.mock.calls[0]?.[0];
    expect([...(syote?.tositteet ?? [])].sort()).toEqual([1, 2]);
    expect(syote).toMatchObject({ pvm: '2026-09-15', maksu: 500, korko: true });
    expect(await screen.findByText(/2 muistutusta odottaa Lähtevissä/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Avaa Lähtevät' })).toBeInTheDocument();
    // Valinta nollautuu ja luonnokset ovat Lähtevissä.
    expect(screen.queryByRole('button', { name: /^Muistuta \(/ })).not.toBeInTheDocument();
    expect(await client.listaaLaskuluonnokset()).toHaveLength(2);
  });

  it('rivin Muistuta-nappi muistuttaa vain sen laskun', async () => {
    const { user, client } = await renderRoute('/tositteet?laji=tulot', {
      seed: SEED,
      arrange: laskut,
    });
    await screen.findByRole('row', { name: /1 .*Asiakas Oy/ });
    const luo = vi.spyOn(client, 'luoMaksumuistutukset');
    await user.click(screen.getByRole('button', { name: 'Muistuta laskusta 2' }));
    await user.click(await screen.findByRole('button', { name: 'Luo muistutukset' }));
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    expect(luo.mock.calls[0]?.[0]).toMatchObject({ tositteet: [2] });
    expect(await screen.findByText(/1 muistutus odottaa Lähtevissä/)).toBeInTheDocument();
  });

  it('moottorin virhe näkyy dialogissa', async () => {
    const { user, client } = await renderRoute('/tositteet?laji=tulot', {
      seed: SEED,
      arrange: laskut,
    });
    await screen.findByRole('row', { name: /1 .*Asiakas Oy/ });
    // Toinen muistutus ennen edellisen eräpäivää ei kelpaa: moottori vastaa EIMUISTUTETTAVA.
    const [luonnos] = await client.luoMaksumuistutukset({
      tositteet: [1],
      pvm: '2026-09-15',
      korko: false,
    });
    await client.kirjaaLaskuluonnos(luonnos?.id as number);
    await user.click(screen.getByLabelText('Valitse lasku 1 muistutettavaksi'));
    await user.click(screen.getByRole('button', { name: 'Muistuta (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Luo muistutukset' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Laskusta ei voi tehdä muistutusta');
    expect(screen.getByRole('dialog', { name: 'Maksumuistutus' })).toBeInTheDocument();
  });

  it('muistutettu lasku saa merkinnän Muistutettu ×2; muistutusrivi on Muistutus ilman tilaa ja toimintoja', async () => {
    await renderRoute('/tositteet?laji=tulot', { seed: SEED, arrange: muistutettuKahdesti });
    const rivi1 = (await screen.findByText('Muistutettu ×2')).closest('tr') as HTMLElement;
    expect(rivi1).toHaveTextContent('Lasku');
    // Laskulla on yhä avointa saldoa: sillä on sekä Muistuta että Kirjaa maksu.
    expect(within(rivi1).getByRole('button', { name: 'Muistuta laskusta 1' })).toBeInTheDocument();
    expect(within(rivi1).getByRole('button', { name: 'Kirjaa maksu' })).toBeInTheDocument();

    const muistutusRivit = screen
      .getAllByText('Muistutus', { selector: 'span' })
      .map((e) => e.closest('tr') as HTMLElement);
    expect(muistutusRivit).toHaveLength(2);
    for (const rivi of muistutusRivit) {
      expect(rivi).not.toHaveTextContent('Suora');
      expect(rivi).toHaveTextContent('5,00 €'); // summa = maksu + korko
      expect(within(rivi).queryByRole('button')).not.toBeInTheDocument(); // ei Muistuta/Kirjaa maksu
      expect(within(rivi).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(rivi.querySelector('[data-tila]')).toBeNull(); // ei omaa maksettu/avoin-tilaa
      expect(rivi).not.toHaveTextContent('Muistutettu');
    }
  });

  it('muistutusrivin klikkaus avaa muistutusnäkymän', async () => {
    const { user, router } = await renderRoute('/tositteet?laji=tulot', {
      seed: SEED,
      arrange: muistutettuKahdesti,
    });
    await screen.findByText('Muistutettu ×2');
    const rivi = screen.getAllByText('Muistutus', { selector: 'span' })[0]?.closest('tr');
    await user.click(rivi as HTMLElement);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/myyntilaskut\/[45]$/));
  });
});
