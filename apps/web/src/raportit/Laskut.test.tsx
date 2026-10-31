import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
    { numero: 2871, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'false',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    OletusMenotili: '4000',
    OstoVelkaTili: '2871',
    LaskuMaksutili: '1900',
  },
};

const myyntiRivi = (aNetto: number) => ({
  myyntiKpl: 1,
  aNetto,
  alvKoodi: 0,
  alvProsentti: 0,
  selite: 'Työ',
});

/**
 * Siemennys: 2026 myyntilaskut A (100 €, osittain maksettu 40 €) ja B (250 €, maksettu kokonaan),
 * edellisvuoden myyntilasku C (80 €, avoinna), ostolasku D (50 €, avoinna).
 */
async function siemenna(c: KpClient) {
  const asiakas = await c.tallennaKumppani({ nimi: 'Asiakas Oy' });
  const toimittaja = await c.tallennaKumppani({ nimi: 'Tukku Oy' });
  const a = await c.tallennaMyyntilasku({
    pvm: '2026-02-01',
    erapvm: '2026-02-15',
    kumppani: asiakas.id,
    rivit: [myyntiRivi(100)],
  });
  const b = await c.tallennaMyyntilasku({
    pvm: '2026-03-01',
    erapvm: '2026-03-15',
    kumppani: asiakas.id,
    rivit: [myyntiRivi(250)],
  });
  await c.tallennaMyyntilasku({
    pvm: '2025-11-01',
    erapvm: '2025-11-15',
    kumppani: asiakas.id,
    rivit: [myyntiRivi(80)],
  });
  await c.tallennaOstolasku({
    pvm: '2026-04-01',
    erapvm: '2026-05-01',
    viite: 'V-1',
    kumppani: toimittaja.id,
    rivit: [{ myyntiKpl: 1, aNetto: 50, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
  });
  await c.tallennaSuoritus({ tosite: a.id, pvm: '2026-02-20', summa: Euro.fromCents(4_000) });
  await c.tallennaSuoritus({ tosite: b.id, pvm: '2026-03-20', summa: Euro.fromCents(25_000) });
}

async function avaa(arrange: (c: KpClient) => Promise<void>) {
  const tulos = await renderRoute('/raportit', { seed: SEED, arrange });
  const valitsin = await screen.findByLabelText('Raportti');
  await within(valitsin).findByRole('option', { name: 'Laskut' });
  await tulos.user.selectOptions(valitsin, 'Laskut');
  return tulos;
}

describe('Laskut', () => {
  it('näyttää oletuksena avoimet laskut avoimine saldoineen ja osioiden summat', async () => {
    await avaa(siemenna);

    const myynti = await screen.findByRole('region', { name: 'Avoimet myyntilaskut' });
    // Odota riveihin asti: osio näyttää ensin Ladataan…
    await within(myynti).findByRole('table');
    const rivit = within(myynti).getAllByRole('row');
    // otsikko + A + C (edellisvuoden avoin lasku kuuluu mukaan) + yhteensä; B on maksettu.
    expect(rivit).toHaveLength(4);
    // Lajittelu laskupäivän mukaan: edellisvuoden C ensin.
    expect(rivit[1]).toHaveTextContent('1.11.2025');
    expect(rivit[1]).toHaveTextContent('80,00 €');
    expect(rivit[2]).toHaveTextContent('1.2.2026');
    expect(rivit[2]).toHaveTextContent('15.2.2026');
    expect(rivit[2]).toHaveTextContent('Asiakas Oy');
    // Summa 100,00 €, avoinna 60,00 €.
    const solut = within(rivit[2] as HTMLElement).getAllByRole('cell');
    expect(solut.at(-2)).toHaveTextContent('100,00 €');
    expect(solut.at(-1)).toHaveTextContent('60,00 €');
    // Yhteensä: summat 180,00 €, avoinna 140,00 €.
    const yht = within(rivit[3] as HTMLElement).getAllByRole('cell');
    expect(rivit[3]).toHaveTextContent('Yhteensä (2 laskua)');
    expect(yht.at(-2)).toHaveTextContent('180,00 €');
    expect(yht.at(-1)).toHaveTextContent('140,00 €');
    expect(within(myynti).queryByText('250,00 €')).not.toBeInTheDocument();

    const osto = screen.getByRole('region', { name: 'Avoimet ostolaskut' });
    await within(osto).findByRole('table');
    const ostoRivit = within(osto).getAllByRole('row');
    expect(ostoRivit).toHaveLength(3);
    expect(ostoRivit[1]).toHaveTextContent('V-1');
    expect(ostoRivit[1]).toHaveTextContent('Tukku Oy');
    expect(ostoRivit[2]).toHaveTextContent('50,00 €');
  });

  it('ilman "Vain avoimet" -rajausta listaa kauden kaikki laskut maksettuinakin', async () => {
    const { user } = await avaa(siemenna);
    await screen.findByRole('region', { name: 'Avoimet myyntilaskut' });
    await user.click(screen.getByRole('checkbox', { name: 'Vain avoimet' }));

    const myynti = await screen.findByRole('region', { name: 'Myyntilaskut' });
    await waitFor(() => expect(within(myynti).getAllByRole('row')).toHaveLength(4));
    const rivit = within(myynti).getAllByRole('row');
    // A ja B (kauden aikana laskutetut), ei edellisvuoden C:tä.
    expect(rivit[1]).toHaveTextContent('1.2.2026');
    expect(rivit[2]).toHaveTextContent('1.3.2026');
    expect(rivit[2]).toHaveTextContent('250,00 €');
    expect(rivit[2]?.querySelectorAll('td')[6]).toHaveTextContent('0,00 €');
    expect(within(myynti).queryByText('1.11.2025')).not.toBeInTheDocument();
    expect(rivit[3]).toHaveTextContent('350,00 €');
    expect(rivit[3]).toHaveTextContent('60,00 €');
  });

  it('kertoo, kun avoimia laskuja ei ole', async () => {
    await avaa(async () => {});
    expect(await screen.findByText('Ei avoimia myyntilaskuja.')).toBeInTheDocument();
    expect(await screen.findByText('Ei avoimia ostolaskuja.')).toBeInTheDocument();
  });
});
