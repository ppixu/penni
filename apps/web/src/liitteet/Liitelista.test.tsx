import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Liitelista } from './Liitelista.js';

describe('Liitelista', () => {
  it('näyttää liitteet nimineen ja avaus-painikkeineen', () => {
    render(
      <Liitelista
        liitteet={[{ id: 1, tosite: 3, nimi: 'kuitti.pdf', tyyppi: 'application/pdf', luotu: 'x' }]}
        onAvaa={vi.fn()}
      />,
    );
    expect(screen.getByText('kuitti.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /avaa/i })).toBeInTheDocument();
  });

  it('näyttää Poista-painikkeen, kun poisto on sallittu', async () => {
    const onPoista = vi.fn();
    render(
      <Liitelista
        liitteet={[{ id: 1, tosite: 3, nimi: 'kuitti.pdf', tyyppi: 'application/pdf', luotu: 'x' }]}
        onAvaa={vi.fn()}
        onPoista={onPoista}
      />,
    );
    screen.getByRole('button', { name: 'Poista kuitti.pdf' }).click();
    expect(onPoista).toHaveBeenCalledWith(1);
  });

  it('ei renderöi mitään kun liitteitä ei ole', () => {
    const { container } = render(<Liitelista liitteet={[]} onAvaa={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
