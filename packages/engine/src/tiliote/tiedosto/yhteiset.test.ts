import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { IsoDate } from '../../vouchers/types.js';
import type { Tiliote } from '../poimiKuukausitiliote.js';
import type { Tilitapahtuma } from '../poimiTiliote.js';
import { TiliotetiedostoVirhe, dekoodaa, vvkkppIsoksi, yhdistaTiliotteet } from './yhteiset.js';

const e = (s: string): Cents => Euro.fromString(s);
const tap = (pvm: string, nimi: string, maara: string): Tilitapahtuma => ({
  pvm: pvm as IsoDate,
  nimi,
  maara: e(maara),
});

describe('dekoodaa', () => {
  it('lukee UTF-8:n', () => {
    expect(dekoodaa(new TextEncoder().encode('Määrä'))).toBe('Määrä');
  });

  it('poistaa UTF-8 BOM:n', () => {
    expect(dekoodaa(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });

  it('putoaa windows-1252:een, kun tavut eivät ole kelvollista UTF-8:aa', () => {
    expect(dekoodaa(new Uint8Array([0x4d, 0xe4, 0xe4, 0x72, 0xe4]))).toBe('Määrä');
    expect(dekoodaa(new Uint8Array([0x80]))).toBe('€');
  });
});

describe('vvkkppIsoksi', () => {
  it('muuntaa VVKKPP:n ISO-päiväksi', () => {
    expect(vvkkppIsoksi('261031')).toBe('2026-10-31');
  });

  it('hylkää mahdottoman päivän', () => {
    expect(() => vvkkppIsoksi('261301')).toThrow(TiliotetiedostoVirhe);
    try {
      vvkkppIsoksi('261301');
    } catch (err) {
      expect((err as TiliotetiedostoVirhe).koodi).toBe('VAARA_MUOTO');
    }
  });

  it('hylkää väärän pituuden ja ei-numerot', () => {
    expect(() => vvkkppIsoksi('2610')).toThrow(TiliotetiedostoVirhe);
    expect(() => vvkkppIsoksi('26AB31')).toThrow(TiliotetiedostoVirhe);
  });
});

describe('TiliotetiedostoVirhe', () => {
  it('liittää rivinumeron viestin loppuun', () => {
    const v = new TiliotetiedostoVirhe('VAARA_MUOTO', 'Virheellinen päivä', 7);
    expect(v.message).toBe('Virheellinen päivä (rivi 7)');
    expect(v.rivi).toBe(7);
    expect(v.koodi).toBe('VAARA_MUOTO');
  });
});

describe('yhdistaTiliotteet', () => {
  const ensimmainen: Tiliote = {
    muoto: 'kuukausitiliote',
    kausi: { alkaa: '2026-10-01' as IsoDate, loppuu: '2026-10-15' as IsoDate },
    alkusaldo: e('1000.00'),
    loppusaldo: e('900.00'),
    tapahtumat: [tap('2026-10-05', 'Testi Oy', '-100.00')],
  };
  const toinen: Tiliote = {
    muoto: 'kuukausitiliote',
    kausi: { alkaa: '2026-10-16' as IsoDate, loppuu: '2026-10-31' as IsoDate },
    alkusaldo: e('900.00'),
    loppusaldo: e('950.00'),
    tapahtumat: [tap('2026-10-20', 'Maija Malli', '100.00'), tap('2026-10-25', 'Kauppa', '-50.00')],
  };

  it('yhdistää käänteisessä järjestyksessä annetut tiliotteet aikajärjestykseen', () => {
    const t = yhdistaTiliotteet([toinen, ensimmainen]);
    expect(t.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-31' });
    expect(t.alkusaldo).toBe(100000);
    expect(t.loppusaldo).toBe(95000);
    expect(t.tapahtumat.map((x) => x.nimi)).toEqual(['Testi Oy', 'Maija Malli', 'Kauppa']);
    expect(t.muoto).toBe('kuukausitiliote');
  });

  it('hylkää saldojen epäjatkuvuuden ja nimeää molemmat päivät', () => {
    const rikki = { ...toinen, alkusaldo: e('890.00') };
    expect(() => yhdistaTiliotteet([ensimmainen, rikki])).toThrow(/15\.10\.2026.*16\.10\.2026/);
    expect(() => yhdistaTiliotteet([ensimmainen, rikki])).toThrow(TiliotetiedostoVirhe);
  });

  it('hylkää päällekkäiset kaudet', () => {
    const paallekkain: Tiliote = {
      ...toinen,
      kausi: { alkaa: '2026-10-15' as IsoDate, loppuu: '2026-10-31' as IsoDate },
    };
    expect(() => yhdistaTiliotteet([ensimmainen, paallekkain])).toThrow(TiliotetiedostoVirhe);
  });

  it('palauttaa yksittäisen tiliotteen sellaisenaan', () => {
    expect(yhdistaTiliotteet([ensimmainen])).toBe(ensimmainen);
  });

  it('ohittaa saldotarkistuksen, kun toinen saldoista puuttuu', () => {
    const { alkusaldo: _pois, ...ilmanSaldoa } = toinen;
    const t = yhdistaTiliotteet([ensimmainen, ilmanSaldoa]);
    expect(t.loppusaldo).toBe(95000);
  });
  const paatelty = (...tapahtumat: Tilitapahtuma[]): Tiliote => {
    const paivat = tapahtumat.map((t) => t.pvm).sort();
    return {
      muoto: 'tapahtumat',
      kausi: { alkaa: paivat[0] as IsoDate, loppuu: paivat[paivat.length - 1] as IsoDate },
      tapahtumat,
      lahde: 'camt054',
      kausiPaatelty: true,
    };
  };
  const tyhja: Tiliote = { muoto: 'tapahtumat', tapahtumat: [], lahde: 'camt054' };

  it('yhdistää päätellyt kaudet samalta päivältä ilman päällekkäisyysvirhettä', () => {
    const t = yhdistaTiliotteet([
      paatelty(tap('2026-10-05', 'Maija Malli', '10.00')),
      paatelty(tap('2026-10-05', 'Testi Oy', '20.00')),
    ]);
    expect(t.kausi).toEqual({ alkaa: '2026-10-05', loppuu: '2026-10-05' });
    expect(t.kausiPaatelty).toBe(true);
    expect(t.muoto).toBe('tapahtumat');
    expect(t.lahde).toBe('camt054');
    expect(t.tapahtumat.map((x) => x.nimi)).toEqual(['Maija Malli', 'Testi Oy']);
  });

  it('yhdistää päällekkäiset päätellyt kaudet ja järjestää tapahtumat vakaasti päivän mukaan', () => {
    const t = yhdistaTiliotteet([
      paatelty(tap('2026-10-09', 'A', '1.00'), tap('2026-10-14', 'B', '2.00')),
      paatelty(tap('2026-10-12', 'C', '3.00'), tap('2026-10-09', 'D', '4.00')),
    ]);
    expect(t.kausi).toEqual({ alkaa: '2026-10-09', loppuu: '2026-10-14' });
    expect(t.kausiPaatelty).toBe(true);
    expect(t.tapahtumat.map((x) => x.nimi)).toEqual(['A', 'D', 'C', 'B']);
  });

  it('ohittaa tyhjän osan, jolla ei ole kautta eikä tapahtumia', () => {
    expect(yhdistaTiliotteet([tyhja, ensimmainen])).toBe(ensimmainen);
    const t = yhdistaTiliotteet([ensimmainen, tyhja, toinen]);
    expect(t.kausi).toEqual({ alkaa: '2026-10-01', loppuu: '2026-10-31' });
    expect(t.muoto).toBe('kuukausitiliote');
  });

  it('palauttaa ensimmäisen osan, kun kaikki osat ovat tyhjiä', () => {
    expect(yhdistaTiliotteet([tyhja, { ...tyhja }])).toBe(tyhja);
  });

  it('nimeää tiliotteen, jolta kausi puuttuu, järjestysnumerolla', () => {
    const ilmanKautta: Tiliote = {
      muoto: 'tapahtumat',
      tapahtumat: [tap('2026-11-02', 'X', '1.00')],
    };
    expect(() => yhdistaTiliotteet([ensimmainen, ilmanKautta])).toThrow(
      'Tiedoston 2. tiliotteelta puuttuu kausi',
    );
  });

  it('päällekkäisyysvirhe nimeää molemmat päivät ilmoitetuilla kausilla', () => {
    const paallekkain: Tiliote = {
      ...toinen,
      kausi: { alkaa: '2026-10-15' as IsoDate, loppuu: '2026-10-31' as IsoDate },
    };
    expect(() => yhdistaTiliotteet([ensimmainen, paallekkain])).toThrow(
      'Tiliotteen kaudet menevät päällekkäin (15.10.2026 ja 15.10.2026)',
    );
  });
});
