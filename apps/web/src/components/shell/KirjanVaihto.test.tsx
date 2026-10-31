import type { TuontiSilta } from '@penni/tuonti';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KirjanVaihto } from './KirjanVaihto.js';

const KIRJA = '/Users/x/Kirjat/Oy.penni';
const TESTI = '/Users/x/Kirjat/Oy-testi-ilman-Q3.penni';

function asennaSilta() {
  const silta = {
    kirjat: vi.fn().mockResolvedValue({ nykyinen: TESTI, viimeisimmat: [TESTI, KIRJA] }),
    vaihdaKirja: vi.fn().mockResolvedValue(undefined),
    valitseKirja: vi.fn().mockResolvedValue(undefined),
    poistaViimeisin: vi.fn().mockResolvedValue(undefined),
  };
  window.penni = silta as unknown as TuontiSilta;
  return silta;
}

afterEach(() => {
  window.penni = undefined;
});

describe('KirjanVaihto', () => {
  it('selaimessa näyttää vain yrityksen ilman vaihtajaa', () => {
    render(<KirjanVaihto kirjanpito="Oy" />);
    expect(screen.getByText('Oy')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('työpöydällä näyttää avoimen tiedoston nimen ja vaihtaa viimeisimpään kirjaan', async () => {
    const silta = asennaSilta();
    render(<KirjanVaihto kirjanpito="Oy" />);
    expect(await screen.findByText('Oy-testi-ilman-Q3.penni')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { expanded: false }));
    const valikko = screen.getByRole('menu', { name: /vaihda kirjanpitoa/i });
    expect(valikko).toBeInTheDocument();
    // Avoin kirja on merkitty eikä sitä voi "vaihtaa" itseensä.
    expect(screen.getByRole('menuitem', { name: 'Oy-testi-ilman-Q3.penni' })).toBeDisabled();

    await userEvent.click(screen.getByRole('menuitem', { name: 'Oy.penni' }));
    expect(silta.vaihdaKirja).toHaveBeenCalledWith(KIRJA);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('"Avaa muu kirjanpito…" avaa natiivin dialogin', async () => {
    const silta = asennaSilta();
    render(<KirjanVaihto kirjanpito="Oy" />);
    await userEvent.click(await screen.findByRole('button', { expanded: false }));
    await userEvent.click(screen.getByRole('menuitem', { name: /avaa muu kirjanpito/i }));
    expect(silta.valitseKirja).toHaveBeenCalledOnce();
  });

  it('Muokkaa-tilassa poistaa kirjan listalta, mutta ei avointa kirjaa', async () => {
    const silta = asennaSilta();
    render(<KirjanVaihto kirjanpito="Oy" />);
    await userEvent.click(await screen.findByRole('button', { expanded: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Muokkaa' }));

    expect(
      screen.queryByRole('button', { name: /poista listalta: oy-testi/i }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Poista listalta: Oy.penni' }));
    expect(silta.poistaViimeisin).toHaveBeenCalledWith(KIRJA);
    expect(screen.queryByText('Oy.penni')).not.toBeInTheDocument();
    expect(silta.vaihdaKirja).not.toHaveBeenCalled();
    // Muokattavaa ei enää ole, joten valikko jää auki ja Muokkaa-tila on yhä päällä (Valmis).
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valmis' })).toBeInTheDocument();
  });

  it('Muokkaa puuttuu, jos listalla on vain avoin kirja', async () => {
    const silta = asennaSilta();
    silta.kirjat.mockResolvedValue({ nykyinen: TESTI, viimeisimmat: [TESTI] });
    render(<KirjanVaihto kirjanpito="Oy" />);
    await userEvent.click(await screen.findByRole('button', { expanded: false }));
    expect(screen.queryByRole('button', { name: 'Muokkaa' })).not.toBeInTheDocument();
  });

  it('Esc sulkee valikon', async () => {
    asennaSilta();
    render(<KirjanVaihto kirjanpito="Oy" />);
    await userEvent.click(await screen.findByRole('button', { expanded: false }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
