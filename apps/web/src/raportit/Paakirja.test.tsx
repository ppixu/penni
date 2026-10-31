import { renderRoute } from '@/test/renderRoute';
import { valitseTilikausi } from '@/test/valitseTilikausi';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, within } from '@testing-library/react';
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
    { alkaa: '2027-01-01', loppuu: '2027-12-31' },
  ],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

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

describe('Pääkirja', () => {
  it('näyttää alkusaldon, juoksevan saldon ja tilin summat; tulostili alkaa nollasta', async () => {
    const { user } = await renderRoute('/raportit', {
      seed: SEED,
      arrange: async (c) => {
        // Viime tilikaudelta pankkiin 5 000,00 (tulostili 3000 ei siirry uudelle kaudelle).
        await kirjaa(c, '2025-12-15', 1900, 3000, 500_000, 'Viime vuoden myynti');
        await kirjaa(c, '2026-03-10', 4000, 1900, 25_000, 'Toimistotarvikkeet');
        await kirjaa(c, '2026-02-05', 1900, 3000, 100_000, 'Myynti pankkiin');
        // Jakson jälkeen: ei saa näkyä.
        await kirjaa(c, '2027-01-02', 1900, 3000, 777_700, 'Ensi vuoden myynti');
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Pääkirja' });
    await user.selectOptions(valitsin, 'Pääkirja');
    // Oletuksena uusin kausi (2027); tämä testi tarkastelee kautta 2026.
    await valitseTilikausi(user, '2026');
    const taulu = await screen.findByRole('table', { name: 'Pääkirja' });

    // Tilit numerojärjestyksessä: 1900, 3000, 4000.
    const otsikot = within(taulu)
      .getAllByRole('link')
      .map((l) => l.textContent)
      .filter((t) => /^\d{4} /.test(t ?? ''));
    expect(otsikot).toEqual(['1900 Pankki', '3000 Myynti', '4000 Ostot']);

    // 1900: alkusaldo 5 000,00; +1 000,00 (5.2.) -> 6 000,00; -250,00 (10.3.) -> 5 750,00.
    const pankki = within(taulu).getByText('1900 Pankki').closest('tbody') as HTMLElement;
    expect(within(pankki).getByLabelText('Alkusaldo 1900')).toHaveTextContent('5 000,00 €');
    const pankinRivit = within(pankki).getAllByRole('row');
    // otsikkorivi, 2 vientiä, summarivi
    expect(pankinRivit).toHaveLength(4);
    expect(pankinRivit[1]).toHaveTextContent('5.2.2026');
    expect(pankinRivit[1]).toHaveTextContent('Myynti pankkiin');
    expect(pankinRivit[1]).toHaveTextContent('6 000,00 €');
    expect(pankinRivit[2]).toHaveTextContent('10.3.2026');
    expect(pankinRivit[2]).toHaveTextContent('5 750,00 €');
    // Summarivi: debet 1 000,00, kredit 250,00, loppusaldo 5 750,00, muutos +750,00.
    expect(pankinRivit[3]).toHaveTextContent('Muutos 750,00 €');
    expect(pankinRivit[3]).toHaveTextContent('1 000,00 €');
    expect(pankinRivit[3]).toHaveTextContent('250,00 €');
    expect(pankinRivit[3]).toHaveTextContent('5 750,00 €');

    // 3000 (kredit-tili): alkusaldo 0 (tulostili nollautuu tilikaudella), saldo kredit-positiivinen.
    const myynti = within(taulu).getByText('3000 Myynti').closest('tbody') as HTMLElement;
    expect(within(myynti).getByLabelText('Alkusaldo 3000')).toHaveTextContent('0,00 €');
    const myyntiRivit = within(myynti).getAllByRole('row');
    expect(myyntiRivit[1]).toHaveTextContent('1 000,00 €');
    expect(myyntiRivit).toHaveLength(3);

    expect(taulu).not.toHaveTextContent('Ensi vuoden myynti');
    expect(taulu).not.toHaveTextContent('Viime vuoden myynti');
  });

  it('jättää pois tilin, jolla ei ole vientejä eikä alkusaldoa', async () => {
    const { user } = await renderRoute('/raportit', {
      seed: SEED,
      arrange: async (c) => {
        await kirjaa(c, '2026-02-05', 1900, 3000, 100_000, 'Myynti pankkiin');
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Pääkirja' });
    await user.selectOptions(valitsin, 'Pääkirja');
    await valitseTilikausi(user, '2026');
    const taulu = await screen.findByRole('table', { name: 'Pääkirja' });
    expect(within(taulu).queryByText('4000 Ostot')).not.toBeInTheDocument();
    expect(within(taulu).getByText('1900 Pankki')).toBeInTheDocument();
  });
});
