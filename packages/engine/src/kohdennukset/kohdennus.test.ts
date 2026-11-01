import { describe, expect, it } from 'vitest';
import { ResourceError } from '../resources/storage.js';
import {
  type Kohdennus,
  KohdennusTyyppi,
  type UusiKohdennus,
  YLEINEN_ID,
  kohdennuksenNimi,
  kohdennuksenPolku,
  kohdennusSuodatin,
  normalisoiKohdennus,
  normalisoiMerkkaukset,
  onVoimassa,
  onVoimassaValilla,
  validoiKohdennus,
} from './kohdennus.js';

const { KUSTANNUSPAIKKA, PROJEKTI, MERKKAUS } = KohdennusTyyppi;

// Yhdistyksen kohdennukset: kaksi kustannuspaikkaa, niiden alla projekteja, yksi projekti
// Yleisen alla, yksi projekti tuntemattoman vanhemman alla ja merkkaus.
const KAIKKI: Kohdennus[] = [
  { id: 1, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta', sv: 'Ungdom' } },
  { id: 2, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerhotalo' } },
  { id: 4, tyyppi: PROJEKTI, kuuluu: 1, nimi: { fi: 'Kesäleiri' } },
  { id: 5, tyyppi: PROJEKTI, kuuluu: 1, nimi: { fi: 'Junioriturnaus' } },
  { id: 6, tyyppi: PROJEKTI, nimi: { fi: 'Arpajaiset' } },
  { id: 8, tyyppi: PROJEKTI, kuuluu: 99, nimi: { fi: 'Orpo' } },
  { id: 7, tyyppi: MERKKAUS, nimi: { fi: 'Avustus' } },
];
const hae = (id: number): Kohdennus => {
  const k = KAIKKI.find((x) => x.id === id);
  if (!k) throw new Error(`ei kohdennusta ${id}`);
  return k;
};

function virhekoodi(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    if (e instanceof ResourceError) return e.code;
    throw e;
  }
  return undefined;
}

describe('kohdennuksenNimi', () => {
  it('käyttää pyydettyä kieltä, muuten suomea, muuten tyhjää', () => {
    expect(kohdennuksenNimi(hae(1))).toBe('Nuorisotoiminta');
    expect(kohdennuksenNimi(hae(1), 'sv')).toBe('Ungdom');
    expect(kohdennuksenNimi(hae(1), 'en')).toBe('Nuorisotoiminta');
    expect(kohdennuksenNimi({ id: 9, tyyppi: MERKKAUS, nimi: {} })).toBe('');
  });
});

describe('kohdennuksenPolku', () => {
  it('projekti kustannuspaikan alla: "Kustannuspaikka/Projekti"', () => {
    expect(kohdennuksenPolku(hae(4), KAIKKI)).toBe('Nuorisotoiminta/Kesäleiri');
  });
  it('projekti Yleisen tai tuntemattoman vanhemman alla: pelkkä nimi', () => {
    const { kuuluu: _k, ...yleisenAlla } = hae(4);
    expect(kohdennuksenPolku(yleisenAlla, KAIKKI)).toBe('Kesäleiri');
    expect(kohdennuksenPolku(hae(6), KAIKKI)).toBe('Arpajaiset');
    expect(kohdennuksenPolku(hae(8), KAIKKI)).toBe('Orpo');
  });
  it('kustannuspaikka ja merkkaus: pelkkä nimi', () => {
    expect(kohdennuksenPolku(hae(1), KAIKKI)).toBe('Nuorisotoiminta');
    expect(kohdennuksenPolku(hae(7), KAIKKI)).toBe('Avustus');
  });
});

describe('onVoimassa', () => {
  const k: Kohdennus = {
    id: 1,
    tyyppi: KUSTANNUSPAIKKA,
    nimi: { fi: 'K' },
    alkaa: '2026-01-01',
    paattyy: '2026-12-31',
  };
  it('rajat ovat mukana', () => {
    expect(onVoimassa(k, '2026-01-01')).toBe(true);
    expect(onVoimassa(k, '2026-12-31')).toBe(true);
    expect(onVoimassa(k, '2025-12-31')).toBe(false);
    expect(onVoimassa(k, '2027-01-01')).toBe(false);
  });
  it('puuttuva raja on avoin', () => {
    const { alkaa: _a, ...vainLoppu } = k;
    const { paattyy: _p, ...vainAlku } = k;
    expect(onVoimassa(vainLoppu, '1999-01-01')).toBe(true);
    expect(onVoimassa(vainLoppu, '2027-01-01')).toBe(false);
    expect(onVoimassa(vainAlku, '2099-01-01')).toBe(true);
    expect(onVoimassa(vainAlku, '2025-12-31')).toBe(false);
    expect(onVoimassa(hae(2), '2026-06-01')).toBe(true);
  });
});

describe('onVoimassaValilla', () => {
  const k: Kohdennus = {
    id: 1,
    tyyppi: KUSTANNUSPAIKKA,
    nimi: { fi: 'K' },
    alkaa: '2026-03-01',
    paattyy: '2026-05-31',
  };
  it('yksikin yhteinen päivä riittää', () => {
    expect(onVoimassaValilla(k, '2026-05-31', '2026-12-31')).toBe(true);
    expect(onVoimassaValilla(k, '2026-01-01', '2026-03-01')).toBe(true);
    expect(onVoimassaValilla(k, '2026-04-01', '2026-04-30')).toBe(true);
  });
  it('erilliset välit eivät mene päällekkäin', () => {
    expect(onVoimassaValilla(k, '2026-06-01', '2026-12-31')).toBe(false);
    expect(onVoimassaValilla(k, '2026-01-01', '2026-02-28')).toBe(false);
  });
  it('avoin raja', () => {
    expect(onVoimassaValilla(hae(1), '2000-01-01', '2000-12-31')).toBe(true);
  });
});

describe('normalisoiMerkkaukset', () => {
  it('järjestää, poistaa toistot ja ei-positiiviset; tyhjä => undefined', () => {
    expect(normalisoiMerkkaukset([3, 1, 3])).toEqual([1, 3]);
    expect(normalisoiMerkkaukset([0, -2, 5])).toEqual([5]);
    expect(normalisoiMerkkaukset([10, 9])).toEqual([9, 10]); // numeerinen, ei merkkijonojärjestys
    expect(normalisoiMerkkaukset([])).toBeUndefined();
    expect(normalisoiMerkkaukset([0])).toBeUndefined();
    expect(normalisoiMerkkaukset(undefined)).toBeUndefined();
  });
  it('ei muuta syötettä', () => {
    const m = [3, 1];
    normalisoiMerkkaukset(m);
    expect(m).toEqual([3, 1]);
  });
});

describe('normalisoiKohdennus', () => {
  it('trimmaa nimen ja pudottaa kuuluu-kentän muilta kuin projekteilta', () => {
    const n = normalisoiKohdennus({
      tyyppi: KUSTANNUSPAIKKA,
      kuuluu: 2,
      nimi: { fi: '  Kerho  ', sv: ' Klubb ' },
      x: 1,
    });
    expect(n).toEqual({ tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerho', sv: ' Klubb ' }, x: 1 });
    expect('kuuluu' in n).toBe(false);
  });
  it('projektin kuuluu 0 => puuttuu; muu kuuluu säilyy', () => {
    const n = normalisoiKohdennus({ tyyppi: PROJEKTI, kuuluu: 0, nimi: { fi: 'P' } });
    expect('kuuluu' in n).toBe(false);
    expect(normalisoiKohdennus({ tyyppi: PROJEKTI, kuuluu: 1, nimi: { fi: 'P' } }).kuuluu).toBe(1);
  });
  it('pudottaa johdetun lkm-kentän', () => {
    const n = normalisoiKohdennus({ id: 3, tyyppi: MERKKAUS, nimi: { fi: 'M' }, lkm: 12 });
    expect('lkm' in n).toBe(false);
    expect(n).toEqual({ id: 3, tyyppi: MERKKAUS, nimi: { fi: 'M' } });
  });
  it('tyhjä päivämäärä => puuttuu', () => {
    const n = normalisoiKohdennus({
      tyyppi: MERKKAUS,
      nimi: { fi: 'M' },
      alkaa: '',
      paattyy: '2026-12-31',
    });
    expect('alkaa' in n).toBe(false);
    expect(n.paattyy).toBe('2026-12-31');
  });
  it('ei muuta syötettä', () => {
    const syote: UusiKohdennus = { tyyppi: MERKKAUS, kuuluu: 1, nimi: { fi: ' M ' } };
    normalisoiKohdennus(syote);
    expect(syote).toEqual({ tyyppi: MERKKAUS, kuuluu: 1, nimi: { fi: ' M ' } });
  });
});

describe('validoiKohdennus', () => {
  it('hyväksyy kelvolliset', () => {
    expect(
      virhekoodi(() => validoiKohdennus({ tyyppi: MERKKAUS, nimi: { fi: 'M' } }, KAIKKI)),
    ).toBe(undefined);
    expect(
      virhekoodi(() =>
        validoiKohdennus({ tyyppi: PROJEKTI, kuuluu: 2, nimi: { fi: 'P' } }, KAIKKI),
      ),
    ).toBe(undefined);
    expect(
      virhekoodi(() => validoiKohdennus({ tyyppi: PROJEKTI, nimi: { fi: 'P' } }, KAIKKI)),
    ).toBe(undefined);
    expect(
      virhekoodi(() =>
        validoiKohdennus(
          { tyyppi: MERKKAUS, nimi: { fi: 'M' }, alkaa: '2026-01-01', paattyy: '2026-01-01' },
          KAIKKI,
        ),
      ),
    ).toBe(undefined);
  });
  it('KOHDENNUSNIMI: tyhjä suomenkielinen nimi', () => {
    expect(
      virhekoodi(() => validoiKohdennus({ tyyppi: MERKKAUS, nimi: { fi: '  ' } }, KAIKKI)),
    ).toBe('KOHDENNUSNIMI');
    expect(
      virhekoodi(() => validoiKohdennus({ tyyppi: MERKKAUS, nimi: { sv: 'M' } }, KAIKKI)),
    ).toBe('KOHDENNUSNIMI');
  });
  it('KOHDENNUSTYYPPI: tyyppi ei 1–3', () => {
    for (const tyyppi of [0, 4, 1.5]) {
      expect(
        virhekoodi(() =>
          validoiKohdennus({ tyyppi: tyyppi as 1, nimi: { fi: 'K' } } as UusiKohdennus, KAIKKI),
        ),
      ).toBe('KOHDENNUSTYYPPI');
    }
  });
  it('KOHDENNUSPVM: päättyy ennen alkua tai virheellinen päivämäärä', () => {
    expect(
      virhekoodi(() =>
        validoiKohdennus(
          { tyyppi: MERKKAUS, nimi: { fi: 'M' }, alkaa: '2026-02-01', paattyy: '2026-01-31' },
          KAIKKI,
        ),
      ),
    ).toBe('KOHDENNUSPVM');
    expect(
      virhekoodi(() =>
        validoiKohdennus({ tyyppi: MERKKAUS, nimi: { fi: 'M' }, alkaa: '2026-02-30' }, KAIKKI),
      ),
    ).toBe('KOHDENNUSPVM');
  });
  it('KOHDENNUSKUULUU: projektin vanhempi ei ole tallennettu kustannuspaikka', () => {
    for (const kuuluu of [99, 4, 7]) {
      expect(
        virhekoodi(() => validoiKohdennus({ tyyppi: PROJEKTI, kuuluu, nimi: { fi: 'P' } }, KAIKKI)),
      ).toBe('KOHDENNUSKUULUU');
    }
  });
});

describe('validoiKohdennus: id, tyypin vaihto ja oma vanhempi', () => {
  it('KOHDENNUSID: annettu id ei ole kokonaisluku ≥ 1', () => {
    for (const id of [0, -1, 1.5, Number.NaN]) {
      expect(
        virhekoodi(() => validoiKohdennus({ id, tyyppi: MERKKAUS, nimi: { fi: 'M' } }, KAIKKI)),
      ).toBe('KOHDENNUSID');
    }
    expect(
      virhekoodi(() => validoiKohdennus({ id: 42, tyyppi: MERKKAUS, nimi: { fi: 'M' } }, KAIKKI)),
    ).toBe(undefined);
  });
  it('KOHDENNUSTYYPPI: projekteja omaavan kustannuspaikan tyyppiä ei voi vaihtaa', () => {
    for (const tyyppi of [PROJEKTI, MERKKAUS]) {
      expect(virhekoodi(() => validoiKohdennus({ id: 1, tyyppi, nimi: { fi: 'N' } }, KAIKKI))).toBe(
        'KOHDENNUSTYYPPI',
      );
    }
    // Projektiton kustannuspaikka saa vaihtaa tyyppiä; projektillinen saa pysyä kustannuspaikkana.
    expect(
      virhekoodi(() => validoiKohdennus({ id: 2, tyyppi: MERKKAUS, nimi: { fi: 'K' } }, KAIKKI)),
    ).toBe(undefined);
    expect(
      virhekoodi(() =>
        validoiKohdennus({ id: 1, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'N' } }, KAIKKI),
      ),
    ).toBe(undefined);
  });
  it('KOHDENNUSKUULUU: projekti ei voi kuulua itseensä', () => {
    // Kustannuspaikka 2 muutetaan projektiksi, jonka vanhempi olisi se itse.
    expect(
      virhekoodi(() =>
        validoiKohdennus({ id: 2, tyyppi: PROJEKTI, kuuluu: 2, nimi: { fi: 'K' } }, KAIKKI),
      ),
    ).toBe('KOHDENNUSKUULUU');
  });
});

describe('kohdennusSuodatin', () => {
  it('kustannuspaikka => se ja sen projektit', () => {
    expect(kohdennusSuodatin(KAIKKI, 1)).toEqual({ kohdennukset: [1, 4, 5] });
    expect(kohdennusSuodatin(KAIKKI, 2)).toEqual({ kohdennukset: [2] });
  });
  it('Yleinen => kohdentamattomat ja Yleisen alla olevat projektit (myös orvot)', () => {
    expect(kohdennusSuodatin(KAIKKI, YLEINEN_ID)).toEqual({ kohdennukset: [0, 6, 8] });
  });
  it('projekti => vain se', () => {
    expect(kohdennusSuodatin(KAIKKI, 4)).toEqual({ kohdennukset: [4] });
  });
  it('merkkaus => merkkaussuodatin', () => {
    expect(kohdennusSuodatin(KAIKKI, 7)).toEqual({ merkkaus: 7 });
  });
  it('tuntematon id => vain se', () => {
    expect(kohdennusSuodatin(KAIKKI, 42)).toEqual({ kohdennukset: [42] });
  });
});
