import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const TULOS = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Yleinen' },
  rivit: [{ fi: 'Liikevaihto', L: '3', M: 'bold' }],
});
const TASE = JSON.stringify({
  nimi: { fi: 'Tase' },
  muoto: { fi: 'Yleinen' },
  rivit: [
    { fi: 'Vastaavaa', L: '1', M: 'bold' },
    { fi: 'Vastattavaa', L: '2', M: 'bold' },
  ],
});
const TULOS_PIEN = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Pienyritys' },
  rivit: [{ fi: 'Liikevaihto', L: '3', M: 'bold' }],
});
const TASE_PMA = JSON.stringify({
  nimi: { fi: 'Tase' },
  muoto: { fi: 'PMA' },
  rivit: [
    { fi: 'Vastaavaa', L: '1', M: 'bold' },
    { fi: 'Vastattavaa', L: '2', M: 'bold' },
  ],
});
const TILIT = [
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
  { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tulos' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
];
const ASETUKSET = {
  Nimi: 'Demo Oy',
  AlvVelvollinen: 'false',
  'tulos/yleinen': TULOS,
  'tase/yleinen': TASE,
  'tulos/pienbrutto': TULOS_PIEN,
  'tase/PMA': TASE_PMA,
};

/** Tulokirjaus 1900/3000 (myynti 1000,00), jotta Liikevaihto- ja Vastaavaa-rivit
 *  (ilman S-pakotusta kaavassaan) saavat tilin joka niiden alue kattaa. */
async function LUO_TOSITE(c: KpClient): Promise<void> {
  await c.luoTosite({
    pvm: '2026-03-01',
    tyyppi: 200,
    sarja: '',
    tila: 100,
    viennit: [
      {
        tili: 1900,
        debet: Euro.fromCents(100_000),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 3000,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(100_000),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  });
}

describe('/tilinpaatos', () => {
  it('vie tilinpäätöksen läpi: lukitse → vahvista → peru → avaa', async () => {
    const { user } = await renderRoute('/tilinpaatos', {
      seed: {
        tilit: TILIT,
        tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
        asetukset: ASETUKSET,
      },
      arrange: LUO_TOSITE,
    });
    // Tuloslaskelma + tase renderöityvät.
    expect(await screen.findByText('Liikevaihto')).toBeInTheDocument();
    expect(screen.getByText('Vastaavaa')).toBeInTheDocument();
    // Avoin → Lukitse.
    expect(screen.getByText('Tilikausi auki')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lukitse tilikausi' }));
    // Lukittu → Vahvista.
    expect(await screen.findByText('Tilikausi lukittu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vahvista tilinpäätös' }));
    // Vahvistettu (kello 2026-06-01) → liitetiedot vain luku.
    expect(await screen.findByText(/Tilinpäätös vahvistettu/)).toBeInTheDocument();
    expect(screen.getByLabelText('Liitetiedot')).toHaveAttribute('readonly');
    // Peru → Avaa.
    await user.click(screen.getByRole('button', { name: 'Peru vahvistus' }));
    expect(await screen.findByText('Tilikausi lukittu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avaa tilikausi' }));
    expect(await screen.findByText('Tilikausi auki')).toBeInTheDocument();
  });

  it('estää lukituksen kun aiempi tilikausi on auki', async () => {
    const { user } = await renderRoute('/tilinpaatos', {
      seed: {
        tilit: TILIT,
        tilikaudet: [
          { alkaa: '2025-01-01', loppuu: '2025-12-31' },
          { alkaa: '2026-01-01', loppuu: '2026-12-31' },
        ],
        asetukset: ASETUKSET,
      },
    });
    // Oletus valitsee viimeisimmän kauden (2026); sen lukitus estyy koska 2025 on auki.
    expect(await screen.findByText('Tilikausi auki')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lukitse tilikausi' }));
    expect(await screen.findByText('Aiempi tilikausi on vielä auki.')).toBeInTheDocument();
  });

  it('käyttää kirjan omaa tilinpäätösmuotoa ilman muotovalitsinta', async () => {
    await renderRoute('/tilinpaatos', {
      seed: {
        tilit: TILIT,
        tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
        asetukset: { ...ASETUKSET, Tilinpaatosmuoto: 'pien' },
      },
      arrange: async (c) => {
        await LUO_TOSITE(c);
      },
    });
    expect(await screen.findByText('Liikevaihto')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tilinpäätöksen muoto')).not.toBeInTheDocument();
  });
});
