import { OSTOKOODIT } from '@/ostolaskut/ostolaskuReducer';
import { type Kohdennus, KohdennusTyyppi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { LaskuriviTaulukko } from './LaskuriviTaulukko.js';
import { type LomakeRivi, alustaLaskuTila, laskuReducer } from './laskuReducer.js';

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

describe('LaskuriviTaulukko ennakon vähennysrivi ilman tunnettua ennakkoa', () => {
  const vahennysRivi = (): LomakeRivi => ({
    avain: 1,
    selite: 'Ennakkolaskun 1 hyvitys',
    myyntiKpl: 1,
    aNettoSnt: Euro.fromCents(-4000),
    alvKoodi: 1,
    alvProsentti: 25.5,
    lisat: { ennakkoTosite: 7, tili: 2861 },
  });

  const muutokset = (): { aNettoSnt?: number }[] => [];

  it('määrää ei voi nostaa nykyisestä, kun ennakkoa ei löydy ladatuista', async () => {
    const user = userEvent.setup();
    const kirjatut = muutokset();
    render(
      <LaskuriviTaulukko
        rivit={[vahennysRivi()]}
        pvm="2026-06-10"
        ennakot={[]}
        dispatch={(a) => {
          if (a.type === 'setRivi') kirjatut.push(a.muutos);
        }}
      />,
    );
    const kentta = screen.getByLabelText('Ennakon vähennys, rivi 1');
    expect(kentta).toHaveValue('40,00');
    await user.clear(kentta);
    await user.type(kentta, '900');
    await user.tab();
    expect(kirjatut.at(-1)?.aNettoSnt).toBe(-4000);
    expect(await screen.findByLabelText('Ennakon vähennys, rivi 1')).toHaveValue('40,00');
  });

  it('määrän voi laskea', async () => {
    const user = userEvent.setup();
    const kirjatut = muutokset();
    render(
      <LaskuriviTaulukko
        rivit={[vahennysRivi()]}
        pvm="2026-06-10"
        ennakot={[]}
        dispatch={(a) => {
          if (a.type === 'setRivi') kirjatut.push(a.muutos);
        }}
      />,
    );
    const kentta = screen.getByLabelText('Ennakon vähennys, rivi 1');
    await user.clear(kentta);
    await user.type(kentta, '10');
    await user.tab();
    expect(kirjatut.at(-1)?.aNettoSnt).toBe(-1000);
  });
});
