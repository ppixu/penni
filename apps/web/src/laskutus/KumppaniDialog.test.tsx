import { renderWithProviders } from '@/test/renderWithProviders';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KumppaniDialog } from './KumppaniDialog.js';

describe('KumppaniDialog', () => {
  it('tallentaa asiakkaan oikean clientin kautta ja kutsuu onValittu-callbackia id:llä', async () => {
    const onValittu = vi.fn();
    const { user, client } = await renderWithProviders(
      <KumppaniDialog onValittu={onValittu} onPeruuta={() => {}} />,
    );
    await user.type(screen.getByLabelText('Nimi'), 'Asiakas Oy');
    await user.type(screen.getByLabelText('Osoite'), 'Asiakkaankatu 2');
    await user.type(screen.getByLabelText('Postinumero'), '00200');
    await user.type(screen.getByLabelText('Kaupunki'), 'Espoo');
    await user.type(screen.getByLabelText('Sähköposti'), 'info@asiakas.fi');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    await waitFor(() => expect(onValittu).toHaveBeenCalled());
    const kumppanit = await client.haeKumppanit();
    expect(kumppanit).toHaveLength(1);
    expect(kumppanit[0]).toMatchObject({
      nimi: 'Asiakas Oy',
      osoite: 'Asiakkaankatu 2',
      postinumero: '00200',
      kaupunki: 'Espoo',
      email: 'info@asiakas.fi',
    });
    expect(onValittu).toHaveBeenCalledWith(kumppanit[0]?.id);
  });

  it('vaatii nimen eikä tallenna ilman sitä', async () => {
    const onValittu = vi.fn();
    const { user, client } = await renderWithProviders(
      <KumppaniDialog onValittu={onValittu} onPeruuta={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Anna asiakkaan nimi.')).toBeInTheDocument();
    expect(await client.haeKumppanit()).toHaveLength(0);
    expect(onValittu).not.toHaveBeenCalled();
  });

  it('Peruuta kutsuu onPeruuta-callbackia', async () => {
    const onPeruuta = vi.fn();
    const { user } = await renderWithProviders(
      <KumppaniDialog onValittu={() => {}} onPeruuta={onPeruuta} />,
    );
    await user.click(screen.getByRole('button', { name: 'Peruuta' }));
    expect(onPeruuta).toHaveBeenCalled();
  });
});
