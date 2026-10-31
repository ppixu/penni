import { lueListanJarjestys, tallennaListanJarjestys } from '@/tositteet/listanJarjestys';
import { InProcessClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { KpClientProvider, useAsetaKirjanpito, useKpClient } from './KpClientProvider.js';

function client(nimi: string) {
  return new InProcessClient(createMemoryStorage({ asetukset: { Nimi: nimi } }));
}

function Naytin() {
  const kp = useKpClient();
  const aseta = useAsetaKirjanpito();
  const [nimi, setNimi] = useState('');
  useEffect(() => {
    void kp.haeAsetukset().then((a) => setNimi(a.Nimi ?? ''));
  }, [kp]);
  return (
    <>
      <p data-testid="nimi">{nimi}</p>
      <button type="button" onClick={() => aseta(client('Toinen Oy'))}>
        vaihda
      </button>
    </>
  );
}

describe('KpClientProvider', () => {
  it('vaihtaa aktiivisen kirjanpidon ja näyttää uuden datan', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <KpClientProvider client={client('Eka Oy')}>
          <Naytin />
        </KpClientProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Eka Oy')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'vaihda' }));
    expect(await screen.findByText('Toinen Oy')).toBeInTheDocument();
  });

  it('unohtaa tositelistan järjestyksen kirjanpidon vaihtuessa (id:t kuuluivat edelliseen)', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <KpClientProvider client={client('Eka Oy')}>
          <Naytin />
        </KpClientProvider>
      </QueryClientProvider>,
    );
    tallennaListanJarjestys('kirjanpidossa', [3, 1, 2]);
    await user.click(screen.getByRole('button', { name: 'vaihda' }));
    expect(await screen.findByText('Toinen Oy')).toBeInTheDocument();
    expect(lueListanJarjestys()).toBeNull();
  });
});
