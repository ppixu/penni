import type { KirjanpitoSyote } from '@/client/luoSiemen';
import { renderRoute } from '@/test/renderRoute';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// jsdomissa OPFS-Workeria ei voi avata, joten luoOpfsKirjanpito (velhon "Luo kirjanpito") korvataan
// synkronisella muisticlientilla, joka siementää saman syötteen (uuden kirjanpidon nimi näkyviin).
vi.mock('@/client/makeClient', async (orig) => {
  const real = await orig<typeof import('@/client/makeClient')>();
  const { luoKirjanpidonSiemen } = await import('@/client/luoSiemen');
  return {
    ...real,
    luoOpfsKirjanpito: vi.fn(async (syote: KirjanpitoSyote) =>
      real.luoPaikallinenClient(luoKirjanpidonSiemen(syote)),
    ),
  };
});

const SEED = {
  tilit: [{ numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankki' } }],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Vanha Oy', AlvVelvollinen: 'false' },
};

describe('Uusi kirjanpito -velho', () => {
  it('estää etenemisen ennen nimeä, sitten luo kirjanpidon ja siirtyy kojelaudalle', async () => {
    const { user } = await renderRoute('/uusikirjanpito', { seed: SEED });

    // Step 1: name required.
    const seuraava = await screen.findByRole('button', { name: 'Seuraava' });
    expect(seuraava).toBeDisabled();
    await user.type(screen.getByLabelText('Organisaation nimi'), 'Uusi Yritys Oy');
    expect(seuraava).toBeEnabled();
    await user.click(seuraava);

    // Step 2: chart template (yritys preselected).
    await user.click(screen.getByRole('button', { name: 'Seuraava' }));

    // Step 3: fiscal year (defaults valid) -> finish.
    await user.click(screen.getByRole('button', { name: 'Luo kirjanpito' }));

    // Lands on the dashboard, showing the new book's name (sidebar + topbar alaotsikko).
    expect(await screen.findByLabelText('kojelauta')).toBeInTheDocument();
    expect((await screen.findAllByText('Uusi Yritys Oy')).length).toBeGreaterThan(0);
  });

  it('estää virheellisen tilikauden (yli 18 kk)', async () => {
    const { user } = await renderRoute('/uusikirjanpito', { seed: SEED });
    await user.type(await screen.findByLabelText('Organisaation nimi'), 'Oy');
    await user.click(screen.getByRole('button', { name: 'Seuraava' })); // step 2
    await user.click(screen.getByRole('button', { name: 'Seuraava' })); // step 3
    const loppuu = screen.getByLabelText('Tilikausi päättyy');
    await user.clear(loppuu);
    await user.type(loppuu, '2027-12-31'); // 24 months from 2026-01-01
    expect(screen.getByRole('button', { name: 'Luo kirjanpito' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/18 kuukautta/i);
  });
});
