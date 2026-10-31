import { renderRoute } from '@/test/renderRoute';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy' },
};

describe('/kumppanit/uusi', () => {
  it('luo kumppanin ja navigoi muokkaukseen', async () => {
    const { user, client } = await renderRoute('/kumppanit/uusi', { seed: SEED });
    await user.type(await screen.findByLabelText('Nimi'), 'Uusi Kumppani Oy');
    await user.type(screen.getByLabelText('Kaupunki'), 'Turku');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    // Tallennus → kumppani syntyy oikean clientin kautta
    expect(await screen.findByText('Muokkaa kumppania')).toBeInTheDocument();
    const kumppanit = await client.haeKumppanit();
    expect(kumppanit).toHaveLength(1);
    expect(kumppanit[0]).toMatchObject({ nimi: 'Uusi Kumppani Oy', kaupunki: 'Turku' });
  });

  it('luonti lämpimällä kumppanivälimuistilla päätyy muokkausnäkymään (ei kimpoa listaan)', async () => {
    const { user } = await renderRoute('/kumppanit', { seed: SEED });
    // Lämmitä ['kumppanit']-välimuisti: lista mountataan ja hakee (tyhjän) listan.
    await screen.findByText('Ei kumppaneita.');
    await user.click(screen.getByRole('button', { name: '+ Uusi kumppani' }));
    await user.type(await screen.findByLabelText('Nimi'), 'Uusi Oy');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Muokkaa kumppania')).toBeInTheDocument();
    expect(screen.getByLabelText('Nimi')).toHaveValue('Uusi Oy');
  });
});
