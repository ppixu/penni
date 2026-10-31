import { renderRoute } from '@/test/renderRoute';
import { valitseTilikausi } from '@/test/valitseTilikausi';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden tulos' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

describe('Kojelauta', () => {
  it('shows brand + KPI labels and renders a recent finalized voucher', async () => {
    // Seed a finalized sale BEFORE mount (1910 debet / 3000 kredit, 124,00 €) so the recent-list
    // query observes it on its first run.
    await renderRoute('/', {
      seed: SEED,
      arrange: async (client) => {
        await client.luoTosite({
          pvm: '2026-03-02',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            {
              tili: 1910,
              debet: Euro.fromCents(12_400),
              kredit: Euro.fromCents(0),
              pvm: '2026-03-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(12_400),
              pvm: '2026-03-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        });
      },
    });

    expect(await screen.findByText('Penni')).toBeInTheDocument();
    // KPI-kortti, saldotaulun tulosrivi ja seedin samanniminen tili.
    expect(screen.getAllByText('Tilikauden tulos').length).toBeGreaterThan(0);
    expect(screen.getByText('Pankki')).toBeInTheDocument();
    // Recent list shows the seeded voucher (after the query settles): a "Tulo" row whose summa cell
    // displays 124,00 €. (The KPI figure may coincide, so assert against the row's cell.)
    const rivi = await screen.findByText('Tulo');
    const summasolu = rivi.closest('tr')?.querySelector('td:last-child');
    await waitFor(() => expect(summasolu).toHaveTextContent('124,00 €'));
  });

  it('viimeisimmän tositteen rivin klikkaus avaa tositteen', async () => {
    const { user, router } = await renderRoute('/', {
      seed: SEED,
      arrange: async (client) => {
        await client.luoTosite({
          pvm: '2026-03-02',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          otsikko: 'Klikattava myynti',
          viennit: [
            {
              tili: 1910,
              debet: Euro.fromCents(500),
              kredit: Euro.fromCents(0),
              pvm: '2026-03-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(500),
              pvm: '2026-03-02',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    const rivi = (await screen.findByText(/Klikattava myynti/)).closest('tr') as HTMLElement;
    await user.click(rivi);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/tositteet\/\d+$/));
  });

  it('näyttää saldotaulun, Kaikki tositteet -linkin ja vain valitun kauden tositteet', async () => {
    const kaksiKautta = {
      ...SEED,
      tilikaudet: [{ alkaa: '2025-01-01', loppuu: '2025-12-31' }, ...SEED.tilikaudet],
    };
    const myynti = (pvm: string, snt: number, otsikko: string) => ({
      pvm,
      tyyppi: 200,
      sarja: '',
      tila: 100,
      otsikko,
      viennit: [
        {
          tili: 1910,
          debet: Euro.fromCents(snt),
          kredit: Euro.fromCents(0),
          pvm,
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 3000,
          debet: Euro.fromCents(0),
          kredit: Euro.fromCents(snt),
          pvm,
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
    const { user } = await renderRoute('/', {
      seed: kaksiKautta,
      arrange: async (client) => {
        await client.luoTosite(myynti('2025-05-02', 700, 'Viime vuoden myynti'));
        await client.luoTosite(myynti('2026-03-02', 12_400, 'Tämän vuoden myynti'));
      },
    });
    expect(await screen.findByText(/Tämän vuoden myynti/)).toBeInTheDocument();
    expect(screen.queryByText(/Viime vuoden myynti/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kaikki tositteet' })).toHaveAttribute(
      'href',
      '/tositteet',
    );

    const saldot = screen.getByRole('table', { name: 'saldot' });
    expect(within(saldot).getByText('Vastaavaa')).toBeInTheDocument();
    expect(within(saldot).getByText('Tuloslaskelma')).toBeInTheDocument();
    // Pankki kumulatiivisesti (7 + 124 €), myynti vain tältä kaudelta.
    await waitFor(() =>
      expect(within(saldot).getByRole('link', { name: /1910/ }).closest('tr')).toHaveTextContent(
        '131,00 €',
      ),
    );
    expect(within(saldot).getByRole('link', { name: /3000/ }).closest('tr')).toHaveTextContent(
      '124,00 €',
    );

    await valitseTilikausi(user, '2025');
    expect(await screen.findByText(/Viime vuoden myynti/)).toBeInTheDocument();
    expect(screen.queryByText(/Tämän vuoden myynti/)).not.toBeInTheDocument();
  });

  // Tuonti lukee tiedoston levyltä työpöytäsillan kautta; selaimessa napin ei kuulu näkyä.
  afterEach(() => {
    window.penni = undefined;
  });

  it('ei näytä Kitsas-tuonnin painiketta pelkässä selaimessa', async () => {
    await renderRoute('/', { seed: SEED });
    expect(await screen.findByRole('link', { name: '+ Uusi tosite' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tuo Kitsas-kirjanpito' })).not.toBeInTheDocument();
  });

  it('näyttää Kitsas-tuonnin painikkeen kun työpöytäsilta on olemassa', async () => {
    window.penni = {
      valitseJaLue: async () => null,
      tuo: async () => null,
      avaaKirja: async () => undefined,
    };
    await renderRoute('/', { seed: SEED });
    const linkki = await screen.findByRole('link', { name: 'Tuo Kitsas-kirjanpito' });
    expect(linkki).toHaveAttribute('href', '/tuonti');
  });

  it('näyttää tulot ja kulut Sankeyna ja suurimmat erät renkaina', async () => {
    await renderRoute('/', {
      seed: {
        ...SEED,
        tilit: [...SEED.tilit, { numero: 7690, tyyppi: 'D', nimi: { fi: 'Atk-laitteet' } }],
      },
      arrange: async (client) => {
        const vienti = (tili: number, debet: number, kredit: number) => ({
          tili,
          debet: Euro.fromCents(debet),
          kredit: Euro.fromCents(kredit),
          pvm: '2026-03-02',
          alvKoodi: 0,
          alvProsentti: 0,
        });
        await client.luoTosite({
          pvm: '2026-03-02',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [vienti(1910, 1_000_00, 0), vienti(3000, 0, 1_000_00)],
        });
        await client.luoTosite({
          pvm: '2026-03-03',
          tyyppi: 100,
          sarja: '',
          tila: 100,
          viennit: [vienti(7690, 250_00, 0), vienti(1910, 0, 250_00)],
        });
      },
    });

    const virta = await screen.findByRole('region', { name: 'tulot ja kulut' });
    await waitFor(() =>
      expect(within(virta).getByRole('img')).toHaveAccessibleName(
        'Tulot: Myynti 1\u00a0000\u00a0€. Kulut: Atk-laitteet 250\u00a0€, Tulos 750\u00a0€.',
      ),
    );
    const kulut = within(screen.getByRole('region', { name: 'jakauma' })).getByRole('list', {
      name: 'Kulut',
    });
    expect(kulut).toHaveTextContent('Atk-laitteet');
    expect(kulut).toHaveTextContent(/250\s€\s*100\s%/);
  });
});
