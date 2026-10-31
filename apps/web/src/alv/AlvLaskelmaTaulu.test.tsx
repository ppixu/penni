import { type Cents, Euro } from '@penni/euro';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlvLaskelmaTaulu } from './AlvLaskelmaTaulu.js';

function laskelma(parit: [number, number][], maksettava: number) {
  return {
    koodit: new Map<number, Cents>(parit.map(([k, snt]) => [k, Euro.fromCents(snt)])),
    maksettava: Euro.fromCents(maksettava),
  };
}

describe('AlvLaskelmaTaulu', () => {
  it('renderöi harvan mapin rivit kiinteässä järjestyksessä ja 308:n lihavoituna', () => {
    render(
      <AlvLaskelmaTaulu
        laskelma={laskelma(
          [
            [307, 2_550],
            [301, 5_100],
            [308, 2_550],
          ],
          2_550,
        )}
      />,
    );
    const taulu = screen.getByLabelText('alv-laskelma');
    const rivit = within(taulu).getAllByRole('row');
    expect(rivit).toHaveLength(3);
    expect(rivit[0]).toHaveTextContent('Suoritettava 24% / 25,5%:n vero kotimaan myynnistä');
    expect(rivit[0]).toHaveTextContent('51,00 €');
    expect(rivit[1]).toHaveTextContent('Verokauden vähennettävä vero');
    expect(rivit[2]).toHaveTextContent('Maksettava vero / Palautukseen oikeuttava vero');
    expect(rivit[2]).toHaveTextContent('25,50 €');
    expect(
      within(rivit[2] as HTMLElement).getByText('Maksettava vero / Palautukseen oikeuttava vero'),
    ).toHaveClass('font-semibold');
  });

  it('negatiivinen maksettava (palautus) näkyy typografisella miinuksella', () => {
    render(<AlvLaskelmaTaulu laskelma={laskelma([[307, 2_550]], -2_550)} />);
    expect(screen.getByText('−25,50 €')).toBeInTheDocument();
  });

  it('308 renderöityy maksettava-kentästä myös kun se puuttuu mapista (nolla)', () => {
    render(<AlvLaskelmaTaulu laskelma={laskelma([[309, 10_000]], 0)} />);
    const taulu = screen.getByLabelText('alv-laskelma');
    expect(within(taulu).getAllByRole('row')).toHaveLength(2);
    const rivi = within(taulu)
      .getByText('Maksettava vero / Palautukseen oikeuttava vero')
      .closest('tr');
    expect(rivi).toHaveTextContent('0,00 €');
  });
});
