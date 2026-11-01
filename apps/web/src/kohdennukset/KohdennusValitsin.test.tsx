import { type Kohdennus, KohdennusTyyppi, lataaKartta } from '@penni/engine';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  type KohdennusArvo,
  KohdennusValitsin,
  kohdennusSoluKaytossa,
} from './KohdennusValitsin.js';

const KOHDENNUKSET: Kohdennus[] = [
  { id: 1, tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta' } },
  {
    id: 2,
    tyyppi: KohdennusTyyppi.PROJEKTI,
    kuuluu: 1,
    nimi: { fi: 'Kesäleiri' },
    paattyy: '2025-12-31',
  },
  { id: 3, tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Avustus' } },
  { id: 4, tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Arpajaiset' } },
];

/** Ohjattu kääre: arvo päivittyy kuten ruudukossa, ja jokainen muutos kirjataan. */
function Kaare({
  alku = {},
  onMuuta,
  onAcceptDone,
}: {
  alku?: KohdennusArvo;
  onMuuta: (a: KohdennusArvo) => void;
  onAcceptDone?: () => void;
}) {
  const [arvo, setArvo] = useState(alku);
  return (
    <KohdennusValitsin
      kohdennukset={KOHDENNUKSET}
      pvm="2026-06-01"
      arvo={arvo}
      onMuuta={(a) => {
        setArvo(a);
        onMuuta(a);
      }}
      ariaLabel="Kohdennus, rivi 1"
      {...(onAcceptDone ? { onAcceptDone } : {})}
    />
  );
}

async function avaa() {
  const user = userEvent.setup();
  const input = screen.getByRole('combobox', { name: 'Kohdennus, rivi 1' });
  await user.click(input);
  return { user, input };
}

describe('KohdennusValitsin', () => {
  it('piilottaa vanhentuneen kohdennuksen, paitsi kun se on valittuna', async () => {
    const { unmount } = render(<Kaare onMuuta={() => {}} />);
    await avaa();
    expect(screen.getByRole('option', { name: 'Ei kohdennusta' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nuorisotoiminta' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Kesäleiri/ })).not.toBeInTheDocument();
    unmount();

    render(<Kaare alku={{ kohdennus: 2 }} onMuuta={() => {}} />);
    const { input } = await avaa();
    expect(input).toHaveValue('Nuorisotoiminta/Kesäleiri');
    expect(screen.getByRole('option', { name: 'Nuorisotoiminta/Kesäleiri' })).toBeInTheDocument();
  });

  it('ryhmät otsikoineen; Ei kohdennusta on ensimmäinen', async () => {
    render(<Kaare onMuuta={() => {}} />);
    await avaa();
    const ryhma = screen.getByRole('group', { name: 'Kustannuspaikat ja projektit' });
    expect(within(ryhma).getAllByRole('option')[0]).toHaveAccessibleName('Ei kohdennusta');
    expect(screen.getByRole('group', { name: 'Merkkaukset' })).toBeInTheDocument();
  });

  it('merkkausryhmä puuttuu, kun merkkauksia ei ole', async () => {
    render(
      <KohdennusValitsin
        kohdennukset={KOHDENNUKSET.filter((k) => k.tyyppi !== KohdennusTyyppi.MERKKAUS)}
        pvm="2026-06-01"
        arvo={{}}
        onMuuta={() => {}}
        ariaLabel="Kohdennus, rivi 1"
      />,
    );
    await avaa();
    expect(screen.queryByRole('group', { name: 'Merkkaukset' })).not.toBeInTheDocument();
  });

  it('kahden merkkauksen vaihto (Enter ja välilyönti) antaa järjestetyt merkkaukset, lista pysyy auki', async () => {
    const onMuuta = vi.fn();
    const onAcceptDone = vi.fn();
    render(<Kaare onMuuta={onMuuta} onAcceptDone={onAcceptDone} />);
    const { user } = await avaa();
    await user.keyboard('{Control>}a{/Control}Avustus');
    await user.keyboard('{Enter}');
    expect(onMuuta).toHaveBeenLastCalledWith({ merkkaukset: [3] });
    // Selaustila (ei hakua): End korostaa viimeisen (Avustus), ylänuoli Arpajaiset.
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    await user.keyboard('{End}{ArrowUp}');
    await user.keyboard(' ');
    expect(onMuuta).toHaveBeenLastCalledWith({ merkkaukset: [3, 4] });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(onAcceptDone).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'Arpajaiset' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('kirjoitetussa haussa välilyönti on hakusanojen väli eikä vaihda merkkausta', async () => {
    const onMuuta = vi.fn();
    render(
      <KohdennusValitsin
        kohdennukset={[
          { id: 5, tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Avustus 2025' } },
          { id: 6, tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Avustus 2026' } },
        ]}
        pvm="2026-06-01"
        arvo={{}}
        onMuuta={onMuuta}
        ariaLabel="Kohdennus, rivi 1"
      />,
    );
    const { user, input } = await avaa();
    await user.keyboard('Avustus 2026');
    expect(input).toHaveValue('Avustus 2026');
    expect(onMuuta).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onMuuta).toHaveBeenCalledTimes(1);
    expect(onMuuta).toHaveBeenLastCalledWith({ merkkaukset: [6] });
  });

  it('Enterillä haun kautta valitun merkkauksen jälkeen välilyönti jatkaa hakua (ei poista valintaa)', async () => {
    const onMuuta = vi.fn();
    render(<Kaare onMuuta={onMuuta} />);
    const { user, input } = await avaa();
    await user.keyboard('{Control>}a{/Control}Avustus');
    await user.keyboard('{Enter}');
    expect(onMuuta).toHaveBeenLastCalledWith({ merkkaukset: [3] });
    await user.keyboard(' ');
    expect(onMuuta).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('Avustus ');
  });

  it('kustannuspaikan valinta säilyttää merkkaukset, sulkee listan ja kutsuu onAcceptDone', async () => {
    const onMuuta = vi.fn();
    const onAcceptDone = vi.fn();
    render(<Kaare alku={{ merkkaukset: [3] }} onMuuta={onMuuta} onAcceptDone={onAcceptDone} />);
    const { user, input } = await avaa();
    await user.click(screen.getByRole('option', { name: 'Nuorisotoiminta' }));
    expect(onMuuta).toHaveBeenLastCalledWith({ merkkaukset: [3], kohdennus: 1 });
    expect(onAcceptDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('Nuorisotoiminta · Avustus');
  });

  it('Ei kohdennusta poistaa kohdennuksen', async () => {
    const onMuuta = vi.fn();
    render(<Kaare alku={{ kohdennus: 1 }} onMuuta={onMuuta} />);
    const { user } = await avaa();
    await user.click(screen.getByRole('option', { name: 'Ei kohdennusta' }));
    expect(onMuuta).toHaveBeenLastCalledWith({});
  });
});

describe('kohdennusSoluKaytossa', () => {
  const kartta = lataaKartta([
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 1100, tyyppi: 'APT', nimi: { fi: 'Koneet' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ]);
  const tili = (n: number) => kartta.find((t) => t.numero === n);
  it('tuloslaskelman tilit ja poistettava omaisuus kyllä, muut taseen tilit ei', () => {
    expect(kohdennusSoluKaytossa(tili(4000))).toBe(true);
    expect(kohdennusSoluKaytossa(tili(3000))).toBe(true);
    expect(kohdennusSoluKaytossa(tili(1100))).toBe(true);
    expect(kohdennusSoluKaytossa(tili(1900))).toBe(false);
    expect(kohdennusSoluKaytossa(undefined)).toBe(false);
  });
});
