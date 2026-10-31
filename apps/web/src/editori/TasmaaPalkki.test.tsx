import { Euro } from '@penni/euro';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TasmaaPalkki } from './TasmaaPalkki.js';

describe('TasmaaPalkki', () => {
  it('is a polite status region', () => {
    render(<TasmaaPalkki tila="ok" erotus={Euro.fromCents(0)} />);
    const bar = screen.getByRole('status');
    expect(bar).toHaveAttribute('aria-live', 'polite');
  });

  it('shows "Täsmää" when ok', () => {
    render(<TasmaaPalkki tila="ok" erotus={Euro.fromCents(0)} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Täsmää/);
  });

  it('shows a neutral prompt, not "Täsmää", when there are no amounts yet', () => {
    render(<TasmaaPalkki tila="tyhja" erotus={Euro.fromCents(0)} />);
    const bar = screen.getByRole('status');
    expect(bar).toHaveTextContent('Ei vielä summia');
    expect(bar).not.toHaveTextContent(/Täsmää/);
  });

  it('shows the difference (formatted) when block', () => {
    render(<TasmaaPalkki tila="block" erotus={Euro.fromCents(5_000)} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Erotus.*50,00/);
  });

  it('accepts a warn tila (dormant Tier-0, wired for Tier-1)', () => {
    render(<TasmaaPalkki tila="warn" erotus={Euro.fromCents(100)} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Erotus/);
  });
});
