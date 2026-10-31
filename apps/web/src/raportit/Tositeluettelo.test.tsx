import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tulos' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

/** Tulotosite pankkiin: debet 1900, kredit 3000. */
function tulo(pvm: string, sentit: number, otsikko: string, kumppani?: number) {
  const vienti = (tili: number, debet: number, kredit: number) => ({
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
  });
  return {
    pvm,
    tyyppi: 200,
    sarja: '',
    tila: 100,
    otsikko,
    ...(kumppani !== undefined ? { kumppani } : {}),
    viennit: [vienti(1900, sentit, 0), vienti(3000, 0, sentit)],
  };
}

async function avaa(arrange: (c: KpClient) => Promise<void>) {
  const tulos = await renderRoute('/raportit', { seed: SEED, arrange });
  const valitsin = await screen.findByLabelText('Raportti');
  await within(valitsin).findByRole('option', { name: 'Tositeluettelo' });
  await tulos.user.selectOptions(valitsin, 'Tositeluettelo');
  return tulos;
}

describe('Tositeluettelo', () => {
  it('listaa kauden tositteet pvm- ja tunnisterjärjestyksessä summineen ja kumppaneineen', async () => {
    await avaa(async (c) => {
      const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
      // Kirjattu käänteisessä päiväjärjestyksessä: lista järjestää pvm:n mukaan.
      await c.luoTosite(tulo('2026-03-10', 20_000, 'Myöhempi', asiakas.id));
      await c.luoTosite(tulo('2026-02-01', 12_345, 'Aiempi'));
      // Edellisen kauden tosite ei kuulu luetteloon.
      await c.luoTosite(tulo('2025-06-01', 99_900, 'Viime vuoden'));
    });

    const taulu = await screen.findByRole('table');
    const rivit = within(taulu).getAllByRole('row');
    // otsikko + 2 tositetta + yhteensä
    expect(rivit).toHaveLength(4);
    expect(rivit[1]).toHaveTextContent('Aiempi');
    expect(rivit[1]).toHaveTextContent('1.2.2026');
    expect(rivit[1]).toHaveTextContent('123,45 €');
    expect(rivit[2]).toHaveTextContent('Myöhempi');
    expect(rivit[2]).toHaveTextContent('Asiakas Oy');
    expect(rivit[2]).toHaveTextContent('200,00 €');
    expect(screen.queryByText('Viime vuoden')).not.toBeInTheDocument();
    expect(rivit[3]).toHaveTextContent('Yhteensä (2 tositetta)');
    expect(rivit[3]).toHaveTextContent('323,45 €');
  });

  it('järjestää samalle päivälle kirjatut tositteet tunnisteen mukaan', async () => {
    await avaa(async (c) => {
      await c.luoTosite(tulo('2026-04-01', 1_000, 'Ensin kirjattu'));
      await c.luoTosite(tulo('2026-04-01', 2_000, 'Toisena kirjattu'));
    });
    const rivit = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rivit[1]).toHaveTextContent('Ensin kirjattu');
    expect(rivit[2]).toHaveTextContent('Toisena kirjattu');
  });

  it('kertoo, kun kaudella ei ole tositteita', async () => {
    await avaa(async () => {});
    expect(await screen.findByText('Ei tositteita tällä kaudella.')).toBeInTheDocument();
  });
});
