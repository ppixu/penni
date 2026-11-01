import { alustaTila, uusiRivi } from '@/editori/reducer';
import { CHART } from '@/editori/testHelpers';
import { AlvKoodi, type Kuitti, TositeTyyppi, poimiKuittiTekstista } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it, vi } from 'vitest';
import { type TayttoOptiot, kuittiTaytto } from './kuittiTaytto.js';

const OLETUS = '2026-10-11';
const optiot = (muuta: Partial<TayttoOptiot> = {}): TayttoOptiot => ({
  oletusPaiva: OLETUS,
  chart: CHART,
  asetukset: { pankkitili: 1900, menotili: 4000 },
  sallittuPaiva: (p) => p >= '2026-01-01' && p <= '2026-12-31',
  alvVelvollinen: () => true,
  ...muuta,
});
const kuitti = (muuta: Partial<Kuitti> = {}): Kuitti => ({
  myyja: 'Kahvila Aamu Oy',
  pvm: '2026-07-15',
  valuutta: 'EUR',
  bruttoSumma: Euro.fromCents(1255),
  alv: [{ kanta: 25.5, brutto: Euro.fromCents(1255) }],
  ...muuta,
});
const tyhja = () => alustaTila({ paiva: OLETUS });

describe('kuittiTaytto', () => {
  it.each(['USD $20.00', '$20.00', 'GBP 20.00'])(
    'ei kirjaa vierasta valuuttaa euroina: %s',
    (summa) => {
      const luettu = poimiKuittiTekstista(
        `Receipt from Example Inc\nDate paid July 15, 2026\nMonthly subscription\nTotal ${summa}`,
      );
      expect(luettu.ok).toBe(true);
      if (!luettu.ok) return;
      const alku = tyhja();
      const t = kuittiTaytto(luettu.kuitti, alku, optiot());
      expect(t?.tila.rows).toBe(alku.rows);
      expect(t?.tila.selite).toBe('Example Inc');
      expect(t?.tila.paiva).toBe('2026-07-15');
      expect(t?.kuvaus).toBe('pvm, myyjä');
    },
  );

  it('täyttää tekstistä luetun eurokuitin summan', () => {
    const luettu = poimiKuittiTekstista('Kioski Oy\nYhteensä EUR 20,00');
    expect(luettu.ok).toBe(true);
    if (!luettu.ok) return;
    const t = kuittiTaytto(luettu.kuitti, tyhja(), optiot());
    expect(t?.tila.rows).toEqual([
      expect.objectContaining({ tili: 4000, debetSnt: 2000 }),
      expect.objectContaining({ tili: 1900, kreditSnt: 2000 }),
    ]);
  });

  it('täyttää tyhjän lomakkeen: päivä, otsikko ja meno-, alv- ja pankkirivit', () => {
    const t = kuittiTaytto(kuitti(), tyhja(), optiot());
    expect(t?.kuvaus).toBe('pvm, myyjä, summa');
    expect(t?.tila.paiva).toBe('2026-07-15');
    expect(t?.tila.selite).toBe('Kahvila Aamu Oy');
    expect(t?.tila.rows).toEqual([
      expect.objectContaining({
        tili: 4000,
        debetSnt: 1255,
        alvKoodi: AlvKoodi.OSTOT_NETTO,
        alvProsentti: 25.5,
        bruttoSyotto: true,
      }),
      expect.objectContaining({ tili: 1900, kreditSnt: 1255, alvKoodi: AlvKoodi.EIALV }),
    ]);
  });

  it('säilyttää käyttäjän kirjoittaman otsikon ja muuttaman päivän', () => {
    const nyk = { ...tyhja(), paiva: '2026-07-01', selite: 'Oma otsikko' };
    const t = kuittiTaytto(kuitti(), nyk, optiot());
    expect(t?.tila.paiva).toBe('2026-07-01');
    expect(t?.tila.selite).toBe('Oma otsikko');
    expect(t?.kuvaus).toBe('summa');
  });

  it('ei koske riveihin, jos yhdelläkin rivillä on tili tai summa', () => {
    const nyk = {
      ...tyhja(),
      rows: [
        uusiRivi({
          tili: 7800,
          debetSnt: Euro.fromCents(0),
          kreditSnt: Euro.fromCents(0),
          alvKoodi: 0,
          alvProsentti: 0,
          bruttoSyotto: true,
        }),
      ],
    };
    const t = kuittiTaytto(kuitti(), nyk, optiot());
    expect(t?.tila.rows).toBe(nyk.rows);
    expect(t?.kuvaus).toBe('pvm, myyjä');
  });

  it('ei koske riviin, johon on kirjoitettu vain rivin selite', () => {
    const nyk = {
      ...tyhja(),
      rows: [
        uusiRivi({
          selite: 'oma',
          debetSnt: Euro.fromCents(0),
          kreditSnt: Euro.fromCents(0),
          alvKoodi: 0,
          alvProsentti: 0,
          bruttoSyotto: true,
        }),
      ],
    };
    const t = kuittiTaytto(kuitti(), nyk, optiot());
    expect(t?.tila.rows).toBe(nyk.rows);
    expect(t?.kuvaus).toBe('pvm, myyjä');
  });

  it('ei koske riviin, jolle on valittu vain kohdennus ja merkkaus', () => {
    const nyk = {
      ...tyhja(),
      rows: [
        uusiRivi({
          debetSnt: Euro.fromCents(0),
          kreditSnt: Euro.fromCents(0),
          alvKoodi: 0,
          alvProsentti: 0,
          bruttoSyotto: true,
          kohdennus: 1,
          merkkaukset: [3],
        }),
      ],
    };
    const t = kuittiTaytto(kuitti(), nyk, optiot());
    expect(t?.tila.rows).toBe(nyk.rows);
    expect(t?.kuvaus).toBe('pvm, myyjä');
  });

  it('ei koske riveihin, kun käyttäjä kirjoittaa niihin parhaillaan', () => {
    const alku = tyhja();
    const t = kuittiTaytto(kuitti(), alku, optiot({ rivitKaytossa: true }));
    expect(t?.tila.rows).toBe(alku.rows);
    expect(t?.kuvaus).toBe('pvm, myyjä');
  });

  it('ei täytä rivejä ilman loppusummaa', () => {
    const { bruttoSumma: _pois, ...ilman } = kuitti();
    const t = kuittiTaytto(ilman, tyhja(), optiot());
    expect(t?.kuvaus).toBe('pvm, myyjä');
    expect(t?.tila.rows).toHaveLength(1);
    expect(t?.tila.rows[0]?.tili).toBeUndefined();
    expect(t?.tila.rows[0]?.debetSnt).toBe(0);
  });

  it('jättää päivän ennalleen, jos kuitin päivä ei osu avoimelle tilikaudelle', () => {
    const t = kuittiTaytto(kuitti({ pvm: '2025-12-30' }), tyhja(), optiot());
    expect(t?.tila.paiva).toBe(OLETUS);
    expect(t?.kuvaus).toBe('myyjä, summa');
  });

  it('kirjaa alv:ttomassa kirjassa koko summan yhtenä verottomana menona', () => {
    const t = kuittiTaytto(kuitti(), tyhja(), optiot({ alvVelvollinen: () => false }));
    expect(t?.tila.rows).toEqual([
      expect.objectContaining({ tili: 4000, debetSnt: 1255, alvKoodi: AlvKoodi.EIALV }),
      expect.objectContaining({ tili: 1900, kreditSnt: 1255, alvKoodi: AlvKoodi.EIALV }),
    ]);
  });

  it('palauttaa null, kun mitään ei voi täyttää', () => {
    const nyk = {
      ...tyhja(),
      paiva: '2026-07-01',
      selite: 'x',
      rows: [
        uusiRivi({
          tili: 4000,
          debetSnt: Euro.fromCents(100),
          kreditSnt: Euro.fromCents(0),
          alvKoodi: 0,
          alvProsentti: 0,
          bruttoSyotto: true,
        }),
      ],
    };
    expect(kuittiTaytto(kuitti(), nyk, optiot())).toBeNull();
  });

  it('täyttää muulle kuin menotositteelle vain päivän ja myyjän', () => {
    for (const tyyppi of [TositeTyyppi.TULO, TositeTyyppi.MUU]) {
      const alku = { ...tyhja(), tyyppi };
      const t = kuittiTaytto(kuitti(), alku, optiot());
      expect(t?.tila.rows).toBe(alku.rows);
      expect(t?.kuvaus).toBe('pvm, myyjä');
    }
  });

  it('ei kaadu, jos kartasta puuttuu pankkitili — jättää rivit tyhjiksi ja kirjaa virheen', () => {
    const varoitus = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = kuittiTaytto(
      kuitti(),
      tyhja(),
      optiot({ chart: CHART.filter((t) => t.numero !== 1900), asetukset: { menotili: 4000 } }),
    );
    expect(t?.kuvaus).toBe('pvm, myyjä');
    expect(varoitus).toHaveBeenCalledOnce();
    expect(varoitus.mock.calls[0]?.join(' ')).not.toContain('Kahvila');
  });
});
