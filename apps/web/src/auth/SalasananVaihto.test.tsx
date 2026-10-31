import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SalasananVaihto } from './SalasananVaihto.js';

describe('SalasananVaihto', () => {
  it('lähettää vanhan ja uuden salasanan ja näyttää onnistumisen', async () => {
    const onVaihda = vi.fn().mockResolvedValue(undefined);
    render(<SalasananVaihto onVaihda={onVaihda} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nykyinen salasana'), 'salasana1');
    await user.type(screen.getByLabelText('Uusi salasana'), 'uusisala1');
    await user.click(screen.getByRole('button', { name: 'Vaihda salasana' }));
    expect(onVaihda).toHaveBeenCalledWith({
      vanhaSalasana: 'salasana1',
      uusiSalasana: 'uusisala1',
    });
    expect(await screen.findByText('Salasana vaihdettu')).toBeInTheDocument();
  });

  it('näyttää virheen', async () => {
    const onVaihda = vi.fn().mockRejectedValue(new Error('Väärä sähköposti tai salasana'));
    render(<SalasananVaihto onVaihda={onVaihda} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nykyinen salasana'), 'vaara');
    await user.type(screen.getByLabelText('Uusi salasana'), 'uusisala1');
    await user.click(screen.getByRole('button', { name: 'Vaihda salasana' }));
    expect(await screen.findByText('Väärä sähköposti tai salasana')).toBeInTheDocument();
  });
});
