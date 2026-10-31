import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl.js';

const VAIHTOEHDOT = [
  { arvo: 100, label: 'Meno' },
  { arvo: 200, label: 'Tulo' },
  { arvo: 300, label: 'Siirto' },
  { arvo: 700, label: 'Muistio' },
];

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio per option and marks the selected one', () => {
    render(
      <SegmentedControl nimi="Tyyppi" vaihtoehdot={VAIHTOEHDOT} arvo={100} onMuutos={() => {}} />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Tyyppi' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Meno' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Tulo' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onMuutos with the option value on click', async () => {
    const user = userEvent.setup();
    const onMuutos = vi.fn();
    render(
      <SegmentedControl nimi="Tyyppi" vaihtoehdot={VAIHTOEHDOT} arvo={100} onMuutos={onMuutos} />,
    );
    await user.click(screen.getByRole('radio', { name: 'Tulo' }));
    expect(onMuutos).toHaveBeenCalledWith(200);
  });

  it('näyttää kuvakkeen tekstin edessä, eikä kuvake muuta nimeä', () => {
    render(
      <SegmentedControl
        nimi="Tyyppi"
        vaihtoehdot={[{ arvo: 100, label: 'Meno', ikoni: <span data-testid="ikoni" /> }]}
        arvo={100}
        onMuutos={() => {}}
      />,
    );
    const nappi = screen.getByRole('radio', { name: 'Meno' });
    expect(nappi).toContainElement(screen.getByTestId('ikoni'));
  });
});
