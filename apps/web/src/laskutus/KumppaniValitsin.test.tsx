import type { Kumppani } from '@penni/engine';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KumppaniValitsin } from './KumppaniValitsin.js';

const KUMPPANIT: Kumppani[] = [
  { id: 1, nimi: 'Maija Oy' },
  { id: 2, nimi: 'Pekka Ky' },
];

function renderoi(arvo?: number) {
  const onValitse = vi.fn();
  const onUusiAsiakas = vi.fn();
  render(
    <KumppaniValitsin
      kumppanit={KUMPPANIT}
      arvo={arvo}
      ariaLabel="Asiakas"
      onValitse={onValitse}
      onUusiAsiakas={onUusiAsiakas}
    />,
  );
  return { onValitse, onUusiAsiakas };
}

describe('KumppaniValitsin', () => {
  it('suodattaa nimellä ja valitsee osuman Enterillä', async () => {
    const user = userEvent.setup();
    const { onValitse } = renderoi();
    const input = screen.getByRole('combobox', { name: 'Asiakas' });
    await user.click(input);
    await user.type(input, 'maija');
    expect(screen.getByText('Maija Oy')).toBeVisible();
    expect(screen.queryByText('Pekka Ky')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onValitse).toHaveBeenCalledWith(1);
  });

  it('näyttää valitun asiakkaan nimen suljettuna', () => {
    renderoi(2);
    expect(screen.getByRole('combobox', { name: 'Asiakas' })).toHaveValue('Pekka Ky');
  });

  it('"+ Uusi asiakas" pysyy listalla suodatuksesta huolimatta ja avaa pikaluonnin', async () => {
    const user = userEvent.setup();
    const { onUusiAsiakas, onValitse } = renderoi();
    const input = screen.getByRole('combobox', { name: 'Asiakas' });
    await user.click(input);
    await user.type(input, 'zzz'); // ei osu yhteenkään asiakkaaseen
    expect(screen.queryByText('Maija Oy')).not.toBeInTheDocument();
    expect(screen.getByText('+ Uusi asiakas')).toBeVisible();
    await user.keyboard('{Enter}');
    expect(onUusiAsiakas).toHaveBeenCalled();
    expect(onValitse).not.toHaveBeenCalled();
  });

  it('hiiriklikkaus listan riviin valitsee sen (regressio: onBlur ei saa sulkea listaa ennen klikkausta)', async () => {
    const user = userEvent.setup();
    const { onValitse } = renderoi();
    const input = screen.getByRole('combobox', { name: 'Asiakas' });
    await user.click(input);
    await user.click(screen.getByText('Maija Oy'));
    expect(onValitse).toHaveBeenCalledWith(1);
  });

  it('hiiriklikkaus "+ Uusi asiakas" -riviin avaa pikaluonnin', async () => {
    const user = userEvent.setup();
    const { onUusiAsiakas, onValitse } = renderoi();
    const input = screen.getByRole('combobox', { name: 'Asiakas' });
    await user.click(input);
    await user.click(screen.getByText('+ Uusi asiakas'));
    expect(onUusiAsiakas).toHaveBeenCalled();
    expect(onValitse).not.toHaveBeenCalled();
  });

  it('kumppanit-taulukon identiteetin vaihtuminen ei pyyhi kesken olevaa hakutekstiä', async () => {
    const user = userEvent.setup();
    const props = {
      arvo: 2,
      ariaLabel: 'Asiakas',
      onValitse: vi.fn(),
      onUusiAsiakas: vi.fn(),
    };
    const { rerender } = render(<KumppaniValitsin kumppanit={KUMPPANIT} {...props} />);
    const input = screen.getByRole('combobox', { name: 'Asiakas' });
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'mai'); // käyttäjä hakee toista asiakasta
    // Taustapäivitys (esim. react-query refetch) tuottaa uuden taulukon samalla sisällöllä.
    rerender(<KumppaniValitsin kumppanit={KUMPPANIT.map((k) => ({ ...k }))} {...props} />);
    expect(input).toHaveValue('mai');
  });
});
