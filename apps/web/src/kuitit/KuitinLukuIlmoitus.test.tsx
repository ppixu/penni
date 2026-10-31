import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KuitinLukuIlmoitus } from './KuitinLukuIlmoitus.js';

describe('KuitinLukuIlmoitus', () => {
  it('kysyy latausluvan', async () => {
    const onLupa = vi.fn();
    render(<KuitinLukuIlmoitus tila={{ vaihe: 'tarvitseeLuvan' }} onLupa={onLupa} />);
    expect(screen.getByText(/Penni lataa lukumallin \(n\. 0,85 Gt\) kerran/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lataa ja lue' }));
    expect(onLupa).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Ei nyt' }));
    expect(onLupa).toHaveBeenCalledWith(false);
  });

  it('näyttää latauksen ja lukemisen tilarivinä', () => {
    const { rerender } = render(
      <KuitinLukuIlmoitus tila={{ vaihe: 'ladataanMallia', osuus: 0.42 }} onLupa={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Ladataan lukumallia… 42 %');
    rerender(<KuitinLukuIlmoitus tila={{ vaihe: 'luetaan' }} onLupa={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Luetaan kuittia…');
  });

  it('kertoo, kun kuittia ei saatu luettua', () => {
    const { rerender } = render(
      <KuitinLukuIlmoitus tila={{ vaihe: 'eiLuettu', syy: 'virhe' }} onLupa={vi.fn()} />,
    );
    expect(screen.getByText('Kuittia ei saatu luettua — täytä tiedot käsin.')).toBeInTheDocument();
    rerender(<KuitinLukuIlmoitus tila={{ vaihe: 'eiLuettu', syy: 'eiGpu' }} onLupa={vi.fn()} />);
    expect(
      screen.getByText(/Tämä laite ei pysty lukemaan kuvakuitteja automaattisesti/),
    ).toBeInTheDocument();
  });

  it('ei näytä mitään levossa', () => {
    const { container } = render(<KuitinLukuIlmoitus tila={{ vaihe: 'lepo' }} onLupa={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
