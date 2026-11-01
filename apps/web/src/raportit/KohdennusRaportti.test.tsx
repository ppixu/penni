import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { KohdennusTyyppi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const LAYOUT = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Yleinen' },
  rivit: [
    { fi: 'Liikevaihto', L: '3', M: 'bold' },
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

/** Myynti: 100,00 kustannuspaikalle, 30,00 sen projektille, 25,00 Yleisen projektille, 40,00 kohdentamatta. */
async function kirjaa(c: KpClient) {
  const nuoriso = await c.tallennaKohdennus({
    tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
    nimi: { fi: 'Nuorisotoiminta' },
  });
  await c.tallennaKohdennus({ tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA, nimi: { fi: 'Halli' } });
  const leiri = await c.tallennaKohdennus({
    tyyppi: KohdennusTyyppi.PROJEKTI,
    kuuluu: nuoriso.id,
    nimi: { fi: 'Kesäleiri' },
  });
  const myyjaiset = await c.tallennaKohdennus({
    tyyppi: KohdennusTyyppi.PROJEKTI,
    nimi: { fi: 'Myyjäiset' },
  });
  const myynti = (kredit: number, kohdennus?: number) => ({
    tili: 3000,
    debet: Euro.fromCents(0),
    kredit: Euro.fromCents(kredit),
    pvm: '2026-03-01',
    alvKoodi: 0,
    alvProsentti: 0,
    ...(kohdennus !== undefined ? { kohdennus } : {}),
  });
  await c.luoTosite({
    pvm: '2026-03-01',
    tyyppi: 200,
    sarja: '',
    tila: 100,
    viennit: [
      { ...myynti(0), tili: 1900, debet: Euro.fromCents(19_500) },
      myynti(10_000, nuoriso.id),
      myynti(3_000, leiri.id),
      myynti(2_500, myyjaiset.id),
      myynti(4_000),
    ],
  });
}

const osio = (nimi: string) => screen.getByRole('region', { name: nimi });

describe('Kustannuspaikat- ja Projektit-raportit', () => {
  it('Kustannuspaikat: osio otsikoineen per kustannuspaikka (projektit mukana) ja Yleinen', async () => {
    await renderRoute('/raportit?raportti=kustannuspaikat', { seed: SEED, arrange: kirjaa });
    expect(await screen.findByRole('heading', { name: 'Nuorisotoiminta' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Yleinen',
      'Nuorisotoiminta',
    ]);
    // Hallilla ei ole kirjauksia: ei osiota.
    expect(screen.queryByRole('heading', { name: 'Halli' })).not.toBeInTheDocument();
    const liikevaihto = (nimi: string) => within(osio(nimi)).getByText('Liikevaihto').closest('tr');
    expect(liikevaihto('Nuorisotoiminta')).toHaveTextContent('130,00 €');
    expect(liikevaihto('Yleinen')).toHaveTextContent('65,00 €');
    expect(screen.getByRole('button', { name: 'Mikä tämä on?' })).toHaveAccessibleDescription(
      /kustannuspaikalle/,
    );
  });

  it('Projektit: osio per projekti, Kustannuspaikka-valinta rajaa', async () => {
    const { user } = await renderRoute('/raportit?raportti=projektit', {
      seed: SEED,
      arrange: kirjaa,
    });
    expect(await screen.findByRole('heading', { name: 'Myyjäiset' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Myyjäiset',
      'Nuorisotoiminta/Kesäleiri',
    ]);
    const valinta = screen.getByLabelText('Kustannuspaikka');
    expect(
      within(valinta)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Kaikki', 'Yleinen', 'Halli', 'Nuorisotoiminta']);
    await user.selectOptions(valinta, 'Nuorisotoiminta');
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
        'Nuorisotoiminta/Kesäleiri',
      ]),
    );
    expect(
      within(osio('Nuorisotoiminta/Kesäleiri')).getByText('Liikevaihto').closest('tr'),
    ).toHaveTextContent('30,00 €');
  });

  it('Projektit-raportti näkyy vain, kun projekteja on', async () => {
    await renderRoute('/raportit', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaKohdennus({
          tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
          nimi: { fi: 'Halli' },
        });
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Kustannuspaikat' });
    expect(within(valitsin).queryByRole('option', { name: 'Projektit' })).toBeNull();
  });
});
