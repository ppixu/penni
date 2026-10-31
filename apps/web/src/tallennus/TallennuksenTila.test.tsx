import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TallennuksenTila, tallennuksenTeksti } from './TallennuksenTila.js';

describe('tallennuksenTeksti', () => {
  it('kertoo tilan spesifikaation sanoin', () => {
    expect(tallennuksenTeksti('tallennettu', null, false, 'Tallennettu luonnoksena')).toBeNull();
    expect(tallennuksenTeksti('tallennettu', null, true, 'Tallennettu luonnoksena')).toBe(
      'Tallennettu luonnoksena',
    );
    expect(tallennuksenTeksti('tallennetaan', null, true, 'Tallennettu')).toBe('Tallennetaan…');
    expect(tallennuksenTeksti('virhe', 'Tallennus epäonnistui.', true, 'Tallennettu')).toBe(
      'Tallennus epäonnistui — yritetään uudelleen. Tallennus epäonnistui.',
    );
    expect(tallennuksenTeksti('virhe', null, true, 'Tallennettu')).toBe(
      'Tallennus epäonnistui — yritetään uudelleen',
    );
    expect(tallennuksenTeksti('eiKelpaa', 'ei täsmää', false, 'Tallennettu')).toBe(
      'Ei tallennettu — ei täsmää',
    );
  });
});

describe('TallennuksenTila', () => {
  it('on aina olemassa oleva aria-live-alue', () => {
    const { container, rerender } = render(
      <TallennuksenTila
        tila="tallennettu"
        syy={null}
        tallennettuKerran={false}
        tallennettuTeksti="Tallennettu"
      />,
    );
    const alue = container.querySelector('[aria-live="polite"]');
    expect(alue).toBeInTheDocument();
    expect(alue).toBeEmptyDOMElement();
    rerender(
      <TallennuksenTila
        tila="eiKelpaa"
        syy="ei täsmää"
        tallennettuKerran={false}
        tallennettuTeksti="Tallennettu"
      />,
    );
    expect(screen.getByText('Ei tallennettu — ei täsmää')).toBe(alue);
  });
});
