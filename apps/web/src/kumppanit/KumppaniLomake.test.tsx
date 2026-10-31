import { renderWithProviders } from '@/test/renderWithProviders';
import type { Kumppani, UusiKumppani } from '@penni/engine';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KumppaniLomake } from './KumppaniLomake.js';

describe('KumppaniLomake', () => {
  it('kokoaa vain ei-tyhjät kentät ja muotoillun IBANin', async () => {
    const onTallenna = vi.fn();
    const { user } = await renderWithProviders(
      <KumppaniLomake tallentaa={false} onTallenna={onTallenna} />,
    );
    await user.type(screen.getByLabelText('Nimi'), 'Toimittaja Oy');
    await user.type(screen.getByLabelText('Kaupunki'), 'Tampere');
    await user.click(screen.getByRole('button', { name: 'Lisää IBAN' }));
    await user.type(screen.getByLabelText('IBAN'), 'FI2112345600000785');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    expect(onTallenna).toHaveBeenCalledTimes(1);
    const syote = onTallenna.mock.calls[0]?.[0] as UusiKumppani;
    expect(syote).toMatchObject({ nimi: 'Toimittaja Oy', kaupunki: 'Tampere', kieli: 'fi' });
    expect(syote.iban).toEqual(['FI21 1234 5600 0007 85']);
    expect('osoite' in syote).toBe(false); // tyhjää ei liitetä
    expect('id' in syote).toBe(false); // luonti → ei id:tä
  });

  it('vaatii nimen eikä kutsu onTallennaa ilman sitä', async () => {
    const onTallenna = vi.fn();
    const { user } = await renderWithProviders(
      <KumppaniLomake tallentaa={false} onTallenna={onTallenna} />,
    );
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Anna kumppanin nimi.')).toBeInTheDocument();
    expect(onTallenna).not.toHaveBeenCalled();
  });

  it('estää tallennuksen kelpaamattomalla IBANilla', async () => {
    const onTallenna = vi.fn();
    const { user } = await renderWithProviders(
      <KumppaniLomake tallentaa={false} onTallenna={onTallenna} />,
    );
    await user.type(screen.getByLabelText('Nimi'), 'Firma');
    await user.click(screen.getByRole('button', { name: 'Lisää IBAN' }));
    await user.type(screen.getByLabelText('IBAN'), 'FI0000');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText(/Kelpaamaton IBAN/)).toBeInTheDocument();
    expect(onTallenna).not.toHaveBeenCalled();
  });

  it('esitäyttää muokkaustilassa ja liittää id:n koottuun syötteeseen', async () => {
    const alkuarvo: Kumppani = { id: 42, nimi: 'Vanha Oy', kaupunki: 'Oulu' };
    const onTallenna = vi.fn();
    const { user } = await renderWithProviders(
      <KumppaniLomake alkuarvo={alkuarvo} tallentaa={false} onTallenna={onTallenna} />,
    );
    expect(screen.getByLabelText('Nimi')).toHaveValue('Vanha Oy');
    expect(screen.getByLabelText('Kaupunki')).toHaveValue('Oulu');
    await user.type(screen.getByLabelText('Nimi'), ' Uusi');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    const syote = onTallenna.mock.calls[0]?.[0] as UusiKumppani;
    expect(syote.id).toBe(42);
    expect(syote.nimi).toBe('Vanha Oy Uusi');
  });

  it('lisää ja poistaa IBAN-rivejä', async () => {
    const onTallenna = vi.fn();
    const { user } = await renderWithProviders(
      <KumppaniLomake tallentaa={false} onTallenna={onTallenna} />,
    );
    await user.click(screen.getByRole('button', { name: 'Lisää IBAN' }));
    expect(screen.getAllByLabelText('IBAN')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Poista IBAN' }));
    expect(screen.queryByLabelText('IBAN')).not.toBeInTheDocument();
  });
});
