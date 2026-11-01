import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { KohdennusTyyppi } from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { muotoileProsentti } from './Budjettivertailu';

const LAYOUT = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Yleinen' },
  rivit: [
    { fi: 'Liikevaihto', L: '3', M: 'bold' },
    { fi: 'Kulut', L: '4' },
    { fi: 'Tilikauden tulos', L: '3..4 =', M: 'bold' },
  ],
});

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false', 'tulos/yleinen': LAYOUT },
};

const c = (n: number) => n as Cents;

function vienti(pvm: string, tili: number, debet: number, kredit: number, kohdennus?: number) {
  return {
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    ...(kohdennus !== undefined ? { kohdennus } : {}),
  };
}

/** Ostot: budjetti 100,00, toteuma 80,00 maaliskuussa + 40,00 syyskuussa = 120,00. */
async function kirjaa(client: KpClient) {
  await client.tallennaBudjetti('2026-01-01', [
    { kohdennus: 0, tili: 4000, sentit: c(-10_000) },
    { kohdennus: 0, tili: 3000, sentit: c(50_000) },
  ]);
  for (const [pvm, sentit] of [
    ['2026-03-01', 8_000],
    ['2026-09-01', 4_000],
  ] as const)
    await client.luoTosite({
      pvm,
      tyyppi: 200,
      sarja: '',
      tila: 100,
      viennit: [vienti(pvm, 4000, sentit, 0), vienti(pvm, 1900, 0, sentit)],
    });
}

const rivi = (teksti: string) =>
  within(screen.getByRole('table', { name: 'Budjettivertailu' }))
    .getByText(teksti)
    .closest('tr') as HTMLElement;
const solut = (teksti: string) =>
  within(rivi(teksti))
    .getAllByRole('cell')
    .map((s) => s.textContent?.replace(/ /g, ' '));

describe('muotoileProsentti', () => {
  it('muotoilee sadasosat kokonaislukuina', () => {
    expect(muotoileProsentti(12_000)).toBe('120,00 %');
    expect(muotoileProsentti(3_333)).toBe('33,33 %');
    expect(muotoileProsentti(-550)).toBe('−5,50 %');
    expect(muotoileProsentti(5)).toBe('0,05 %');
    expect(muotoileProsentti(0)).toBe('0,00 %');
  });
});

describe('Budjettivertailu', () => {
  it('budjetin ylittävä kulurivi: negatiivinen ero ja 120,00 %; loppupäivä rajaa toteuman', async () => {
    const { user } = await renderRoute('/raportit?raportti=budjettivertailu', {
      seed: SEED,
      arrange: kirjaa,
    });
    await screen.findByRole('table', { name: 'Budjettivertailu' });
    expect(
      within(screen.getByRole('table', { name: 'Budjettivertailu' }))
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
        .slice(1),
    ).toEqual(['Budjetti', 'Toteutunut', 'Ero €', 'Toteutunut %']);
    expect(solut('Kulut')).toEqual(['Kulut', '−100,00 €', '−120,00 €', '−20,00 €', '120,00 %']);
    // Ei toteumaa: 0 %; tulos ilman budjetoitua nollaa ei saa prosenttia.
    expect(solut('Liikevaihto')).toEqual([
      'Liikevaihto',
      '500,00 €',
      '0,00 €',
      '−500,00 €',
      '0,00 %',
    ]);
    // Ilman kohdennuksia ei kohdennusvalintaa.
    expect(screen.queryByLabelText('Kohdennus')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Muokkaa budjettia' })).toHaveAttribute(
      'href',
      '/budjetti?tilikausi=2026-01-01',
    );

    const loppu = screen.getByLabelText('Toteutunut asti');
    expect(loppu).toHaveValue('2026-12-31');
    await user.clear(loppu);
    await user.type(loppu, '2026-06-30');
    await waitFor(() =>
      expect(solut('Kulut')).toEqual(['Kulut', '−100,00 €', '−80,00 €', '20,00 €', '80,00 %']),
    );
    const otsikko = screen.getByRole('heading', { level: 1, hidden: true });
    expect(otsikko).toHaveTextContent(/^Demo Oy – Budjettivertailu 1\.1\.2026 – 30\.6\.2026$/);
  });

  it('kohdennusvalinta (ei merkkauksia) rajaa budjetin ja toteuman; linkki vie kohdennuksen budjettiin', async () => {
    const { user } = await renderRoute('/raportit?raportti=budjettivertailu', {
      seed: SEED,
      arrange: async (client) => {
        const halli = await client.tallennaKohdennus({
          tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
          nimi: { fi: 'Halli' },
        });
        await client.tallennaKohdennus({
          tyyppi: KohdennusTyyppi.MERKKAUS,
          nimi: { fi: 'Avustus' },
        });
        await client.tallennaBudjetti('2026-01-01', [
          { kohdennus: 0, tili: 4000, sentit: c(-10_000) },
          { kohdennus: halli.id, tili: 4000, sentit: c(-20_000) },
        ]);
        await client.luoTosite({
          pvm: '2026-03-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            vienti('2026-03-01', 4000, 5_000, 0, halli.id),
            vienti('2026-03-01', 1900, 0, 5_000),
          ],
        });
      },
    });
    await screen.findByRole('table', { name: 'Budjettivertailu' });
    expect(solut('Kulut')).toEqual(['Kulut', '−300,00 €', '−50,00 €', '250,00 €', '16,67 %']);
    const valinta = screen.getByLabelText('Kohdennus');
    expect(
      within(valinta)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Kaikki', 'Yleinen', 'Halli']);
    await user.selectOptions(valinta, 'Halli');
    await waitFor(() =>
      expect(solut('Kulut')).toEqual(['Kulut', '−200,00 €', '−50,00 €', '150,00 €', '25,00 %']),
    );
    expect(screen.getByRole('link', { name: 'Muokkaa budjettia' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/budjetti\?tilikausi=2026-01-01&kohdennus=\d+$/),
    );
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      /^Demo Oy – Budjettivertailu 1\.1\.2026 – 31\.12\.2026 – Halli$/,
    );
  });

  it('budjetoitu kohdennus on valittavissa, vaikka se ei ole voimassa tilikaudella', async () => {
    await renderRoute('/raportit?raportti=budjettivertailu', {
      seed: SEED,
      arrange: async (client) => {
        const vanha = await client.tallennaKohdennus({
          tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
          nimi: { fi: 'Vanha halli' },
          alkaa: '2024-01-01',
          paattyy: '2024-12-31',
        });
        await client.tallennaKohdennus({
          tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
          nimi: { fi: 'Päättynyt' },
          alkaa: '2024-01-01',
          paattyy: '2024-12-31',
        });
        await client.tallennaBudjetti('2026-01-01', [
          { kohdennus: vanha.id, tili: 4000, sentit: c(-20_000) },
        ]);
      },
    });
    await screen.findByRole('table', { name: 'Budjettivertailu' });
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Kohdennus'))
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Kaikki', 'Yleinen', 'Vanha halli']),
    );
  });
});
