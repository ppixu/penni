import { describe, expect, it } from 'vitest';
import { type NumeroAvain, jarjestaNumeroittain, naapurit, tositteenBucket } from './naapurit.js';

const KAUDET = [
  { alkaa: '2025-01-01', loppuu: '2025-12-31' },
  { alkaa: '2026-01-01', loppuu: '2026-12-31' },
];

function avain(o: Partial<NumeroAvain> & { id: number }): NumeroAvain {
  return { pvm: '2026-01-01', sarja: '', tunniste: 0, ...o };
}

const idt = (l: readonly NumeroAvain[]) => l.map((t) => t.id);

describe('jarjestaNumeroittain', () => {
  it('kirjatut: tilikausi, sitten sarja, sitten tunniste (ei päivämäärä)', () => {
    const lista = [
      avain({ id: 1, pvm: '2026-03-01', sarja: 'B', tunniste: 1 }),
      avain({ id: 2, pvm: '2026-02-01', sarja: 'A', tunniste: 2 }),
      avain({ id: 3, pvm: '2026-05-01', sarja: 'A', tunniste: 1 }),
      avain({ id: 4, pvm: '2025-12-31', sarja: 'B', tunniste: 9 }),
      avain({ id: 5, pvm: '2026-01-15', sarja: 'A', tunniste: 10 }),
    ];
    // 2025: B9 · 2026: A1, A2, A10 (numeerisesti), B1
    expect(idt(jarjestaNumeroittain(lista, KAUDET))).toEqual([4, 3, 2, 5, 1]);
  });

  it('luonnokset (tunniste 0): päivämäärä, sitten id; numeroidut ennen numeroimattomia', () => {
    const lista = [
      avain({ id: 7, pvm: '2026-02-01' }),
      avain({ id: 3, pvm: '2026-02-01' }),
      avain({ id: 9, pvm: '2026-01-10' }),
      avain({ id: 1, pvm: '2026-06-01', tunniste: 4 }),
    ];
    expect(idt(jarjestaNumeroittain(lista, KAUDET))).toEqual([1, 9, 3, 7]);
  });

  it('tilikauden ulkopuolinen päivä järjestyy oman päivänsä mukaan', () => {
    const lista = [
      avain({ id: 1, pvm: '2026-02-01', tunniste: 1 }),
      avain({ id: 2, pvm: '2024-06-01', tunniste: 5 }),
    ];
    expect(idt(jarjestaNumeroittain(lista, KAUDET))).toEqual([2, 1]);
  });

  it('ei muuta syötettä', () => {
    const lista = [avain({ id: 2, tunniste: 2 }), avain({ id: 1, tunniste: 1 })];
    jarjestaNumeroittain(lista, KAUDET);
    expect(idt(lista)).toEqual([2, 1]);
  });
});

describe('naapurit', () => {
  const lista = [
    avain({ id: 10, tunniste: 1 }),
    avain({ id: 20, tunniste: 2 }),
    avain({ id: 30, tunniste: 3 }),
  ];

  it('palauttaa edellisen ja seuraavan numerojärjestyksessä', () => {
    expect(naapurit(lista, 20, KAUDET)).toEqual({ edellinen: 10, seuraava: 30 });
  });

  it('ensimmäisellä ei ole edellistä eikä viimeisellä seuraavaa', () => {
    expect(naapurit(lista, 10, KAUDET)).toEqual({ edellinen: null, seuraava: 20 });
    expect(naapurit(lista, 30, KAUDET)).toEqual({ edellinen: 20, seuraava: null });
  });

  it('tuntematon id: ei naapureita', () => {
    expect(naapurit(lista, 99, KAUDET)).toEqual({ edellinen: null, seuraava: null });
  });

  it('järjestää syötteen itse', () => {
    const sekaisin = [lista[2], lista[0], lista[1]] as NumeroAvain[];
    expect(naapurit(sekaisin, 10, KAUDET)).toEqual({ edellinen: null, seuraava: 20 });
  });
});

describe('tositteenBucket', () => {
  it('vastaa tositelistan tila-ryhmiä', () => {
    expect(tositteenBucket(100)).toBe('kirjanpidossa');
    expect(tositteenBucket(120)).toBe('kirjanpidossa');
    expect(tositteenBucket(50)).toBe('luonnos');
    expect(tositteenBucket(80)).toBe('luonnos');
    expect(tositteenBucket(20)).toBe('saapuneet');
    expect(tositteenBucket(5)).toBe('malli');
    expect(tositteenBucket(0)).toBe('poistetut');
  });
});
