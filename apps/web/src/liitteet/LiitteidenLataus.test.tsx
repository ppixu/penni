import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LIITE_MAX_TAVUT, LiitteidenLataus } from './LiitteidenLataus.js';

describe('LiitteidenLataus', () => {
  it('kutsuu onLataa valitulla tiedostolla', async () => {
    const onLataa = vi.fn().mockResolvedValue(undefined);
    render(<LiitteidenLataus onLataa={onLataa} />);
    const tiedosto = new File([new Uint8Array([1, 2, 3])], 'kuitti.pdf', {
      type: 'application/pdf',
    });
    await userEvent.upload(screen.getByLabelText(/lisää liite/i), tiedosto);
    await waitFor(() => expect(onLataa).toHaveBeenCalledOnce());
  });

  it('hylkää yli 10 Mt tiedoston eikä kutsu onLataa', async () => {
    const onLataa = vi.fn();
    render(<LiitteidenLataus onLataa={onLataa} />);
    const iso = new File([new Uint8Array(LIITE_MAX_TAVUT + 1)], 'iso.pdf', {
      type: 'application/pdf',
    });
    await userEvent.upload(screen.getByLabelText(/lisää liite/i), iso);
    expect(onLataa).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/10 Mt/i);
  });

  it('näyttää virheen kun onLataa hylkää eikä heitä käsittelemätöntä poikkeusta', async () => {
    const onLataa = vi.fn().mockRejectedValue(new Error('tallennus epäonnistui palvelimella'));
    render(<LiitteidenLataus onLataa={onLataa} />);
    const tiedosto = new File([new Uint8Array([1, 2, 3])], 'kuitti.pdf', {
      type: 'application/pdf',
    });
    await userEvent.upload(screen.getByLabelText(/lisää liite/i), tiedosto);
    expect(await screen.findByRole('alert')).toHaveTextContent('Liitteen tallennus epäonnistui.');
  });

  it('on tyylitelty pudotusalue: tiedostokenttä piilotettu, useampi tiedosto kerralla', async () => {
    const onLataa = vi.fn().mockResolvedValue(undefined);
    render(<LiitteidenLataus onLataa={onLataa} />);
    const kentta = screen.getByLabelText('Lisää liite');
    expect(kentta).toHaveClass('sr-only');
    expect(kentta).toHaveAttribute('multiple');
    await userEvent.upload(kentta, [
      new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array([2])], 'b.png', { type: 'image/png' }),
    ]);
    // Tiedostot luetaan ja tallennetaan peräkkäin asynkronisesti: odotetaan molempia.
    await waitFor(() => expect(onLataa).toHaveBeenCalledTimes(2));
  });
});
