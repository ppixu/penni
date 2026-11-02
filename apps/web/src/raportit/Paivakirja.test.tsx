import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { KohdennusTyyppi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

/** Kirjaa kahden viennin tosite: debet-tili / kredit-tili summalla (sentteinä). */
async function kirjaa(
  c: KpClient,
  pvm: string,
  debetTili: number,
  kreditTili: number,
  sentit: number,
  selite: string,
) {
  const vienti = (tili: number, debet: number, kredit: number) => ({
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm,
    selite,
    alvKoodi: 0,
    alvProsentti: 0,
  });
  await c.luoTosite({
    pvm,
    tyyppi: 200,
    sarja: '',
    tila: 100,
    viennit: [vienti(debetTili, sentit, 0), vienti(kreditTili, 0, sentit)],
  });
}

async function avaaPaivakirja(arrange: (c: KpClient) => Promise<void>) {
  const { user } = await renderRoute('/raportit', { seed: SEED, arrange });
  const valitsin = await screen.findByLabelText('Raportti');
  await within(valitsin).findByRole('option', { name: 'Päiväkirja' });
  await user.selectOptions(valitsin, 'Päiväkirja');
  return screen.findByRole('table', { name: 'Päiväkirja' });
}

describe('Päiväkirja', () => {
  it('listaa jakson viennit päiväjärjestyksessä ja summaa debet/kredit; muut kaudet jäävät pois', async () => {
    const taulu = await avaaPaivakirja(async (c) => {
      // Luontijärjestys on käänteinen päiväjärjestykseen nähden.
      await kirjaa(c, '2026-03-10', 4000, 1900, 25_000, 'Toimistotarvikkeet');
      await kirjaa(c, '2026-02-05', 1900, 3000, 100_000, 'Myynti pankkiin');
      await kirjaa(c, '2025-12-15', 1900, 3000, 999_900, 'Viime vuoden myynti');
    });
    const rivit = within(taulu).getAllByRole('row');
    // otsikko + 4 vientiä + summarivi
    expect(rivit).toHaveLength(6);
    expect(rivit[1]).toHaveTextContent('5.2.2026');
    expect(rivit[1]).toHaveTextContent('1900 Pankki');
    expect(rivit[1]).toHaveTextContent('Myynti pankkiin');
    expect(rivit[1]).toHaveTextContent('1 000,00 €');
    expect(rivit[2]).toHaveTextContent('3000 Myynti');
    expect(rivit[3]).toHaveTextContent('10.3.2026');
    expect(rivit[3]).toHaveTextContent('4000 Ostot');
    expect(rivit[4]).toHaveTextContent('1900 Pankki');
    // 1 000,00 + 250,00 kummallekin puolelle; viime vuoden 9 999,00 ei ole mukana.
    expect(rivit[5]).toHaveTextContent('Vientejä 4 kpl');
    expect(within(rivit[5] as HTMLElement).getAllByText('1 250,00 €')).toHaveLength(2);
    expect(taulu).not.toHaveTextContent('Viime vuoden myynti');
  });

  it('ilmoittaa tyhjän jakson', async () => {
    const { user } = await renderRoute('/raportit', { seed: SEED });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Päiväkirja' });
    await user.selectOptions(valitsin, 'Päiväkirja');
    expect(await screen.findByText('Jaksolla ei ole kirjauksia.')).toBeInTheDocument();
  });

  describe('kohdennukset', () => {
    /** Neljä tositetta: kustannuspaikka, sen projekti, kohdentamaton (merkkauksella) ja toinen kustannuspaikka. */
    const kirjaaKohdennetut = async (c: KpClient) => {
      const nuoriso = await c.tallennaKohdennus({
        tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
        nimi: { fi: 'Nuorisotoiminta' },
      });
      const halli = await c.tallennaKohdennus({
        tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
        nimi: { fi: 'Halli' },
      });
      const leiri = await c.tallennaKohdennus({
        tyyppi: KohdennusTyyppi.PROJEKTI,
        kuuluu: nuoriso.id,
        nimi: { fi: 'Kesäleiri' },
      });
      const avustus = await c.tallennaKohdennus({
        tyyppi: KohdennusTyyppi.MERKKAUS,
        nimi: { fi: 'Avustus' },
      });
      const tosite = (
        pvm: string,
        debetTili: number,
        kreditTili: number,
        sentit: number,
        kohdennus?: number,
        merkkaukset?: number[],
      ) => {
        const vienti = (tili: number, debet: number, kredit: number) => ({
          tili,
          debet: Euro.fromCents(debet),
          kredit: Euro.fromCents(kredit),
          pvm,
          alvKoodi: 0,
          alvProsentti: 0,
          ...(kohdennus !== undefined ? { kohdennus } : {}),
          ...(merkkaukset ? { merkkaukset } : {}),
        });
        return c.luoTosite({
          pvm,
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [vienti(debetTili, sentit, 0), vienti(kreditTili, 0, sentit)],
        });
      };
      await tosite('2026-03-03', 1900, 3000, 10_000, nuoriso.id);
      await tosite('2026-03-04', 1900, 3000, 3_000, leiri.id);
      await tosite('2026-03-05', 1900, 3000, 4_000, undefined, [avustus.id]);
      await tosite('2026-03-06', 4000, 1900, 700, halli.id);
    };

    it('ilman kohdennuksia ei Kohdennus-saraketta eikä suodatinta', async () => {
      const taulu = await avaaPaivakirja(async (c) => {
        await kirjaa(c, '2026-03-03', 1900, 3000, 10_000, 'Myynti');
      });
      expect(within(taulu).queryByRole('columnheader', { name: 'Kohdennus' })).toBeNull();
      expect(screen.queryByLabelText('Kohdennus')).not.toBeInTheDocument();
    });

    it('näyttää Kohdennus-sarakkeen polulla ja merkkauksella', async () => {
      const taulu = await avaaPaivakirja(kirjaaKohdennetut);
      expect(within(taulu).getByRole('columnheader', { name: 'Kohdennus' })).toBeInTheDocument();
      const rivit = within(taulu).getAllByRole('row');
      // otsikko + 8 vientiä + summarivi
      expect(rivit).toHaveLength(10);
      expect(rivit[1]).toHaveTextContent('Nuorisotoiminta');
      expect(rivit[3]).toHaveTextContent('Nuorisotoiminta/Kesäleiri');
      expect(rivit[5]).toHaveTextContent('Avustus');
      expect(rivit[7]).toHaveTextContent('Halli');
    });

    it('suodatin rajaa kustannuspaikkaan ja sen projekteihin; summarivi laskee vain ne', async () => {
      const taulu = await avaaPaivakirja(kirjaaKohdennetut);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText('Kohdennus'), 'Nuorisotoiminta');
      await waitFor(() => expect(within(taulu).getAllByRole('row')).toHaveLength(6));
      const rivit = within(taulu).getAllByRole('row');
      // 4 vientiä: 100,00 + 30,00 kummallekin puolelle.
      expect(rivit[5]).toHaveTextContent('Vientejä 4 kpl');
      expect(within(rivit[5] as HTMLElement).getAllByText('130,00 €')).toHaveLength(2);
      expect(taulu).not.toHaveTextContent('Halli');
      expect(taulu).not.toHaveTextContent('Avustus');
    });

    it('suodatin rajaa merkkaukseen ja Yleiseen', async () => {
      const taulu = await avaaPaivakirja(kirjaaKohdennetut);
      const user = userEvent.setup();
      const suodatin = await screen.findByLabelText('Kohdennus');
      await user.selectOptions(suodatin, 'Avustus');
      await waitFor(() => expect(within(taulu).getAllByRole('row')).toHaveLength(4));
      expect(within(taulu).getAllByRole('row')[3]).toHaveTextContent('Vientejä 2 kpl');
      // Yleinen: kohdentamattomat; merkkaus ei vaikuta kohdennukseen, joten sama tosite.
      await user.selectOptions(suodatin, 'Yleinen');
      await waitFor(() => expect(within(taulu).getAllByRole('row')).toHaveLength(4));
      expect(within(taulu).getAllByRole('row')[3]).toHaveTextContent('Vientejä 2 kpl');
    });
  });
});
