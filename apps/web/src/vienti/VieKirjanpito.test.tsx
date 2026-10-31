import { renderWithProviders } from '@/test/renderWithProviders';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VieKirjanpito } from './VieKirjanpito';

const lataukset: { nimi: string; tyyppi: string | undefined; koko: number }[] = [];
vi.mock('@/laskutus/lataaLaskuPdf', () => ({
  lataaSelaimeen: (tavut: Uint8Array, nimi: string, tyyppi?: string) => {
    lataukset.push({ nimi, tyyppi, koko: tavut.length });
  },
}));

afterEach(() => {
  lataukset.length = 0;
});

describe('VieKirjanpito', () => {
  it('klikkaus käynnistää yhden zip-latauksen', async () => {
    const { user } = await renderWithProviders(<VieKirjanpito />, {
      seed: async (client) => {
        await client.paivitaAsetukset({ Nimi: 'Demo Oy' });
      },
    });
    await user.click(screen.getByRole('button', { name: 'Vie kirjanpito' }));
    await waitFor(() => expect(lataukset).toHaveLength(1));
    expect(lataukset[0]?.nimi).toMatch(/^Demo Oy-kirjanpito-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(lataukset[0]?.tyyppi).toBe('application/zip');
    expect(lataukset[0]?.koko).toBeGreaterThan(0);
    // Nappi vapautuu latauksen jälkeen.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Vie kirjanpito' })).toBeEnabled(),
    );
  });

  it('näyttää virheen, jos vienti epäonnistuu', async () => {
    const { user, client } = await renderWithProviders(<VieKirjanpito />);
    client.haeInit = () => Promise.reject(new Error('Tietokanta ei vastaa'));
    await user.click(screen.getByRole('button', { name: 'Vie kirjanpito' }));
    expect(await screen.findByText('Tietokanta ei vastaa')).toBeInTheDocument();
    expect(lataukset).toHaveLength(0);
  });
});
