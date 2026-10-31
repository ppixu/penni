import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button.js';

describe('Button', () => {
  it('renders an accessible button with its label', () => {
    render(<Button>Tallenna</Button>);
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeInTheDocument();
  });

  it('fires onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Tallenna</Button>);
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
