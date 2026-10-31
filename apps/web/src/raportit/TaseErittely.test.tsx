import { renderRoute } from '@/test/renderRoute';
import { Euro } from '@penni/euro';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1700, tyyppi: 'AS', nimi: { fi: 'Muu saatava' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' }, erittely: 1 },
    { numero: 2000, tyyppi: 'B', nimi: { fi: 'Oma pääoma' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden tulos' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

const vienti = (tili: number, debet: number, kredit: number, pvm: string, selite?: string) => ({
  tili,
  debet: Euro.fromCents(debet),
  kredit: Euro.fromCents(kredit),
  pvm,
  alvKoodi: 0,
  alvProsentti: 0,
  ...(selite ? { selite } : {}),
});

const tosite = (pvm: string, viennit: ReturnType<typeof vienti>[]) => ({
  pvm,
  tyyppi: 200,
  sarja: '',
  tila: 100,
  viennit,
});

async function avaa() {
  const tulos = await renderRoute('/raportit', {
    seed: SEED,
    arrange: async (c) => {
      // Edellinen tilikausi: pääoma 100,00 pankkiin (alkusaldo).
      await c.luoTosite(
        tosite('2025-12-01', [
          vienti(1900, 10_000, 0, '2025-12-01'),
          vienti(2000, 0, 10_000, '2025-12-01'),
        ]),
      );
      // Saatava syntyy ja maksetaan saman kauden aikana: loppusaldo nolla.
      await c.luoTosite(
        tosite('2026-02-01', [
          vienti(1700, 7_000, 0, '2026-02-01'),
          vienti(3000, 0, 7_000, '2026-02-01'),
        ]),
      );
      await c.luoTosite(
        tosite('2026-02-15', [
          vienti(1900, 7_000, 0, '2026-02-15', 'Asiakkaan maksu'),
          vienti(1700, 0, 7_000, '2026-02-15'),
        ]),
      );
      await c.luoTosite(
        tosite('2026-03-01', [
          vienti(1900, 0, 2_500, '2026-03-01', 'Kulu'),
          vienti(3000, 2_500, 0, '2026-03-01'),
        ]),
      );
    },
  });
  const valitsin = await screen.findByLabelText('Raportti');
  await within(valitsin).findByRole('option', { name: 'Tase-erittely' });
  await tulos.user.selectOptions(valitsin, 'Tase-erittely');
  return tulos;
}

const teksti = (e: HTMLElement) => e.textContent?.replace(/ /g, ' ');

describe('Tase-erittely', () => {
  it('erittelee eritellyn tilin alkusaldon, jakson viennit ja loppusaldon', async () => {
    await avaa();
    const pankki = await screen.findByRole('link', { name: '1900 Pankki' });
    expect(pankki).toBeInTheDocument();

    const alku = screen.getByText('Alkusaldo 1.1.2026').closest('tr') as HTMLElement;
    expect(teksti(alku)).toContain('100,00 €');
    const maksu = screen.getByText('Asiakkaan maksu').closest('tr') as HTMLElement;
    expect(teksti(maksu)).toContain('15.2.2026');
    expect(teksti(maksu)).toContain('70,00 €');
    // Vastaavaa-tilin kreditvienti on negatiivinen.
    expect(teksti(screen.getByText('Kulu').closest('tr') as HTMLElement)).toContain('−25,00 €');
    expect(
      teksti(screen.getByText('Tilin 1900 loppusaldo').closest('tr') as HTMLElement),
    ).toContain('145,00 €');
    // Edellisen kauden vienti ei ole jakson riveillä (vain alkusaldossa).
    expect(screen.queryByText('1.12.2025')).not.toBeInTheDocument();
  });

  it('ryhmittelee vastaavaa ja vastattavaa, piilottaa nollasaldot ja summaa ryhmät', async () => {
    await avaa();
    await screen.findByRole('link', { name: '1900 Pankki' });
    // Nollasaldoinen saatava jää pois.
    expect(screen.queryByRole('link', { name: '1700 Muu saatava' })).not.toBeInTheDocument();

    const pankkiRivi = screen.getByRole('link', { name: '1900 Pankki' });
    const oma = screen.getByRole('link', { name: '2000 Oma pääoma' });
    const tulos = screen.getByRole('link', { name: '2371 Tilikauden tulos' });
    // Vastaavaa ennen vastattavaa dokumentin järjestyksessä.
    expect(pankkiRivi.compareDocumentPosition(oma) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(oma.compareDocumentPosition(tulos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Erittelemätön tili: pelkkä loppusaldo samalla rivillä.
    expect(teksti(oma.closest('tr') as HTMLElement)).toContain('100,00 €');
    // Kauden tulos 70,00 − 25,00 = 45,00.
    expect(teksti(tulos.closest('tr') as HTMLElement)).toContain('45,00 €');

    expect(teksti(screen.getByText('Vastaavaa yhteensä').closest('tr') as HTMLElement)).toContain(
      '145,00 €',
    );
    expect(teksti(screen.getByText('Vastattavaa yhteensä').closest('tr') as HTMLElement)).toContain(
      '145,00 €',
    );
  });
});
