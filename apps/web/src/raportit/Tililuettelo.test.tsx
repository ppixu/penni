import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    // Tarkoituksella sekaisin: luettelo järjestää numeron (ysiluvun) mukaan.
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 1, tyyppi: 'H1', nimi: { fi: 'Vastaavaa' } },
    { numero: 19, tyyppi: 'H2', nimi: { fi: 'Rahat' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tulos' } },
    { numero: 2, tyyppi: 'H1', nimi: { fi: 'Vastattavaa' } },
    { numero: 29, tyyppi: 'H2', nimi: { fi: 'Velat' } },
    { numero: 2900, tyyppi: 'BL', nimi: { fi: 'Muut velat' } },
    { numero: 3, tyyppi: 'H1', nimi: { fi: 'Tuotot' } },
    { numero: 4, tyyppi: 'H1', nimi: { fi: 'Kulut' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

/** Myynti pankkiin: 1900, 3000 ja laskettu tulostili 2371 saavat saldon; 2900 ja 4000 eivät. */
async function kirjaaMyynti(c: KpClient) {
  const vienti = (tili: number, debet: number, kredit: number) => ({
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm: '2026-02-05',
    selite: 'Myynti',
    alvKoodi: 0,
    alvProsentti: 0,
  });
  await c.luoTosite({
    pvm: '2026-02-05',
    tyyppi: 200,
    sarja: '',
    tila: 100,
    viennit: [vienti(1900, 10_000, 0), vienti(3000, 0, 10_000)],
  });
}

async function avaaLuettelo() {
  const { user } = await renderRoute('/raportit', { seed: SEED, arrange: kirjaaMyynti });
  const valitsin = await screen.findByLabelText('Raportti');
  await within(valitsin).findByRole('option', { name: 'Tililuettelo' });
  await user.selectOptions(valitsin, 'Tililuettelo');
  return user;
}

const rivit = async () =>
  within(await screen.findByRole('table'))
    .getAllByRole('row')
    .slice(1);

describe('Tililuettelo', () => {
  it('näyttää oletuksena vain kirjatut tilit ja niiden otsikot', async () => {
    await avaaLuettelo();
    // 2900 ja 4000 jäävät pois, samoin Velat- ja Kulut-otsikot, joiden alla ei ole kirjattua tiliä.
    // Vastattavaa jää, koska sen alla on tulostili 2371.
    expect((await rivit()).map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^1Vastaavaa/),
      expect.stringMatching(/^19Rahat/),
      expect.stringMatching(/^1900Pankki/),
      expect.stringMatching(/^2Vastattavaa/),
      expect.stringMatching(/^2371Tulos/),
      expect.stringMatching(/^3Tuotot/),
      expect.stringMatching(/^3000Myynti/),
    ]);
  });

  it('listaa kaikki otsikot ja tilit numerojärjestyksessä tyyppiteksteineen', async () => {
    const user = await avaaLuettelo();
    await user.click(await screen.findByLabelText('Näytä kaikki tilit'));

    const rivit = within(await screen.findByRole('table'))
      .getAllByRole('row')
      .slice(1);
    expect(rivit.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^1Vastaavaa/),
      expect.stringMatching(/^19Rahat/),
      expect.stringMatching(/^1900Pankki/),
      expect.stringMatching(/^2Vastattavaa/),
      expect.stringMatching(/^2371Tulos/),
      expect.stringMatching(/^29Velat/),
      expect.stringMatching(/^2900Muut velat/),
      expect.stringMatching(/^3Tuotot/),
      expect.stringMatching(/^3000Myynti/),
      expect.stringMatching(/^4Kulut/),
      expect.stringMatching(/^4000Ostot/),
    ]);
    // Tyyppiteksti tulee tilityypistä; otsikoilla sitä ei ole.
    expect(rivit[2]?.querySelectorAll('td')[2]?.textContent).not.toBe('');
    expect(rivit[0]?.querySelectorAll('td')[2]?.textContent).toBe('');
    // Otsikon taso näkyy sisennyksenä (H1 ei sisennetä, H2 sisennetään) ja lihavointina.
    expect(screen.getByText('Vastaavaa')).toHaveStyle({ paddingLeft: '0px' });
    expect(screen.getByText('Rahat')).toHaveStyle({ paddingLeft: '16px' });
    expect(screen.getByText('Rahat')).toHaveClass('font-semibold');
    // Tilinumero linkittää tilikarttaan.
    expect(screen.getByRole('link', { name: '1900' })).toHaveAttribute(
      'href',
      '/tilikartta?nakyma=kaikki&tili=1900',
    );
  });
});
