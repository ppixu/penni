import { renderRoute } from '@/test/renderRoute';
import { valitseTilikausi } from '@/test/valitseTilikausi';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [{ numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } }],
  tilikaudet: [
    { alkaa: '2024-01-01', loppuu: '2024-12-31' },
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: { Nimi: 'Demo Oy', TilitPaatetty: '2025-12-31' },
};

describe('TilikausiValitsin', () => {
  it('listaa kaudet uusin ensin ja merkitsee lukitut lukolla', async () => {
    const { user } = await renderRoute('/', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: /^Tilikausi/ }));
    const vaihtoehdot = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(vaihtoehdot.map((v) => v.textContent)).toEqual(['2026', '2025', '2024']);
    expect(
      within(vaihtoehdot[0] as HTMLElement).queryByRole('img', { name: 'lukittu' }),
    ).toBeNull();
    expect(
      within(vaihtoehdot[1] as HTMLElement).getByRole('img', { name: 'lukittu' }),
    ).toBeInTheDocument();
    expect(
      within(vaihtoehdot[2] as HTMLElement).getByRole('img', { name: 'lukittu' }),
    ).toBeInTheDocument();
  });

  it('valinta vaihtaa kauden ja näyttää lukon suljetussa valitsimessa', async () => {
    const { user } = await renderRoute('/', { seed: SEED });
    await screen.findByRole('button', { name: /^Tilikausi/ });
    await valitseTilikausi(user, '2025');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    const nappi = screen.getByRole('button', { name: /^Tilikausi/ });
    expect(nappi).toHaveTextContent('2025');
    expect(within(nappi).getByRole('img', { name: 'lukittu' })).toBeInTheDocument();
    expect(await screen.findByText(/Tilikausi 1\.1\.2025–31\.12\.2025/)).toBeInTheDocument();
  });

  it('toimii näppäimistöllä: nuoli alas ja Enter, Esc sulkee', async () => {
    const { user } = await renderRoute('/', { seed: SEED });
    const nappi = await screen.findByRole('button', { name: /^Tilikausi/ });
    await user.click(nappi);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(nappi).toHaveTextContent('2025');
    await user.click(nappi);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(nappi).toHaveFocus();
  });
});
