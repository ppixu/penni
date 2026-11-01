import { OSTOKOODIT } from '@/ostolaskut/ostolaskuReducer';
import { type Kohdennus, KohdennusTyyppi } from '@penni/engine';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { LaskuriviTaulukko } from './LaskuriviTaulukko.js';
import { alustaLaskuTila, laskuReducer } from './laskuReducer.js';

describe('LaskuriviTaulukko koodit-propti', () => {
  it('tarjoaa annetut ALV-koodit (ostokoodit)', async () => {
    const user = userEvent.setup();
    const tila = alustaLaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    render(
      <LaskuriviTaulukko
        rivit={tila.rivit}
        pvm="2026-06-10"
        dispatch={() => {}}
        koodit={OSTOKOODIT}
      />,
    );
    await user.click(screen.getByLabelText('ALV, rivi 1'));
    expect(screen.getByText(/Verollinen osto/)).toBeTruthy();
  });

  it('ilman koodit-proppia käyttää myyntikoodeja (myyntikäyttö säilyy)', async () => {
    const user = userEvent.setup();
    const tila = alustaLaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    render(<LaskuriviTaulukko rivit={tila.rivit} pvm="2026-06-10" dispatch={() => {}} />);
    await user.click(screen.getByLabelText('ALV, rivi 1'));
    expect(screen.getByText(/Verollinen myynti/)).toBeTruthy();
    expect(screen.queryByText(/Verollinen osto/)).toBeNull();
  });
});

const KOHDENNUKSET: Kohdennus[] = [
  { id: 1, tyyppi: KohdennusTyyppi.PROJEKTI, nimi: { fi: 'Kesäleiri' } },
  { id: 2, tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Avustus' } },
];

function Kaare({ kohdennukset }: { kohdennukset?: Kohdennus[] }) {
  const [tila, dispatch] = useReducer(
    laskuReducer,
    { laskupvm: '2026-06-10', alvVelvollinen: true },
    alustaLaskuTila,
  );
  return (
    <>
      <LaskuriviTaulukko
        rivit={tila.rivit}
        pvm={tila.laskupvm}
        dispatch={dispatch}
        kohdennukset={kohdennukset}
      />
      <output aria-label="rivi-tila">{JSON.stringify(tila.rivit[0])}</output>
    </>
  );
}

describe('LaskuriviTaulukko kohdennus-sarake', () => {
  it('on piilossa, kun kohdennuksia ei ole (ei proppia tai tyhjä lista)', () => {
    const { unmount } = render(<Kaare />);
    expect(screen.queryByRole('columnheader', { name: 'Kohdennus' })).toBeNull();
    expect(screen.queryByLabelText('Kohdennus, rivi 1')).toBeNull();
    unmount();
    render(<Kaare kohdennukset={[]} />);
    expect(screen.queryByRole('columnheader', { name: 'Kohdennus' })).toBeNull();
    expect(screen.queryByLabelText('Kohdennus, rivi 1')).toBeNull();
  });

  it('näkyy Selitteen jälkeen ja tallentaa projektin ja merkkauksen riville; valinnan voi tyhjentää', async () => {
    const user = userEvent.setup();
    render(<Kaare kohdennukset={KOHDENNUKSET} />);
    const otsikot = screen.getAllByRole('columnheader').map((o) => o.textContent);
    expect(otsikot.slice(0, 2)).toEqual(['Selite', 'Kohdennus']);

    await user.click(screen.getByRole('combobox', { name: 'Kohdennus, rivi 1' }));
    // Merkkaus on monivalinta (lista pysyy auki), projekti yksivalinta (lista sulkeutuu).
    await user.click(screen.getByRole('option', { name: 'Avustus' }));
    await user.click(screen.getByRole('option', { name: 'Kesäleiri' }));
    const tila = JSON.parse(screen.getByLabelText('rivi-tila').textContent ?? '{}');
    expect(tila).toMatchObject({ kohdennus: 1, merkkaukset: [2] });

    await user.tab();
    await user.click(screen.getByRole('combobox', { name: 'Kohdennus, rivi 1' }));
    await user.click(screen.getByRole('option', { name: 'Ei kohdennusta' }));
    const tyhja = JSON.parse(screen.getByLabelText('rivi-tila').textContent ?? '{}');
    expect(tyhja.kohdennus).toBeUndefined();
    expect(tyhja.merkkaukset).toEqual([2]);
  });
});
