import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Maksutapa, type TositeRivi } from '@penni/engine';
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 1715, tyyppi: 'AO', nimi: { fi: 'Ennakkosaatavat' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
    { numero: 2861, tyyppi: 'B', nimi: { fi: 'Saadut ennakot' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
    { numero: 29392, tyyppi: 'B', nimi: { fi: 'Ennakon alv' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'true',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    AlvVelkaTili: '2939',
    LaskuMaksutili: '1900',
    LaskuEnnakkosaatavat: '1715',
    LaskuEnnakkotili: '2861',
    LaskuEnnakkoALV: '29392',
  },
};

const rivi = (aNetto: number): TositeRivi => ({
  myyntiKpl: 1,
  aNetto,
  alvKoodi: 11,
  alvProsentti: 25.5,
});

/** Asiakas ja yksi kirjattu ennakkolasku (100 € + alv). */
async function ennakolla(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Ennakko Oy' });
  const ennakko = await c.tallennaMyyntilasku({
    pvm: '2026-06-01',
    kumppani: asiakas.id,
    maksutapa: Maksutapa.ENNAKKOLASKU,
    rivit: [rivi(100)],
  });
  return { asiakas, ennakko };
}

async function valitseAsiakas(user: UserEvent, nimi: string) {
  const asiakas = screen.getByRole('combobox', { name: 'Asiakas' });
  await user.click(asiakas);
  await user.type(asiakas, nimi);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Asiakas' })).toHaveValue(nimi));
}

describe('Ennakkolasku lomakkeella', () => {
  it('Maksutapa-valinnassa on Ennakkolasku: tilisarake näyttää Saadut ennakot lukulukittuna', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');
    expect(screen.queryByText('Saadut ennakot')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Ennakkolasku' }));
    expect(screen.getByRole('columnheader', { name: 'Tili' })).toBeInTheDocument();
    expect(screen.getByText('Saadut ennakot')).toBeInTheDocument();
    // Lukulukittu: sarakkeessa ei ole syötettä.
    expect(screen.getByText('Saadut ennakot').closest('td')?.querySelector('input')).toBeNull();

    // Takaisin Laskuun: sarake katoaa.
    await user.click(screen.getByRole('radio', { name: 'Lasku' }));
    expect(screen.queryByText('Saadut ennakot')).not.toBeInTheDocument();
  });

  it('vaatii asiakkaan ja eräpäivän kirjaukseen; luonnoksen saa tallentaa ilman asiakasta', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaKumppani({ nimi: 'Ennakko Oy' });
      },
    });
    await screen.findByLabelText('laskulomake');
    await user.click(screen.getByRole('radio', { name: 'Ennakkolasku' }));
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '100');
    await user.tab();

    expect(screen.getByRole('button', { name: 'Tallenna ja kirjaa' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tallenna luonnokseksi' })).toBeEnabled();

    await valitseAsiakas(user, 'Ennakko Oy');
    expect(screen.getByRole('button', { name: 'Tallenna ja kirjaa' })).toBeEnabled();

    await user.clear(screen.getByLabelText('Eräpäivä'));
    expect(screen.getByRole('button', { name: 'Tallenna ja kirjaa' })).toBeDisabled();
  });

  it('kirjaa ennakkolaskun: maksutapa 2 tallentuu ja avoin ennakko ilmestyy', async () => {
    const { user, client } = await renderRoute('/myyntilaskut/uusi', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaKumppani({ nimi: 'Ennakko Oy' });
      },
    });
    await screen.findByLabelText('laskulomake');
    await user.click(screen.getByRole('radio', { name: 'Ennakkolasku' }));
    await valitseAsiakas(user, 'Ennakko Oy');
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'Ennakko');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '100');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Tallenna ja kirjaa' }));
    expect(await screen.findByLabelText('laskudokumentti')).toBeInTheDocument();

    const [kumppani] = await client.haeKumppanit();
    const ennakot = await client.haeAvoimetEnnakot(kumppani?.id ?? 0);
    expect(ennakot).toHaveLength(1);
    expect(ennakot[0]?.avoin).toBe(10_000);
  });
});

describe('Hyvitä ennakko loppulaskulla', () => {
  it('ei nappia ennen kuin valitulla asiakkaalla on avoimia ennakkoja', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', {
      seed: SEED,
      arrange: async (c) => {
        await ennakolla(c);
        await c.tallennaKumppani({ nimi: 'Ilman Ennakkoa Oy' });
      },
    });
    await screen.findByLabelText('laskulomake');
    expect(screen.queryByRole('button', { name: 'Hyvitä ennakko' })).not.toBeInTheDocument();

    await valitseAsiakas(user, 'Ilman Ennakkoa Oy');
    // Annetaan kyselylle aika vastata, ettei "ei nappia" -väite ole vain ajoitusta.
    await waitFor(() => expect(screen.getByLabelText('laskulomake')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Hyvitä ennakko' })).not.toBeInTheDocument();
  });

  it('ei nappia ennakkolaskulla itsellään', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', {
      seed: SEED,
      arrange: async (c) => void (await ennakolla(c)),
    });
    await screen.findByLabelText('laskulomake');
    await valitseAsiakas(user, 'Ennakko Oy');
    expect(await screen.findByRole('button', { name: 'Hyvitä ennakko' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Ennakkolasku' }));
    expect(screen.queryByRole('button', { name: 'Hyvitä ennakko' })).not.toBeInTheDocument();
  });

  it('valinta lisää vähennysrivin; summa pienenee; määrän voi laskea nollaan mutta ei nostaa yli avoimen', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', {
      seed: SEED,
      arrange: async (c) => void (await ennakolla(c)),
    });
    await screen.findByLabelText('laskulomake');
    await valitseAsiakas(user, 'Ennakko Oy');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '300');
    await user.tab();

    await user.click(await screen.findByRole('button', { name: 'Hyvitä ennakko' }));
    await user.click(screen.getByRole('button', { name: /Ennakkolasku 1.*100,00/ }));

    expect(screen.getByLabelText('Selite, rivi 2')).toHaveValue('Ennakkolaskun 1 hyvitys');
    const maara = screen.getByLabelText('Ennakon vähennys, rivi 2');
    expect(maara).toHaveValue('100,00');
    const summat = screen.getByLabelText('summat');
    expect(summat).toHaveTextContent('200,00 €'); // 300 − 100 netto

    // Sama ennakko ei ole enää valittavissa (yksi rivi per ennakko ja kanta).
    expect(screen.queryByRole('button', { name: 'Hyvitä ennakko' })).not.toBeInTheDocument();

    // Alas: 30 €.
    await user.clear(maara);
    await user.type(maara, '30');
    await user.tab();
    expect(summat).toHaveTextContent('270,00 €');

    // Yli avoimen: kiinnittyy avoimeen 100 €.
    await user.clear(screen.getByLabelText('Ennakon vähennys, rivi 2'));
    await user.type(screen.getByLabelText('Ennakon vähennys, rivi 2'), '500');
    await user.tab();
    expect(screen.getByLabelText('Ennakon vähennys, rivi 2')).toHaveValue('100,00');
    expect(summat).toHaveTextContent('200,00 €');

    // Nollaan.
    await user.clear(screen.getByLabelText('Ennakon vähennys, rivi 2'));
    await user.type(screen.getByLabelText('Ennakon vähennys, rivi 2'), '0');
    await user.tab();
    expect(summat).toHaveTextContent('300,00 €');
  });

  it('kirjattu loppulasku kuluttaa ennakon ja ennakkoTosite tallentuu riville', async () => {
    const { user, client } = await renderRoute('/myyntilaskut/uusi', {
      seed: SEED,
      arrange: async (c) => {
        await ennakolla(c);
      },
    });
    await screen.findByLabelText('laskulomake');
    await valitseAsiakas(user, 'Ennakko Oy');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '300');
    await user.tab();
    await user.click(await screen.findByRole('button', { name: 'Hyvitä ennakko' }));
    await user.click(screen.getByRole('button', { name: /Ennakkolasku 1/ }));
    await user.click(screen.getByRole('button', { name: 'Tallenna ja kirjaa' }));
    expect(await screen.findByLabelText('laskudokumentti')).toBeInTheDocument();

    const lista = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    const loppu = lista.find((t) => t.maksutapa !== Maksutapa.ENNAKKOLASKU && t.tyyppi === 210);
    const vahennys = loppu?.rivit?.find((r) => r.ennakkoTosite !== undefined);
    expect(vahennys).toMatchObject({ aNetto: -100, alvKoodi: 11, tili: 2861 });
    const [kumppani] = await client.haeKumppanit();
    expect(await client.haeAvoimetEnnakot(kumppani?.id ?? 0)).toEqual([]);
  });

  it('luonnoksen uudelleentallennus säilyttää vähennysrivin ennakkoTosite-viitteen', async () => {
    const { user, client } = await renderRoute('/myyntilaskut/uusi', {
      seed: SEED,
      arrange: async (c) => {
        await ennakolla(c);
      },
    });
    await screen.findByLabelText('laskulomake');
    await valitseAsiakas(user, 'Ennakko Oy');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '300');
    await user.tab();
    await user.click(await screen.findByRole('button', { name: 'Hyvitä ennakko' }));
    await user.click(screen.getByRole('button', { name: /Ennakkolasku 1/ }));
    await user.click(screen.getByRole('button', { name: 'Tallenna luonnokseksi' }));

    await waitFor(async () => expect(await client.listaaLaskuluonnokset()).toHaveLength(1));
    const [luonnosRivi] = await client.listaaLaskuluonnokset();
    const tallennettu = await client.haeTosite(luonnosRivi?.tosite ?? 0);
    expect(tallennettu?.rivit?.[1]).toMatchObject({ ennakkoTosite: 1, tili: 2861, aNetto: -100 });
  });
});

describe('Luonnoksen vähennysrivi', () => {
  it('ladattu luonnos näyttää vähennysrivin muokattavana määränä ja rajaa sen avoimeen', async () => {
    const { user } = await renderRoute('/myyntilaskut/2', {
      seed: SEED,
      arrange: async (c) => {
        const { asiakas, ennakko } = await ennakolla(c);
        await c.tallennaMyyntilasku({
          pvm: '2026-06-10',
          kumppani: asiakas.id,
          luonnos: true,
          rivit: [
            rivi(300),
            {
              ...rivi(-40),
              selite: 'Ennakkolaskun 1 hyvitys',
              tili: 2861,
              ennakkoTosite: ennakko.id,
            },
          ],
        });
      },
    });
    const maara = await screen.findByLabelText('Ennakon vähennys, rivi 2');
    expect(maara).toHaveValue('40,00');
    expect(screen.getByLabelText('Selite, rivi 2')).toHaveAttribute('readonly');
    await user.clear(maara);
    await user.type(maara, '900');
    await user.tab();
    expect(await screen.findByLabelText('Ennakon vähennys, rivi 2')).toHaveValue('100,00');
  });
});

describe('Ennakkolasku laskunäkymässä', () => {
  it('kirjatulla ennakkolaskulla ei ole Hyvitä-toimintoa, tavallisella on', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        await ennakolla(c);
      },
    });
    await screen.findByLabelText('laskunaytto');
    expect(screen.queryByRole('button', { name: 'Hyvitä' })).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText('laskunaytto')).getByText(/Ennakkolasku/),
    ).toBeInTheDocument();
  });

  it('tavallisella myyntilaskulla Hyvitä on edelleen', async () => {
    await renderRoute('/myyntilaskut/1', {
      seed: SEED,
      arrange: async (c) => {
        const asiakas = await c.tallennaKumppani({ nimi: 'A' });
        await c.tallennaMyyntilasku({
          pvm: '2026-06-01',
          kumppani: asiakas.id,
          rivit: [rivi(10)],
        });
      },
    });
    await screen.findByLabelText('laskunaytto');
    expect(await screen.findByRole('button', { name: 'Hyvitä' })).toBeInTheDocument();
  });
});
