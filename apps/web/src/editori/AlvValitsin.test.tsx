import { VEROTYYPIT } from '@penni/engine';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlvValitsin } from './AlvValitsin.js';

const PVM = '2026-03-01'; // yleinen kanta 25,5 %

function renderoi(alvKoodi = 0, alvProsentti = 0) {
  const onValitse = vi.fn();
  render(
    <AlvValitsin
      rivi={1}
      alvKoodi={alvKoodi}
      alvProsentti={alvProsentti}
      pvm={PVM}
      ariaLabel="ALV, rivi 1"
      onValitse={onValitse}
    />,
  );
  return { onValitse };
}

describe('AlvValitsin', () => {
  it('avaa listan ja emittoi koodin + päivän oletuskannan verolliselle', async () => {
    const user = userEvent.setup();
    const { onValitse } = renderoi();
    await user.click(screen.getByRole('button', { name: 'ALV, rivi 1' }));
    await user.click(screen.getByRole('option', { name: /^Verollinen osto$/i }));
    expect(onValitse).toHaveBeenCalledWith(21, 25.5); // OSTOT_NETTO, yleinen kanta
  });

  it('nimeää verolliset koodit selkeästi: tavallinen vs. bruttokirjaus (koodit ennallaan)', async () => {
    const user = userEvent.setup();
    const { onValitse } = renderoi();
    await user.click(screen.getByRole('button', { name: 'ALV, rivi 1' }));
    expect(screen.getByRole('option', { name: 'Verollinen myynti' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Verollinen osto' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Verollinen osto (bruttokirjaus)' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /\((netto|brutto)\)/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Verollinen myynti (bruttokirjaus)' }));
    expect(onValitse).toHaveBeenCalledWith(12, 25.5); // MYYNNIT_BRUTTO
  });

  it('avaa valikon oikeaan reunaan tasattuna, jottei se valu ikkunan yli', async () => {
    const user = userEvent.setup();
    renderoi();
    await user.click(screen.getByRole('button', { name: 'ALV, rivi 1' }));
    const lista = screen.getByRole('option', { name: 'Verollinen myynti' }).closest('ul');
    expect(lista).toHaveClass('absolute', 'right-0');
    expect(lista?.parentElement).toHaveClass('relative');
  });

  it('pakottaa nollalajin prosentiksi 0', async () => {
    const user = userEvent.setup();
    const { onValitse } = renderoi();
    await user.click(screen.getByRole('button', { name: 'ALV, rivi 1' }));
    await user.click(screen.getByRole('option', { name: /Tavaroiden yhteisömyynti/i }));
    expect(onValitse).toHaveBeenCalledWith(14, 0); // YHTEISOMYYNTI_TAVARAT, nollalaji
  });

  it('näyttää valitun koodin lyhenteen ja prosentin desimaalipilkulla suljettuna', () => {
    renderoi(21, 25.5);
    expect(screen.getByRole('button', { name: 'ALV, rivi 1' })).toHaveTextContent(
      'Verollinen 25,5 %',
    );
  });

  it('erottaa bruttokirjauksen suljetussa näkymässä', () => {
    renderoi(12, 25.5);
    const nappi = screen.getByRole('button', { name: 'ALV, rivi 1' });
    expect(nappi).toHaveTextContent('Brutto 25,5 %');
    expect(nappi).toHaveAttribute('title', 'Verollinen myynti (bruttokirjaus)');
  });

  it('näyttää — kun ALV on veroton (EIALV)', () => {
    renderoi(0, 0);
    expect(screen.getByRole('button', { name: 'ALV, rivi 1' })).toHaveTextContent('—');
  });

  it('koodit-prop rajaa listan annettuihin verolajeihin', async () => {
    const user = userEvent.setup();
    const onValitse = vi.fn();
    render(
      <AlvValitsin
        rivi={1}
        alvKoodi={0}
        alvProsentti={0}
        pvm={PVM}
        ariaLabel="ALV, rivi 1"
        koodit={[0, 11, 19, 14, 15]}
        onValitse={onValitse}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'ALV, rivi 1' }));
    expect(screen.getAllByRole('option')).toHaveLength(5);
    expect(screen.queryByRole('option', { name: /Verollinen osto/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Verollinen myynti' }));
    expect(onValitse).toHaveBeenCalledWith(11, 25.5);
  });

  it('ilman koodit-proppia lista on ennallaan (kaikki verolajit)', async () => {
    const user = userEvent.setup();
    renderoi();
    await user.click(screen.getByRole('button', { name: 'ALV, rivi 1' }));
    expect(screen.getAllByRole('option')).toHaveLength(VEROTYYPIT.length);
  });
  it('sulkeutuu ulkopuoliseen klikkaukseen ja Escapeen, jottei auki jäänyt lista peitä muita kenttiä', async () => {
    const user = userEvent.setup();
    render(
      <>
        <AlvValitsin
          rivi={1}
          alvKoodi={0}
          alvProsentti={0}
          pvm={PVM}
          ariaLabel="ALV, rivi 1"
          onValitse={() => {}}
        />
        <input aria-label="muu kenttä" />
      </>,
    );
    const nappi = screen.getByRole('button', { name: 'ALV, rivi 1' });
    const details = nappi.closest('details');
    await user.click(nappi);
    expect(details).toHaveAttribute('open');
    await user.click(screen.getByRole('textbox', { name: 'muu kenttä' }));
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByRole('textbox', { name: 'muu kenttä' })).toHaveFocus();

    await user.click(nappi);
    expect(details).toHaveAttribute('open');
    await user.keyboard('{Escape}');
    expect(details).not.toHaveAttribute('open');
  });
});
