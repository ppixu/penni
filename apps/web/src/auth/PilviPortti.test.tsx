import { injectFetcher } from '@/client/test/injectFetcher';
import { luoMuistiControlStore } from '@penni/control';
import { luoPalvelin } from '@penni/server';
import { createMemoryStorage } from '@penni/storage-memory';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { PilviPortti } from './PilviPortti.js';

afterEach(() => localStorage.clear());

function api() {
  const app = luoPalvelin(createMemoryStorage(), {
    control: luoMuistiControlStore(),
    kello: () => '2026-06-01T00:00:00.000Z',
  });
  return injectFetcher(app);
}

describe('PilviPortti', () => {
  it('näyttää kirjautumisen ilman tokenia ja sisällön rekisteröinnin jälkeen', async () => {
    render(<PilviPortti baseUrl="http://kp.local" api={api()} lapset={() => <div>SISÄLLÄ</div>} />);
    expect(await screen.findByText('Kirjaudu Penniin')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Luo uusi tili' }));
    await user.type(screen.getByLabelText('Sähköposti'), 'a@b.fi');
    await user.type(screen.getByLabelText('Salasana'), 'salasana1');
    await user.click(screen.getByRole('button', { name: 'Rekisteröidy' }));
    expect(await screen.findByText('SISÄLLÄ')).toBeInTheDocument();
    expect(localStorage.getItem('penni.token')).toBeTruthy();
  });
});
