import { renderReitittimessa } from '@/test/renderReitittimessa';
import type { TilinpaatosDoc } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TilinpaatosDokumentti } from './TilinpaatosDokumentti.js';

const doc: TilinpaatosDoc = {
  tilikausi: { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  muoto: 'yleinen',
  tuloslaskelma: [{ teksti: 'Liikevaihto', sisennys: 0, lihava: false, arvo: 123450 as Cents }],
  tase: [{ teksti: 'Rahat ja pankkisaamiset', sisennys: 0, lihava: false, arvo: 50000 as Cents }],
  liitetiedot: '',
  vahvistettu: null,
};

describe('TilinpaatosDokumentti', () => {
  it('näyttää otsikon, tuloslaskelman, taseen ja liitetietojen paikan', async () => {
    await renderReitittimessa(
      <TilinpaatosDokumentti doc={doc} nimi="Testi Oy" liitetiedot={<p>Henkilöstö 0</p>} />,
    );
    expect(await screen.findByRole('heading', { name: 'Tilinpäätös' })).toBeInTheDocument();
    expect(screen.getByText(/Testi Oy/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tuloslaskelma' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tase' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Liitetiedot' })).toBeInTheDocument();
    expect(screen.getByText('Liikevaihto')).toBeInTheDocument();
    expect(screen.getByText('Rahat ja pankkisaamiset')).toBeInTheDocument();
    expect(screen.getByText('Henkilöstö 0')).toBeInTheDocument();
  });
});
