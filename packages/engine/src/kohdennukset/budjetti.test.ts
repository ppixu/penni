import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { type Tili, lataaKartta } from '../accounts/tili.js';
import { ResourceError } from '../resources/storage.js';
import {
  type BudjettiRivi,
  budjettiKohdennukselle,
  erotteleBudjetoitavat,
  luonnollinenEtumerkki,
  toteumaProsentti,
  validoiBudjetti,
} from './budjetti.js';
import { type Kohdennus, KohdennusTyyppi } from './kohdennus.js';

const c = (n: number): Cents => n as Cents;

const KARTTA: Tili[] = lataaKartta([
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } },
  { numero: 3, tyyppi: 'H1', nimi: { fi: 'Tuotot' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 3500, tyyppi: 'CZ', nimi: { fi: 'Avustukset' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
  { numero: 4, tyyppi: 'H1', nimi: { fi: 'Kulut-otsikko' } },
]);
const tili = (numero: number): Tili | undefined =>
  KARTTA.find((t) => t.numero === numero && t.otsikkotaso === 0);

const KOHDENNUKSET: Kohdennus[] = [
  { id: 1, tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta' } },
  { id: 4, tyyppi: KohdennusTyyppi.PROJEKTI, kuuluu: 1, nimi: { fi: 'Kesäleiri' } },
  { id: 6, tyyppi: KohdennusTyyppi.PROJEKTI, nimi: { fi: 'Arpajaiset' } },
  { id: 7, tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Avustus' } },
];

function virhekoodi(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    if (e instanceof ResourceError) return e.code;
    throw e;
  }
  return undefined;
}

describe('luonnollinenEtumerkki', () => {
  it('tulotili säilyttää etumerkin, menotili kääntää', () => {
    expect(luonnollinenEtumerkki(tili(3000), c(1500))).toBe(1500);
    expect(luonnollinenEtumerkki(tili(3500), c(-200))).toBe(-200);
    expect(luonnollinenEtumerkki(tili(4000), c(-1500))).toBe(1500);
    expect(luonnollinenEtumerkki(tili(4000), c(300))).toBe(-300);
  });
  it('tuntematon tili käsitellään menona; nolla ei muutu −0:ksi', () => {
    expect(luonnollinenEtumerkki(undefined, c(-100))).toBe(100);
    expect(luonnollinenEtumerkki(tili(4000), c(0))).toBe(0);
    expect(Object.is(luonnollinenEtumerkki(tili(4000), c(0)), 0)).toBe(true);
  });
  it('on oma käänteisfunktionsa', () => {
    for (const n of [-12345, 0, 1, 99999]) {
      expect(luonnollinenEtumerkki(tili(4000), luonnollinenEtumerkki(tili(4000), c(n)))).toBe(n);
    }
  });
});

describe('toteumaProsentti', () => {
  it('sadasosaprosentteina, puolikkaat nollasta poispäin', () => {
    expect(toteumaProsentti(c(-1200), c(-1000))).toBe(12000);
    expect(toteumaProsentti(c(1), c(3))).toBe(3333);
    expect(toteumaProsentti(c(2), c(3))).toBe(6667);
    expect(toteumaProsentti(c(-2), c(3))).toBe(-6667);
    expect(toteumaProsentti(c(1), c(20000))).toBe(1); // 0,5 => 1
    expect(toteumaProsentti(c(-1), c(20000))).toBe(-1); // −0,5 => −1
    expect(toteumaProsentti(c(0), c(500))).toBe(0);
  });
  it('budjetti 0 => undefined', () => {
    expect(toteumaProsentti(c(1234), c(0))).toBeUndefined();
    expect(toteumaProsentti(c(0), c(0))).toBeUndefined();
  });
  it('suuret summat pysyvät tarkkoina kokonaislukuina', () => {
    // 900 000 000,01 € / 300 000 000,00 € = 300,0000000033 % => 30000
    expect(toteumaProsentti(c(90_000_000_001), c(30_000_000_000))).toBe(30000);
  });
});

describe('validoiBudjetti', () => {
  const ok: BudjettiRivi[] = [
    { kohdennus: 0, tili: 3000, sentit: c(100000) },
    { kohdennus: 1, tili: 3000, sentit: c(5000) },
    { kohdennus: 4, tili: 4000, sentit: c(-2000) },
    { kohdennus: 6, tili: 3500, sentit: c(700) },
  ];
  it('hyväksyy tulostilit ja kustannuspaikat/projektit/Yleisen', () => {
    expect(virhekoodi(() => validoiBudjetti(ok, KARTTA, KOHDENNUKSET))).toBeUndefined();
    expect(virhekoodi(() => validoiBudjetti([], KARTTA, KOHDENNUKSET))).toBeUndefined();
  });
  it('BUDJETTITILI: tasetili, otsikko tai tuntematon tili', () => {
    for (const t of [1900, 2939, 3, 4, 9999]) {
      expect(
        virhekoodi(() =>
          validoiBudjetti([{ kohdennus: 0, tili: t, sentit: c(1) }], KARTTA, KOHDENNUKSET),
        ),
      ).toBe('BUDJETTITILI');
    }
  });
  it('BUDJETTIKOHDENNUS: merkkaus tai tuntematon kohdennus', () => {
    for (const k of [7, 42]) {
      expect(
        virhekoodi(() =>
          validoiBudjetti([{ kohdennus: k, tili: 3000, sentit: c(1) }], KARTTA, KOHDENNUKSET),
        ),
      ).toBe('BUDJETTIKOHDENNUS');
    }
  });
  it('BUDJETTIDUPLIKAATTI: sama kohdennus ja tili kahdesti', () => {
    expect(
      virhekoodi(() =>
        validoiBudjetti([...ok, { kohdennus: 1, tili: 3000, sentit: c(1) }], KARTTA, KOHDENNUKSET),
      ),
    ).toBe('BUDJETTIDUPLIKAATTI');
  });
});

describe('erotteleBudjetoitavat', () => {
  it('pudottaa rivit, jotka validoiBudjetti hylkäisi, ja säilyttää loput järjestyksessään', () => {
    const rivit: BudjettiRivi[] = [
      { kohdennus: 0, tili: 3000, sentit: c(100) },
      { kohdennus: 7, tili: 3000, sentit: c(1) }, // merkkaus
      { kohdennus: 0, tili: 9999, sentit: c(2) }, // poistettu tili
      { kohdennus: 4, tili: 4000, sentit: c(-3) },
      { kohdennus: 0, tili: 3000, sentit: c(4) }, // duplikaatti
      { kohdennus: 42, tili: 4000, sentit: c(5) }, // tuntematon kohdennus
    ];
    const { kelpaavat, hylatyt } = erotteleBudjetoitavat(rivit, KARTTA, KOHDENNUKSET);
    expect(kelpaavat).toEqual([rivit[0], rivit[3]]);
    expect(hylatyt).toEqual([rivit[1], rivit[2], rivit[4], rivit[5]]);
    expect(virhekoodi(() => validoiBudjetti(kelpaavat, KARTTA, KOHDENNUKSET))).toBeUndefined();
  });
});

describe('budjettiKohdennukselle', () => {
  const rivit: BudjettiRivi[] = [
    { kohdennus: 0, tili: 3000, sentit: c(100000) },
    { kohdennus: 1, tili: 3000, sentit: c(5000) },
    { kohdennus: 1, tili: 4000, sentit: c(-1000) },
    { kohdennus: 4, tili: 4000, sentit: c(-2000) },
    { kohdennus: 6, tili: 4000, sentit: c(-300) },
  ];
  it('kustannuspaikka sisältää projektinsa', () => {
    expect(budjettiKohdennukselle(rivit, KOHDENNUKSET, 1)).toEqual(
      new Map([
        [3000, 5000],
        [4000, -3000],
      ]),
    );
  });
  it('projekti vain itsensä', () => {
    expect(budjettiKohdennukselle(rivit, KOHDENNUKSET, 4)).toEqual(new Map([[4000, -2000]]));
  });
  it('Yleinen sisältää Yleisen alla olevat projektit', () => {
    expect(budjettiKohdennukselle(rivit, KOHDENNUKSET, 0)).toEqual(
      new Map([
        [3000, 100000],
        [4000, -300],
      ]),
    );
  });
  it('undefined summaa kaikki rivit', () => {
    expect(budjettiKohdennukselle(rivit, KOHDENNUKSET)).toEqual(
      new Map([
        [3000, 105000],
        [4000, -3300],
      ]),
    );
  });
  it('merkkauksella ei ole budjettia', () => {
    expect(budjettiKohdennukselle(rivit, KOHDENNUKSET, 7)).toEqual(new Map());
  });
});
