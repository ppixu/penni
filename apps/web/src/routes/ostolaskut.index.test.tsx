import { renderRoute } from '@/test/renderRoute';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy' },
};

describe('vanhat listareitit', () => {
  it('ohjaa /ostolaskut -> tositteiden Menot-rajaus', async () => {
    const { router } = await renderRoute('/ostolaskut', { seed: SEED });
    expect(await screen.findByLabelText('tositteselaus')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ laji: 'menot' });
  });
});
