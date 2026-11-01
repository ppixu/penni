import {
  type BudjettiRivi,
  type Kohdennus,
  KohdennusTyyppi,
  type TiliData,
  lataaKartta,
} from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  asetaBudjetti,
  budjettiVertailuun,
  budjettiYhteenveto,
  edellinenTilikausi,
  kopioiEdellinen,
  naytettavatTilit,
  oletusTilikausi,
  rakennaBudjettiTaulukko,
} from './budjettiTaulukko';

const c = (n: number) => n as Cents;

const KARTTA_DATA: TiliData[] = [
  { numero: 1, tyyppi: 'H1', nimi: { fi: 'VASTAAVAA' } },
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
  { numero: 3, tyyppi: 'H1', nimi: { fi: 'TULOSLASKELMA' } },
  { numero: 3, tyyppi: 'H2', nimi: { fi: 'Liikevaihto' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4, tyyppi: 'H2', nimi: { fi: 'Materiaalit' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  { numero: 7, tyyppi: 'H2', nimi: { fi: 'Tyhjä otsikko' } },
  { numero: 8, tyyppi: 'H2', nimi: { fi: 'Muut kulut' } },
  { numero: 8500, tyyppi: 'D', nimi: { fi: 'Pankkikulut' } },
];
const KARTTA = lataaKartta(KARTTA_DATA);

describe('rakennaBudjettiTaulukko', () => {
  it('tulostilit otsikoidensa alla; tyhjät otsikot ja tasetilit pois; luvut kohdennukselta', () => {
    const nykyinen: BudjettiRivi[] = [
      { kohdennus: 0, tili: 3000, sentit: c(123450) },
      { kohdennus: 2, tili: 3000, sentit: c(999) },
    ];
    const edellinen: BudjettiRivi[] = [{ kohdennus: 0, tili: 4000, sentit: c(-20000) }];
    const rivit = rakennaBudjettiTaulukko(KARTTA, nykyinen, edellinen, 0);
    expect(
      rivit.map((r) =>
        r.otsikko ? `# ${r.otsikko.taso} ${r.otsikko.teksti}` : `${r.tili?.numero}`,
      ),
    ).toEqual([
      '# 1 TULOSLASKELMA',
      '# 2 Liikevaihto',
      '3000',
      '# 2 Materiaalit',
      '4000',
      '# 2 Muut kulut',
      '8500',
    ]);
    expect(rivit.find((r) => r.tili?.numero === 3000)).toMatchObject({
      sentit: 123450,
      edellinen: 0,
    });
    expect(rivit.find((r) => r.tili?.numero === 4000)).toMatchObject({
      sentit: 0,
      edellinen: -20000,
    });
  });

  it('järjestää kartan Kitsaksen tilijärjestykseen syötteen järjestyksestä riippumatta', () => {
    const rivit = rakennaBudjettiTaulukko([...KARTTA].reverse(), [], [], 0);
    expect(rivit.filter((r) => r.tili).map((r) => r.tili?.numero)).toEqual([3000, 4000, 8500]);
    expect(rivit[0]?.otsikko?.teksti).toBe('TULOSLASKELMA');
  });
});

describe('naytettavatTilit', () => {
  it('piilottaa piilotetut lehtitilit, paitsi budjetoidut', () => {
    const tulos = naytettavatTilit(KARTTA, new Set([4000, 8500]), [
      { kohdennus: 3, tili: 8500, sentit: c(-100) },
    ]);
    expect(tulos.some((t) => t.numero === 4000)).toBe(false);
    expect(tulos.some((t) => t.numero === 8500)).toBe(true);
    expect(tulos.some((t) => t.numero === 4 && t.otsikkotaso === 2)).toBe(true);
  });
});

describe('budjettiYhteenveto', () => {
  it('tulot ja menot luonnollisessa suunnassa, tulos = Σ sentit', () => {
    expect(
      budjettiYhteenveto(
        [
          { kohdennus: 0, tili: 3000, sentit: c(123450) },
          { kohdennus: 0, tili: 4000, sentit: c(-20000) },
        ],
        KARTTA,
      ),
    ).toEqual({ tulot: 123450, menot: 20000, tulos: 103450 });
  });
});

describe('asetaBudjetti', () => {
  const pohja: BudjettiRivi[] = [{ kohdennus: 0, tili: 3000, sentit: c(100) }];

  it('lisää, korvaa ja poistaa nollalla vain annetun kohdennuksen rivin', () => {
    const lisatty = asetaBudjetti(pohja, 2, 3000, c(500));
    expect(lisatty).toEqual([
      { kohdennus: 0, tili: 3000, sentit: 100 },
      { kohdennus: 2, tili: 3000, sentit: 500 },
    ]);
    expect(asetaBudjetti(lisatty, 0, 3000, c(700))).toContainEqual({
      kohdennus: 0,
      tili: 3000,
      sentit: 700,
    });
    expect(asetaBudjetti(lisatty, 0, 3000, c(0))).toEqual([
      { kohdennus: 2, tili: 3000, sentit: 500 },
    ]);
    expect(pohja).toHaveLength(1);
  });
});

describe('budjettiVertailuun', () => {
  it('järjestys ei vaikuta vertailuun', () => {
    const a: BudjettiRivi[] = [
      { kohdennus: 2, tili: 3000, sentit: c(1) },
      { kohdennus: 0, tili: 4000, sentit: c(2) },
    ];
    expect(budjettiVertailuun(a)).toEqual(budjettiVertailuun([...a].reverse()));
  });
});

describe('kopioiEdellinen', () => {
  const kohdennukset: Kohdennus[] = [
    { id: 1, tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA, nimi: { fi: 'Nuoriso' } },
    {
      id: 2,
      tyyppi: KohdennusTyyppi.PROJEKTI,
      kuuluu: 1,
      nimi: { fi: 'Leiri 2025' },
      paattyy: '2025-08-31',
    },
    {
      id: 3,
      tyyppi: KohdennusTyyppi.PROJEKTI,
      nimi: { fi: 'Juhla' },
      paattyy: '2026-01-01',
    },
  ];

  it('ohittaa ennen uutta kautta päättyneen projektin; muut kohdennukset ja Yleinen säilyvät', () => {
    const edellinen: BudjettiRivi[] = [
      { kohdennus: 0, tili: 3000, sentit: c(100) },
      { kohdennus: 1, tili: 4000, sentit: c(-200) },
      { kohdennus: 2, tili: 4000, sentit: c(-300) },
      { kohdennus: 3, tili: 4000, sentit: c(-400) },
    ];
    expect(kopioiEdellinen(edellinen, kohdennukset, '2026-01-01')).toEqual([
      { kohdennus: 0, tili: 3000, sentit: 100 },
      { kohdennus: 1, tili: 4000, sentit: -200 },
      { kohdennus: 3, tili: 4000, sentit: -400 },
    ]);
  });
});

describe('oletusTilikausi ja edellinenTilikausi', () => {
  const kaudet = [
    { alkaa: '2024-07-01', loppuu: '2025-06-30' },
    { alkaa: '2025-07-01', loppuu: '2026-06-30' },
  ];

  it('kausi, jolla tänään on, muuten viimeisin', () => {
    expect(oletusTilikausi(kaudet, '2025-01-15')?.alkaa).toBe('2024-07-01');
    expect(oletusTilikausi(kaudet, '2027-01-01')?.alkaa).toBe('2025-07-01');
    expect(oletusTilikausi(kaudet, '2020-01-01')?.alkaa).toBe('2025-07-01');
    expect(oletusTilikausi([], '2026-01-01')).toBeUndefined();
  });

  it('edellinen päättyy kauden alkua edeltävänä päivänä; ensimmäisellä ei ole', () => {
    expect(edellinenTilikausi(kaudet, kaudet[1] as (typeof kaudet)[number])?.alkaa).toBe(
      '2024-07-01',
    );
    expect(edellinenTilikausi(kaudet, kaudet[0] as (typeof kaudet)[number])).toBeUndefined();
  });
});
