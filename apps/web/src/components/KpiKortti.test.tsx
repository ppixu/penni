import { Euro } from '@penni/euro';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiKortti } from './KpiKortti.js';

describe('KpiKortti', () => {
  it('renders label + Finnish-formatted figure', () => {
    render(<KpiKortti otsikko="Pankki" arvo={Euro.fromCents(864_210)} />);
    expect(screen.getByText('Pankki')).toBeInTheDocument();
    expect(screen.getByText('8 642,10 €')).toBeInTheDocument();
  });

  it('colours a positive Tulos figure with --positive when positiivinen', () => {
    render(<KpiKortti otsikko="Tulos" arvo={Euro.fromCents(2_413_050)} positiivinenVihrea />);
    const fig = screen.getByText('24 130,50 €');
    expect(fig).toHaveClass('text-[var(--positive)]');
  });
});
