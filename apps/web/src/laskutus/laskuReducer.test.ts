import { AlvKoodi, Maksutapa } from '@penni/engine';
import type { StoredTosite } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  MYYNTIKOODIT,
  alustaLaskuTila,
  alustaLaskuTilaLuonnoksesta,
  laskuReducer,
  lisaaPaivia,
} from './laskuReducer.js';

describe('alustaLaskuTila', () => {
  it('oletusarvot: erapvm = laskupvm + 14 pv, maksutapa LASKU, yksi rivi', () => {
    const tila = alustaLaskuTila({ laskupvm: '2026-06-01', alvVelvollinen: true });
    expect(tila.laskupvm).toBe('2026-06-01');
    expect(tila.erapvm).toBe('2026-06-15');
    expect(tila.maksutapa).toBe(Maksutapa.LASKU);
    expect(tila.kumppani).toBeUndefined();
    expect(tila.otsikko).toBe('');
    expect(tila.rivit).toHaveLength(1);
    expect(tila.rivit[0]?.myyntiKpl).toBe(1);
    expect(tila.rivit[0]?.aNettoSnt).toBe(Euro.fromCents(0));
  });

  it('alv-velvollisen rivioletus on MYYNNIT_NETTO ja päivän yleiskanta', () => {
    const tila = alustaLaskuTila({ laskupvm: '2026-06-01', alvVelvollinen: true });
    expect(tila.rivit[0]?.alvKoodi).toBe(AlvKoodi.MYYNNIT_NETTO);
    expect(tila.rivit[0]?.alvProsentti).toBe(25.5);
  });

  it('ennen 1.9.2024 yleiskanta on 24 %', () => {
    const tila = alustaLaskuTila({ laskupvm: '2024-06-01', alvVelvollinen: true });
    expect(tila.rivit[0]?.alvProsentti).toBe(24);
  });

  it('ei-alv-velvollisen rivioletus on EIALV ja 0 %', () => {
    const tila = alustaLaskuTila({ laskupvm: '2026-06-01', alvVelvollinen: false });
    expect(tila.rivit[0]?.alvKoodi).toBe(AlvKoodi.EIALV);
    expect(tila.rivit[0]?.alvProsentti).toBe(0);
  });

  it('erapvm-oletus menee kuukauden ja vuoden vaihteen yli oikein', () => {
    expect(lisaaPaivia('2026-12-28', 14)).toBe('2027-01-11');
  });
});

describe('laskuReducer — rivioperaatiot ja kentät', () => {
  const pohja = () => alustaLaskuTila({ laskupvm: '2026-06-01', alvVelvollinen: true });

  it('lisaaRivi lisää rivin lomakkeen alv-oletuksilla ja uniikilla avaimella', () => {
    const tila = laskuReducer(pohja(), { type: 'lisaaRivi' });
    expect(tila.rivit).toHaveLength(2);
    expect(tila.rivit[1]?.alvKoodi).toBe(AlvKoodi.MYYNNIT_NETTO);
    expect(tila.rivit[1]?.alvProsentti).toBe(25.5);
    expect(tila.rivit[1]?.avain).not.toBe(tila.rivit[0]?.avain);
  });

  it('setRivi päivittää vain osoitetun rivin', () => {
    let tila = laskuReducer(pohja(), { type: 'lisaaRivi' });
    const avain = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain,
      muutos: { selite: 'Konsultointi', aNettoSnt: Euro.fromCents(1210) },
    });
    expect(tila.rivit[0]?.selite).toBe('Konsultointi');
    expect(tila.rivit[0]?.aNettoSnt).toBe(Euro.fromCents(1210));
    expect(tila.rivit[1]?.selite).toBe('');
  });

  it('poistaRivi poistaa rivin mutta jättää aina vähintään yhden tyhjän rivin', () => {
    let tila = laskuReducer(pohja(), { type: 'lisaaRivi' });
    const eka = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, { type: 'poistaRivi', avain: eka });
    expect(tila.rivit).toHaveLength(1);
    // Viimeisen rivin poisto: tilalle tulee tyhjä oletusrivi (lattia 1, kuten editorissa).
    const viimeinen = tila.rivit[0]?.avain ?? 0;
    tila = laskuReducer(tila, {
      type: 'setRivi',
      avain: viimeinen,
      muutos: { aNettoSnt: Euro.fromCents(500) },
    });
    tila = laskuReducer(tila, { type: 'poistaRivi', avain: viimeinen });
    expect(tila.rivit).toHaveLength(1);
    expect(tila.rivit[0]?.aNettoSnt).toBe(Euro.fromCents(0));
  });

  it('setKumppani asettaa ja tyhjentää asiakkaan', () => {
    let tila = laskuReducer(pohja(), { type: 'setKumppani', kumppani: 7 });
    expect(tila.kumppani).toBe(7);
    tila = laskuReducer(tila, { type: 'setKumppani', kumppani: undefined });
    expect(tila.kumppani).toBeUndefined();
  });

  it('setLaskupvm, setErapvm, setOtsikko ja setMaksutapa päivittävät kentät', () => {
    let tila = laskuReducer(pohja(), { type: 'setLaskupvm', pvm: '2026-06-05' });
    tila = laskuReducer(tila, { type: 'setErapvm', pvm: '2026-07-05' });
    tila = laskuReducer(tila, { type: 'setOtsikko', otsikko: 'Kesäkuun työt' });
    tila = laskuReducer(tila, { type: 'setMaksutapa', maksutapa: Maksutapa.KATEINEN });
    expect(tila.laskupvm).toBe('2026-06-05');
    expect(tila.erapvm).toBe('2026-07-05');
    expect(tila.otsikko).toBe('Kesäkuun työt');
    expect(tila.maksutapa).toBe(Maksutapa.KATEINEN);
  });

  it('MYYNTIKOODIT sisältää täsmälleen speksin myyntikoodit', () => {
    expect(MYYNTIKOODIT).toEqual([0, 11, 19, 14, 15]);
  });

  it('jakson päivät ovat oletuksena tyhjiä ja setJakso*-aktiot asettavat ne', () => {
    let tila = pohja();
    expect(tila.jaksoAlkaa).toBe('');
    expect(tila.jaksoLoppuu).toBe('');
    tila = laskuReducer(tila, { type: 'setJaksoAlkaa', pvm: '2026-05-01' });
    tila = laskuReducer(tila, { type: 'setJaksoLoppuu', pvm: '2026-05-31' });
    expect(tila.jaksoAlkaa).toBe('2026-05-01');
    expect(tila.jaksoLoppuu).toBe('2026-05-31');
  });
});

describe('alustaLaskuTilaLuonnoksesta', () => {
  const luonnos = {
    id: 7,
    tila: 80,
    tyyppi: 210,
    pvm: '2026-06-03',
    laskupvm: '2026-06-02',
    erapvm: '2026-06-20',
    kumppani: 4,
    otsikko: 'Kesäkuun työt',
    maksutapa: Maksutapa.LASKU,
    jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
    rivit: [
      { myyntiKpl: 2, aNetto: 12.1, alvKoodi: 11, alvProsentti: 25.5, selite: 'Työ', tili: 3010 },
    ],
  } as unknown as StoredTosite;

  it('lataa luonnoksen kentät lomaketilaan (laskupvm ensisijaisesti, hinta senteiksi)', () => {
    const tila = alustaLaskuTilaLuonnoksesta(luonnos, true);
    expect(tila.laskupvm).toBe('2026-06-02');
    expect(tila.erapvm).toBe('2026-06-20');
    expect(tila.kumppani).toBe(4);
    expect(tila.otsikko).toBe('Kesäkuun työt');
    expect(tila.jaksoAlkaa).toBe('2026-05-01');
    expect(tila.jaksoLoppuu).toBe('2026-05-31');
    expect(tila.rivit).toHaveLength(1);
    expect(tila.rivit[0]).toMatchObject({
      selite: 'Työ',
      myyntiKpl: 2,
      aNettoSnt: Euro.fromCents(1210),
      alvKoodi: 11,
      alvProsentti: 25.5,
    });
  });

  it('luonnoksen rivin lomakkeella näkymättömät kentät (tili) säilyvät', () => {
    const tila = alustaLaskuTilaLuonnoksesta(luonnos, true);
    expect(tila.rivit[0]?.lisat).toEqual({ tili: 3010 });
  });

  it('luonnos ilman rivejä saa yhden tyhjän rivin ja puuttuva laskupvm on pvm', () => {
    const tila = alustaLaskuTilaLuonnoksesta(
      { id: 8, tila: 80, tyyppi: 210, pvm: '2026-06-03', rivit: [] } as unknown as StoredTosite,
      false,
    );
    expect(tila.laskupvm).toBe('2026-06-03');
    expect(tila.rivit).toHaveLength(1);
    expect(tila.erapvm).toBe('');
  });
});
