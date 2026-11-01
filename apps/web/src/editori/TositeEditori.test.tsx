import { renderReitittimessa } from '@/test/renderReitittimessa';
import { type Kohdennus, KohdennusTyyppi, TositeTyyppi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { type ComponentProps, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type LomakkeenTaytto, TositeEditori } from './TositeEditori.js';
import { johdaViennit } from './johdaViennit.js';
import { uusiRivi } from './reducer.js';
import { CHART, valitseTili } from './testHelpers.js';
import { tositeEditorille } from './tositeEditorille.js';
import type { TositeEditoriTila, VientiRivi } from './types.js';

// N1 sketches (1, 2, 3, 6) never trigger a successful save; they assert focus / live täsmää /
// disabled state. The save itself is injected via `onTallenna` (the real useTositeTallennus
// wiring lands in Phase O). The screen takes `chart` directly, so no MemorySeed is needed.
// Reititin tarvitaan tallentamattomien muutosten varoitukselle (useBlocker).
const render0 = () =>
  renderReitittimessa(
    <TositeEditori chart={CHART} alkupaiva="2026-06-01" onTallenna={async () => undefined} />,
  );

describe('TositeEditori — focus model (sketch 1)', () => {
  it('Tab siirtää fokuksen Tili → Selite → Debet', async () => {
    const { user } = await render0();
    const tili = await screen.findByRole('combobox', { name: /Tili, rivi 1/i });
    tili.focus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: /Selite, rivi 1/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: /Debet, rivi 1/i })).toHaveFocus();
  });
});

describe('TositeEditori — Enter balancing row (sketch 2)', () => {
  it('Enter lisää tasaavan rivin jäljellä olevalle summalle ja siirtää fokuksen', async () => {
    const { user } = await render0();
    await valitseTili(user, 1, '7800');
    const debet1 = screen.getByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '86,40');
    await user.keyboard('{Enter}'); // commits EuroInput AND adds balancing row (picker closed)
    expect(screen.getByRole('textbox', { name: /Kredit, rivi 2/i })).toHaveValue('86,40');
    expect(screen.getByRole('status')).toHaveTextContent(/Täsmää/);
    expect(screen.getByRole('combobox', { name: /Tili, rivi 2/i })).toHaveFocus();
  });
});

describe('TositeEditori — live täsmää (sketch 3)', () => {
  // NOTE: the editor adds rows explicitly (Enter → balancing row), it does NOT auto-maintain a
  // trailing empty row — that model is the one the plan's reducer implements and the one sketch 2
  // depends on (the balancing line must be row 2, with no empty row between). The plan's sketch 3
  // as literally written assumed a trailing row would appear after a plain Tab commit; that is
  // incompatible with sketch 2, so here row 2 is created the same way the editor really creates
  // it (Enter on the committed debet cell). The assertion — the balance bar flips Erotus→Täsmää
  // live and Tallenna enables once balanced + accounted — is preserved verbatim.
  it('tyhjä lomake ei näytä Täsmää, vaan neutraalin palkin', async () => {
    await render0();
    const bar = screen.getByRole('status');
    expect(bar).toHaveTextContent('Ei vielä summia');
    expect(bar).not.toHaveTextContent(/Täsmää/);
  });

  it('tasapaino-palkki näyttää erotuksen kunnes debet = kredit', async () => {
    const { user } = await render0();
    await valitseTili(user, 1, '7800');
    const debet1 = screen.getByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '100,00');
    await user.tab(); // commit debet (Tab → focus moves to row 1's kredit cell)
    const bar = screen.getByRole('status');
    expect(bar).toHaveTextContent(/Erotus.*100,00/);
    await user.keyboard('{Enter}'); // adds balancing kredit row 2 = 100,00 → balances live
    await valitseTili(user, 2, '1900');
    expect(bar).toHaveTextContent(/Täsmää/);
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeEnabled();
  });
});

describe('TositeEditori — Tallenna disabled on imbalance (sketch 6)', () => {
  it('Tallenna on disabloitu kun debet ≠ kredit (block: EITASMAA)', async () => {
    const { user } = await render0();
    await valitseTili(user, 1, '7800');
    await user.type(screen.getByRole('textbox', { name: /Debet, rivi 1/i }), '50,00');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Erotus.*50,00/);
  });

  it('Tallenna on disabloitu kun rivillä on summa mutta ei tiliä (TILIPUUTTUU)', async () => {
    const { user } = await render0();
    // Type a debet on row 1 WITHOUT picking an account, then balance it on row 2 with an account.
    const debet1 = screen.getByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '50,00');
    await user.keyboard('{Enter}'); // balancing kredit row 2 = 50,00
    await valitseTili(user, 2, '1900');
    // Balanced, but row 1 has an amount and no account → still disabled.
    expect(screen.getByRole('status')).toHaveTextContent(/Täsmää/);
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
  });
});

describe('TositeEditori — Tulo-tila', () => {
  it('ensimmäisen rivin tilin valinnan jälkeen fokus siirtyy Kredit-soluun', async () => {
    const { user } = await render0();
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Tyyppi' })).getByRole('radio', {
        name: 'Tulo',
      }),
    );
    await valitseTili(user, 1, '3000');
    expect(screen.getByRole('textbox', { name: /Kredit, rivi 1/i })).toHaveFocus();
  });

  it('Meno-tilassa fokus siirtyy Debet-soluun', async () => {
    const { user } = await render0();
    await valitseTili(user, 1, '7800');
    expect(screen.getByRole('textbox', { name: /Debet, rivi 1/i })).toHaveFocus();
  });
});

describe('TositeEditori — tasaava rivi pankkitilille', () => {
  it('Enter esitäyttää tasaavan rivin pankkitilillä Meno-tositteessa', async () => {
    const { user } = await renderReitittimessa(
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        pankkitili={1900}
        onTallenna={async () => undefined}
      />,
    );
    await valitseTili(user, 1, '7800');
    await user.type(screen.getByRole('textbox', { name: /Debet, rivi 1/i }), '12,00');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: /Tili, rivi 2/i })).toHaveValue('1900 Pankkitili');
    expect(screen.getByRole('textbox', { name: /Kredit, rivi 2/i })).toHaveValue('12,00');
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeEnabled();
  });
});

describe('TositeEditori — mistä → mihin -yhteenveto', () => {
  it('näyttää tilit, joilta raha lähtee ja joille se kirjataan', async () => {
    const { user } = await render0();
    await valitseTili(user, 1, '7800');
    await user.click(screen.getByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('86,40{Enter}');
    await valitseTili(user, 2, '1900');

    const yhteenveto = screen.getByRole('region', { name: 'Kirjauksen yhteenveto' });
    const mista = within(yhteenveto).getByRole('list', { name: 'Mistä' });
    const mihin = within(yhteenveto).getByRole('list', { name: 'Mihin' });
    expect(mista).toHaveTextContent(/1900.*86,40/);
    expect(mihin).toHaveTextContent(/7800.*86,40/);
  });

  it('ei näy tyhjällä lomakkeella', async () => {
    await render0();
    expect(screen.queryByRole('region', { name: 'Kirjauksen yhteenveto' })).not.toBeInTheDocument();
  });
});

describe('TositeEditori — ulkoinen täyttö (kuitti)', () => {
  const taytetty = (selite: string) => ({
    avain: 1,
    laske: vi.fn((nyk: TositeEditoriTila) =>
      nyk.selite === '' ? { tila: { ...nyk, selite }, kuvaus: 'myyjä' } : null,
    ),
  });

  it('täyttää lomakkeen, näyttää ilmoituksen ja Kumoa palauttaa', async () => {
    const { user } = await renderReitittimessa(
      <TositeEditori chart={CHART} alkupaiva="2026-06-01" taytto={taytetty('Kahvila Aamu Oy')} />,
    );
    const otsikko = await screen.findByLabelText('Selite');
    expect(otsikko).toHaveValue('Kahvila Aamu Oy');
    expect(
      screen.getByText('Täytetty kuitista (myyjä) — tarkista ennen tallennusta.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kumoa' }));
    expect(otsikko).toHaveValue('');
    expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument();
  });

  it('ilmoitus katoaa ensimmäisestä omasta muokkauksesta', async () => {
    const { user } = await renderReitittimessa(
      <TositeEditori chart={CHART} alkupaiva="2026-06-01" taytto={taytetty('Kahvila')} />,
    );
    const otsikko = await screen.findByLabelText('Selite');
    await user.type(otsikko, ' 2');
    expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument();
  });

  it('laske saa nykyisen tilan ja oletuspäivän; null ei muuta mitään', async () => {
    const t = { avain: 1, laske: vi.fn(() => null) };
    await renderReitittimessa(<TositeEditori chart={CHART} alkupaiva="2026-06-01" taytto={t} />);
    await screen.findByLabelText('Selite');
    expect(t.laske).toHaveBeenCalledTimes(1);
    expect(t.laske).toHaveBeenCalledWith(
      expect.objectContaining({ paiva: '2026-06-01', selite: '' }),
      '2026-06-01',
      false,
    );
    expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument();
  });

  it('ilmoitus katoaa tallennukseen, vaikka lomake jää auki', async () => {
    const { user } = await renderReitittimessa(
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        taytto={taytetty('Kahvila')}
        onTallenna={async () => ({ id: 1 })}
      />,
    );
    await screen.findByText(/Täytetty kuitista/);
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Selite')).toHaveValue('Kahvila');
  });

  it('Tallenna ja uusi ei täytä uudelleen ja ilmoitus katoaa', async () => {
    const t = taytetty('Kahvila');
    const { user } = await renderReitittimessa(
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        taytto={t}
        onTallenna={async () => ({ id: 1 })}
      />,
    );
    const otsikko = await screen.findByLabelText('Selite');
    expect(otsikko).toHaveValue('Kahvila');
    await user.click(screen.getByRole('button', { name: 'Tallenna ja uusi' }));
    await screen.findByText(/Tallennettu:/);
    expect(otsikko).toHaveValue('');
    expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument();
    expect(t.laske).toHaveBeenCalledTimes(1);
  });

  it('uusi avain täyttää uudelleen ja Kumoa palaa juuri ennen sitä tilaan', async () => {
    const laske = vi.fn((nyk: TositeEditoriTila, _paiva: string) => ({
      tila: { ...nyk, selite: `${nyk.selite}+` },
      kuvaus: 'myyjä',
    }));
    function Kehys() {
      const [avain, setAvain] = useState(1);
      return (
        <>
          <button type="button" onClick={() => setAvain(2)}>
            Uusi kuitti
          </button>
          <TositeEditori chart={CHART} alkupaiva="2026-06-01" taytto={{ avain, laske }} />
        </>
      );
    }
    const { user } = await renderReitittimessa(<Kehys />);
    const otsikko = await screen.findByLabelText('Selite');
    expect(otsikko).toHaveValue('+');
    await user.click(screen.getByRole('button', { name: 'Uusi kuitti' }));
    expect(otsikko).toHaveValue('++');
    expect(laske).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Kumoa' }));
    expect(otsikko).toHaveValue('+');
  });
});

/** Rivi annetuin summin (testin täyttöihin). */
const rivi = (tili: number | undefined, debet: number, kredit: number): VientiRivi =>
  uusiRivi({
    ...(tili !== undefined ? { tili } : {}),
    debetSnt: Euro.fromCents(debet),
    kreditSnt: Euro.fromCents(kredit),
    alvKoodi: 0,
    alvProsentti: 0,
    bruttoSyotto: true,
  });

/** Täyttö, joka korvaa rivit menorivillä ja pankkirivillä (rivimäärä kasvaa). */
const riviTaytto = vi.fn((nyk: TositeEditoriTila) => ({
  tila: { ...nyk, rows: [rivi(7800, 640, 0), rivi(1900, 0, 640)] },
  kuvaus: 'summa',
}));

/**
 * Editori, jonka täytön testi käynnistää `kaynnista`-kutsulla. Kutsu ei koske fokukseen, kuten
 * taustalla valmistuva kuitin luku.
 */
async function renderTaytolla(
  laske: LomakkeenTaytto['laske'],
  props: Partial<ComponentProps<typeof TositeEditori>> = {},
) {
  let asetaAvain: (a: number) => void = () => {};
  let avain = 0;
  function Kehys() {
    const [nyt, setNyt] = useState<number | null>(null);
    asetaAvain = setNyt;
    return (
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        taytto={nyt === null ? undefined : { avain: nyt, laske }}
        {...props}
      />
    );
  }
  const tulos = await renderReitittimessa(<Kehys />);
  const kaynnista = () => {
    avain += 1;
    act(() => asetaAvain(avain));
  };
  return { ...tulos, kaynnista };
}

describe('TositeEditori — ulkoinen täyttö kesken käyttäjän kirjoituksen', () => {
  it('laske saa tiedon riviin kirjoitetusta, vielä vahvistamattomasta summasta', async () => {
    const laske = vi.fn(() => null);
    const { user, kaynnista } = await renderTaytolla(laske);
    const debet1 = screen.getByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '12,00');
    kaynnista();
    expect(laske).toHaveBeenLastCalledWith(expect.anything(), '2026-06-01', true);
    expect(debet1).toHaveValue('12,00');
  });

  it('pelkkä fokus tyhjässä rivin solussa ei estä rivien täyttöä', async () => {
    const laske = vi.fn(() => null);
    const { user, kaynnista } = await renderTaytolla(laske);
    await user.click(screen.getByRole('textbox', { name: /Debet, rivi 1/i }));
    kaynnista();
    expect(laske).toHaveBeenLastCalledWith(expect.anything(), '2026-06-01', false);
  });

  it('rivejä lisäävä täyttö ei siirrä fokusta otsikosta', async () => {
    const { user, kaynnista } = await renderTaytolla(riviTaytto);
    const otsikko = screen.getByLabelText('Selite');
    await user.type(otsikko, 'Oma');
    kaynnista();
    expect(screen.getByRole('textbox', { name: /Kredit, rivi 2/i })).toHaveValue('6,40');
    expect(otsikko).toHaveFocus();
    await user.keyboard(' lisää');
    expect(otsikko).toHaveValue('Oma lisää');
  });

  it('täyttö pitää fokuksen tyhjässä solussa, johon se oli jäänyt', async () => {
    const { user, kaynnista } = await renderTaytolla(riviTaytto);
    await user.click(screen.getByRole('textbox', { name: /Debet, rivi 1/i }));
    kaynnista();
    const debet1 = screen.getByRole('textbox', { name: /Debet, rivi 1/i });
    expect(debet1).toHaveValue('6,40');
    expect(debet1).toHaveFocus();
  });

  it('täyttö pitää fokuksen tyhjässä tilisolussa eikä avaa toisen rivin tililistaa', async () => {
    const { user, kaynnista } = await renderTaytolla(riviTaytto);
    await user.click(screen.getByRole('combobox', { name: /Tili, rivi 1/i }));
    kaynnista();
    const tili1 = screen.getByRole('combobox', { name: /Tili, rivi 1/i });
    const tili2 = screen.getByRole('combobox', { name: /Tili, rivi 2/i });
    await waitFor(() => expect(tili2).toHaveValue('1900 Pankkitili'));
    expect(tili1).toHaveFocus();
    // Täyttö ei avannut toisen rivin listaa: auki on vain käyttäjän oman solun lista.
    for (const lista of screen.queryAllByRole('listbox')) {
      expect(lista.id).toBe(tili1.getAttribute('aria-controls'));
    }
    // Enter ei vaihda täytettyä pankkitiliä listan ensimmäiseen tiliin.
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: /Tili, rivi 2/i })).toHaveValue('1900 Pankkitili');
    expect(screen.getByRole('combobox', { name: /Tili, rivi 1/i })).toHaveValue(
      '7800 Toimistotarvikkeet',
    );
  });

  it('Kumoa, joka palauttaa useamman rivin, ei siirrä fokusta viimeiselle riville', async () => {
    const yksiRivi = vi.fn((nyk: TositeEditoriTila) => ({
      tila: { ...nyk, rows: [rivi(7800, 640, 0)] },
      kuvaus: 'summa',
    }));
    const tyhjat = [rivi(undefined, 0, 0), rivi(undefined, 0, 0), rivi(undefined, 0, 0)];
    const { user, kaynnista } = await renderTaytolla(yksiRivi, {
      initial: { paiva: '2026-06-01', rows: tyhjat },
    });
    kaynnista();
    expect(screen.queryByRole('combobox', { name: /Tili, rivi 2/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kumoa' }));
    expect(screen.getByRole('combobox', { name: /Tili, rivi 3/i })).not.toHaveFocus();
    expect(screen.getAllByRole('combobox', { name: /Tili, rivi/i })).toHaveLength(3);
  });

  it('Tallenna ja uusi: säilytetystä päivästä tulee seuraavan täytön oletuspäivä', async () => {
    const laske = vi.fn(() => null);
    const { user, kaynnista } = await renderTaytolla(laske, {
      onTallenna: async () => ({ id: 1 }),
    });
    fireEvent.change(screen.getByLabelText('Päivä'), { target: { value: '2026-06-15' } });
    await user.click(screen.getByRole('button', { name: 'Tallenna ja uusi' }));
    await screen.findByText(/Tallennettu:/);
    expect(screen.getByLabelText('Päivä')).toHaveValue('2026-06-15');
    kaynnista();
    expect(laske).toHaveBeenLastCalledWith(
      expect.objectContaining({ paiva: '2026-06-15' }),
      '2026-06-15',
      false,
    );
  });
});

describe('TositeEditori — automaattisen tallennuksen kytkennät', () => {
  it('onMuutos saa alkutilan ja jokaisen muutoksen', async () => {
    const onMuutos = vi.fn();
    const { user } = await renderReitittimessa(
      <TositeEditori chart={CHART} alkupaiva="2026-06-01" onMuutos={onMuutos} />,
    );
    expect(onMuutos).toHaveBeenCalledWith(
      expect.objectContaining({ paiva: '2026-06-01', selite: '' }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), 'K');
    expect(onMuutos).toHaveBeenLastCalledWith(expect.objectContaining({ selite: 'K' }));
  });

  it('onKenttaPoistui kutsutaan, kun kenttä menettää fokuksen', async () => {
    const onKenttaPoistui = vi.fn();
    const { user } = await renderReitittimessa(
      <TositeEditori chart={CHART} alkupaiva="2026-06-01" onKenttaPoistui={onKenttaPoistui} />,
    );
    await user.click(screen.getByRole('textbox', { name: 'Selite' }));
    expect(onKenttaPoistui).not.toHaveBeenCalled();
    await user.tab();
    expect(onKenttaPoistui).toHaveBeenCalled();
  });

  it('ilman onTallennaa ei ole tallennuspainikkeita; ⌘S tallentaa odottavan muutoksen', async () => {
    const onKenttaPoistui = vi.fn();
    const { user } = await renderReitittimessa(
      <TositeEditori chart={CHART} alkupaiva="2026-06-01" onKenttaPoistui={onKenttaPoistui} />,
    );
    expect(screen.queryByRole('button', { name: /Tallenna/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('textbox', { name: 'Selite' }));
    await user.keyboard('{Control>}s{/Control}');
    expect(onKenttaPoistui).toHaveBeenCalledTimes(1);
  });

  it('Kirjaa-tekstit: painikkeet ja vahvistus', async () => {
    const { user } = await renderReitittimessa(
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        tallennaTeksti="Kirjaa"
        vahvistus="Kirjattu"
        onTallenna={async () => ({ id: 1, tunniste: 1, sarja: '', tyyppi: 100 })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Kirjaa' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));
    expect(await screen.findByText('Kirjattu: Meno 1')).toBeInTheDocument();
  });

  it('ja uusi kertoo nollatun tilan, ja se on myös seuraava raportoitu tila', async () => {
    const onMuutos = vi.fn();
    const onNollattu = vi.fn();
    const { user } = await renderReitittimessa(
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        onMuutos={onMuutos}
        onNollattu={onNollattu}
        onTallenna={async () => ({ id: 1 })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Päivä'), { target: { value: '2026-06-15' } });
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), 'Kahvit');
    await user.click(screen.getByRole('button', { name: 'Tallenna ja uusi' }));
    await screen.findByText(/Tallennettu:/);
    expect(onNollattu).toHaveBeenCalledTimes(1);
    const nollattu = onNollattu.mock.calls[0]?.[0] as TositeEditoriTila;
    expect(nollattu).toMatchObject({ paiva: '2026-06-15', selite: '' });
    expect(onMuutos).toHaveBeenLastCalledWith(nollattu);
  });

  it('editori ei itse kysy poistuttaessa (reitti päättää)', async () => {
    const { user, router } = await renderReitittimessa(
      <TositeEditori chart={CHART} alkupaiva="2026-06-01" />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), 'Kesken');
    await act(async () => {
      await router.navigate({ to: '/tositteet' });
    });
    expect(await screen.findByText('Toinen sivu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('TositeEditori — kohdennussarake', () => {
  const KOHDENNUKSET: Kohdennus[] = [
    { id: 1, tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta' } },
    { id: 3, tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Avustus' } },
  ];
  const sarakeotsikot = () => screen.getAllByRole('columnheader').map((th) => th.textContent);

  it('kirjanpidossa ei kohdennuksia: ei Kohdennus-saraketta', async () => {
    await renderReitittimessa(<TositeEditori chart={CHART} alkupaiva="2026-06-01" />);
    expect(sarakeotsikot()).not.toContain('Kohdennus');
    await renderReitittimessa(
      <TositeEditori chart={CHART} alkupaiva="2026-06-01" kohdennukset={[]} />,
    );
    expect(sarakeotsikot()).not.toContain('Kohdennus');
    expect(screen.queryByRole('combobox', { name: /Kohdennus/ })).not.toBeInTheDocument();
  });

  it('sarake Selitteen jälkeen; Tab ohittaa solun 1900-rivillä ja pysähtyy 4000-rivillä', async () => {
    const { user } = await renderReitittimessa(
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        kohdennukset={KOHDENNUKSET}
        initial={{
          paiva: '2026-06-01',
          rows: [
            uusiRivi({
              tili: 1900,
              debetSnt: Euro.fromCents(0),
              kreditSnt: Euro.fromCents(1000),
              alvKoodi: 0,
              alvProsentti: 0,
              bruttoSyotto: true,
            }),
            uusiRivi({
              tili: 4000,
              debetSnt: Euro.fromCents(1000),
              kreditSnt: Euro.fromCents(0),
              alvKoodi: 0,
              alvProsentti: 0,
              bruttoSyotto: true,
            }),
          ],
        }}
      />,
    );
    expect(sarakeotsikot().slice(0, 3)).toEqual(['Tili', 'Selite', 'Kohdennus']);
    expect(screen.queryByRole('combobox', { name: 'Kohdennus, rivi 1' })).not.toBeInTheDocument();
    screen.getByRole('textbox', { name: 'Selite, rivi 1' }).focus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Debet, rivi 1' })).toHaveFocus();
    screen.getByRole('textbox', { name: 'Selite, rivi 2' }).focus();
    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Kohdennus, rivi 2' })).toHaveFocus();
  });

  it('kohdennuksen valinta tallentuu riville ja fokus siirtyy summaan', async () => {
    const onMuutos = vi.fn();
    const { user } = await renderReitittimessa(
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        kohdennukset={KOHDENNUKSET}
        onMuutos={onMuutos}
      />,
    );
    await valitseTili(user, 1, '4000');
    await user.click(screen.getByRole('combobox', { name: 'Kohdennus, rivi 1' }));
    await user.click(screen.getByRole('option', { name: 'Nuorisotoiminta' }));
    expect(onMuutos).toHaveBeenLastCalledWith(
      expect.objectContaining({ rows: [expect.objectContaining({ tili: 4000, kohdennus: 1 })] }),
    );
    expect(screen.getByRole('textbox', { name: 'Debet, rivi 1' })).toHaveFocus();
  });

  it('kohdennus 1 + merkkaus 3 avautuu, näkyy solussa ja tallentuu takaisin muuttumattomana', async () => {
    const viennit = johdaViennit(
      [
        uusiRivi({
          tili: 4000,
          debetSnt: Euro.fromCents(1000),
          kreditSnt: Euro.fromCents(0),
          alvKoodi: 0,
          alvProsentti: 0,
          bruttoSyotto: true,
          kohdennus: 1,
          merkkaukset: [3],
        }),
        uusiRivi({
          tili: 1900,
          debetSnt: Euro.fromCents(0),
          kreditSnt: Euro.fromCents(1000),
          alvKoodi: 0,
          alvProsentti: 0,
          bruttoSyotto: true,
        }),
      ],
      CHART,
      '2026-06-01',
    );
    const alkutila = tositeEditorille(
      { pvm: '2026-06-01', viennit, tyyppi: TositeTyyppi.MENO, sarja: '', otsikko: 'Leiri' },
      CHART,
    );
    expect(alkutila).not.toBeNull();
    const onTallenna = vi.fn(async (_tila: TositeEditoriTila) => ({ id: 1 }));
    const { user } = await renderReitittimessa(
      <TositeEditori
        chart={CHART}
        alkupaiva="2026-06-01"
        kohdennukset={KOHDENNUKSET}
        initial={alkutila ?? {}}
        onTallenna={onTallenna}
        tallennaJaUusi={false}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Kohdennus, rivi 1' })).toHaveValue(
      'Nuorisotoiminta · Avustus',
    );
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    const tallennettu = onTallenna.mock.calls[0]?.[0] as TositeEditoriTila;
    expect(johdaViennit(tallennettu.rows, CHART, tallennettu.paiva)).toEqual(viennit);
  });
});
