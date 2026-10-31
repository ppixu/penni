import { renderWithProviders } from '@/test/renderWithProviders';
import type { KpClient } from '@penni/asiakas';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiitetiedotEditori } from './LiitetiedotEditori.js';

describe('LiitetiedotEditori', () => {
  it('tallentaa liitetiedot oikealla loppupvm:llä', async () => {
    const { user, client } = await renderWithProviders(
      <LiitetiedotEditori loppupvm="2026-12-31" arvo="" lukittu={false} />,
      {
        // renderWithProviders.seed on callback samalle clientille jota UI käyttää.
        // Liitetietojen tallennus vaatii tilikauden (1k EITILIKAUTTA -vahti).
        seed: async (c: KpClient) => {
          await c.tallennaTilikausi('2026-01-01', { alkaa: '2026-01-01', loppuu: '2026-12-31' });
        },
      },
    );
    await user.type(screen.getByLabelText('Liitetiedot'), 'Yhtiö on toiminut normaalisti.');
    await user.click(screen.getByRole('button', { name: 'Tallenna liitetiedot' }));
    // Varmenna suoraan asetusavaimesta liitetiedot/<loppuu> — EI tarvita raporttilayoutteja
    // (haeTilinpaatos heittäisi EIRAPORTTIA ilman tase/*+tulos/*-layoutteja).
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset['liitetiedot/2026-12-31']).toBe('Yhtiö on toiminut normaalisti.');
    });
  });

  it('on vain luku kun lukittu (ei Tallenna-painiketta)', async () => {
    await renderWithProviders(
      <LiitetiedotEditori loppupvm="2026-12-31" arvo="Vahvistettu teksti" lukittu={true} />,
    );
    expect(screen.getByLabelText('Liitetiedot')).toHaveValue('Vahvistettu teksti');
    expect(screen.getByLabelText('Liitetiedot')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Tallenna liitetiedot' })).not.toBeInTheDocument();
  });
});
