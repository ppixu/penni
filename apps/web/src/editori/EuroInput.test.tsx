import { Euro } from '@penni/euro';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EuroInput } from './EuroInput.js';

describe('EuroInput', () => {
  it('commits a comma amount to Cents on blur', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<EuroInput aria-label="Debet, rivi 1" arvo={Euro.fromCents(0)} onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Debet, rivi 1' });
    await user.type(input, '86,40');
    await user.tab(); // blur → commit
    expect(onCommit).toHaveBeenCalledWith(8_640);
  });

  it('commits a dot amount too (Euro.fromString accepts both)', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<EuroInput aria-label="Kredit, rivi 1" arvo={Euro.fromCents(0)} onCommit={onCommit} />);
    await user.type(screen.getByRole('textbox', { name: 'Kredit, rivi 1' }), '100.00');
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith(10_000);
  });

  it('takes the absolute value (grid columns are unsigned)', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<EuroInput aria-label="Debet, rivi 1" arvo={Euro.fromCents(0)} onCommit={onCommit} />);
    await user.type(screen.getByRole('textbox', { name: 'Debet, rivi 1' }), '-50,00');
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith(5_000);
  });

  it('marks the field invalid and does not commit on a bad amount', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<EuroInput aria-label="Debet, rivi 1" arvo={Euro.fromCents(0)} onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'Debet, rivi 1' });
    await user.type(input, '12,,3');
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a committed non-zero value as a bare comma figure (no €)', () => {
    render(
      <EuroInput aria-label="Debet, rivi 1" arvo={Euro.fromCents(8_640)} onCommit={() => {}} />,
    );
    expect(screen.getByRole('textbox', { name: 'Debet, rivi 1' })).toHaveValue('86,40');
  });

  it('shows an empty string for a zero value (placeholder em-dash handled by the cell)', () => {
    render(<EuroInput aria-label="Debet, rivi 1" arvo={Euro.fromCents(0)} onCommit={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Debet, rivi 1' })).toHaveValue('');
  });
});
