import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Kirjautuminen } from './Kirjautuminen.js';

describe('Kirjautuminen', () => {
  it('lähettää sähköpostin ja salasanan', async () => {
    const onKirjaudu = vi.fn().mockResolvedValue(undefined);
    render(<Kirjautuminen onKirjaudu={onKirjaudu} onVaihdaRekisterointiin={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Sähköposti'), 'a@b.fi');
    await user.type(screen.getByLabelText('Salasana'), 'salasana1');
    await user.click(screen.getByRole('button', { name: 'Kirjaudu' }));
    expect(onKirjaudu).toHaveBeenCalledWith({ email: 'a@b.fi', salasana: 'salasana1' });
  });

  it('näyttää virheviestin epäonnistuessa', async () => {
    const onKirjaudu = vi.fn().mockRejectedValue(new Error('Väärä sähköposti tai salasana'));
    render(<Kirjautuminen onKirjaudu={onKirjaudu} onVaihdaRekisterointiin={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Sähköposti'), 'a@b.fi');
    await user.type(screen.getByLabelText('Salasana'), 'vaara');
    await user.click(screen.getByRole('button', { name: 'Kirjaudu' }));
    expect(await screen.findByText('Väärä sähköposti tai salasana')).toBeInTheDocument();
  });
});
