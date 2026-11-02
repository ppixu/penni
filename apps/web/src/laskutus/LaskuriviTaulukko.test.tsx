import { OSTOKOODIT } from '@/ostolaskut/ostolaskuReducer';
import { type Kohdennus, KohdennusTyyppi, type Tuote } from '@penni/engine';
import { Euro } from '@penni/euro';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { LaskuriviTaulukko } from './LaskuriviTaulukko.js';
import { type LomakeRivi, alustaLaskuTila, laskuReducer } from './laskuReducer.js';
import { riviTositeRiviksi } from './rakennaLaskuSyote.js';

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

describe('LaskuriviTaulukko tuotevalinta', () => {
  const TUOTTEET: Tuote[] = [
    {
      id: 1,
      nimike: 'Konsultointi',
      koodi: 'KON',
      unKoodi: 'HUR',
      aNetto: 80.5,
      alvKoodi: 11,
      alvProsentti: 25.5,
      tili: 3100,
    },
    {
      id: 2,
      nimike: 'Konepaja-asennus',
      aNetto: 0.0125,
      alvKoodi: 11,
      alvProsentti: 24,
      yksikko: 'vuoro',
    },
    { id: 3, nimike: 'Kuljetus', koodi: 'RAHTI-1', aNetto: 30, alvKoodi: 11, alvProsentti: 25.5 },
    ...Array.from({ length: 10 }, (_, i) => ({
      id: 10 + i,
      nimike: `Kone ${i}`,
      aNetto: 1,
      alvKoodi: 11,
      alvProsentti: 25.5,
    })),
  ];

  /** Oikea reducer ympärillä: näyttää, mitä rivistä tallennettaisiin. */
  function Kehys({ alvVelvollinen = true }: { alvVelvollinen?: boolean }) {
    const [tila, dispatch] = useReducer(
      laskuReducer,
      { laskupvm: '2026-06-10', alvVelvollinen },
      alustaLaskuTila,
    );
    return (
      <>
        <LaskuriviTaulukko
          rivit={tila.rivit}
          pvm="2026-06-10"
          dispatch={dispatch}
          tuotteet={TUOTTEET}
          alvVelvollinen={alvVelvollinen}
        />
        <output data-testid="rivi1">
          {JSON.stringify(tila.rivit[0] ? riviTositeRiviksi(tila.rivit[0]) : null)}
        </output>
      </>
    );
  }
  const tallennettava = () => JSON.parse(screen.getByTestId('rivi1').textContent ?? 'null');

  it('ehdottaa tuotteita nimikkeen ja koodin perusteella, kirjainkoosta riippumatta', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'kons');
    expect(screen.getByRole('option', { name: /Konsultointi/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Kuljetus/ })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Selite, rivi 1'));
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'rahti');
    // Koodi osuu Kuljetukseen, vaikka nimike ei sisällä hakusanaa.
    expect(screen.getByRole('option', { name: /Kuljetus/ })).toBeInTheDocument();
  });

  it('näyttää enintään 8 ehdotusta', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'kone');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(8);
  });

  it('ei ehdota mitään tyhjällä tai osumattomalla tekstillä', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    const selite = screen.getByLabelText('Selite, rivi 1');
    await user.click(selite);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.type(selite, 'zzz');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('nuoli alas + Enter valitsee tuotteen ja täyttää rivin, määrä säilyy', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    const kpl = screen.getByLabelText('Kpl, rivi 1');
    await user.clear(kpl);
    await user.type(kpl, '3');
    const selite = screen.getByLabelText('Selite, rivi 1');
    await user.type(selite, 'kons');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(selite).toHaveValue('Konsultointi');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(tallennettava()).toMatchObject({
      selite: 'Konsultointi',
      myyntiKpl: 3,
      aNetto: 80.5,
      alvKoodi: 11,
      alvProsentti: 25.5,
      unKoodi: 'HUR',
      tili: 3100,
      tuote: 1,
    });
    expect(screen.getByLabelText('À-hinta, rivi 1')).toHaveValue('80,50');
    // Fokus pysyy selitekentässä, jotta Tab jatkaa Kpl-soluun.
    expect(selite).toHaveFocus();
  });

  it('nuolet liikuttavat valintaa ja Enter valitsee korostetun', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'kone');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
    // Ehdotukset ovat aakkosjärjestyksessä: Kone 0, Kone 1, …; kolme alas ja yksi ylös on Kone 1.
    expect(tallennettava()).toMatchObject({ tuote: 11, selite: 'Kone 1' });
  });

  it('Enter ilman nuolivalintaa ei valitse mitään', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'kons{Enter}');
    expect(tallennettava()).not.toHaveProperty('tuote');
  });

  it('Escape sulkee ehdotukset ja säilyttää kirjoitetun tekstin', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    const selite = screen.getByLabelText('Selite, rivi 1');
    await user.type(selite, 'kons');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(selite).toHaveValue('kons');
    expect(tallennettava()).not.toHaveProperty('tuote');
  });

  it('hiiren klikkaus valitsee tuotteen', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'konepaja');
    await user.click(screen.getByRole('option', { name: /Konepaja-asennus/ }));
    expect(screen.getByLabelText('Selite, rivi 1')).toHaveValue('Konepaja-asennus');
    expect(tallennettava()).toMatchObject({ tuote: 2, yksikko: 'vuoro' });
  });

  it('vanha yleinen kanta päivittyy nykyiseksi ja alle sentin hinta säilyy pyöristämättä', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'konepaja');
    await user.click(screen.getByRole('option', { name: /Konepaja-asennus/ }));
    expect(tallennettava()).toMatchObject({ alvProsentti: 25.5, aNetto: 0.0125 });
  });

  it('alv-vapaassa kirjassa tuotteen alv nollataan', async () => {
    const user = userEvent.setup();
    render(<Kehys alvVelvollinen={false} />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'kons');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(tallennettava()).toMatchObject({ alvKoodi: 0, alvProsentti: 0, tuote: 1 });
  });

  it('vapaa teksti ilman valintaa jättää tuotteen asettamatta', async () => {
    const user = userEvent.setup();
    render(<Kehys />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'Oma rivi');
    await user.tab();
    expect(tallennettava()).toMatchObject({ selite: 'Oma rivi' });
    expect(tallennettava()).not.toHaveProperty('tuote');
  });

  it('ilman tuotteet-proppia (ostolasku) ehdotuksia ei näytetä', async () => {
    const user = userEvent.setup();
    const tila = alustaLaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    render(<LaskuriviTaulukko rivit={tila.rivit} pvm="2026-06-10" dispatch={() => {}} />);
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'kons');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
