import type { StoredTosite } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  type Lajittelu,
  OLETUSLAJITTELU,
  lajittele,
  onOletuslajittelu,
  seuraavaLajittelu,
} from './lajittelu.js';

interface Osat {
  id: number;
  pvm?: string;
  tyyppi?: number;
  sarja?: string;
  tunniste?: number;
  otsikko?: string;
  snt?: number;
}

function tosite(o: Osat): StoredTosite {
  const snt = Euro.fromCents(o.snt ?? 0);
  return {
    id: o.id,
    pvm: o.pvm ?? '2026-01-01',
    tyyppi: o.tyyppi ?? 200,
    sarja: o.sarja ?? '',
    tunniste: o.tunniste ?? 0,
    ...(o.otsikko !== undefined ? { otsikko: o.otsikko } : {}),
    viennit: [{ tili: 1910, debet: snt, kredit: Euro.fromCents(0) }],
  } as unknown as StoredTosite;
}

const idt = (l: StoredTosite[]) => l.map((t) => t.id);
const jarjesta = (osat: Osat[], l: Lajittelu) => idt(lajittele(osat.map(tosite), l));
const nouseva = (kentta: Lajittelu['kentta']): Lajittelu => ({ kentta, suunta: 'nouseva' });
const laskeva = (kentta: Lajittelu['kentta']): Lajittelu => ({ kentta, suunta: 'laskeva' });

describe('lajittele', () => {
  it('oletus on uusin ensin ja tasapäivät numeron ja id:n mukaan laskevasti', () => {
    const osat = [
      { id: 1, pvm: '2026-01-01', tunniste: 1 },
      { id: 2, pvm: '2026-03-01', tunniste: 3 },
      { id: 3, pvm: '2026-03-01', tunniste: 4 },
      { id: 4, pvm: '2026-02-01', tunniste: 2 },
    ];
    expect(jarjesta(osat, OLETUSLAJITTELU)).toEqual([3, 2, 4, 1]);
  });

  it('päivämäärä nouseva kääntää myös tasauksen', () => {
    const osat = [
      { id: 1, pvm: '2026-03-01', tunniste: 4 },
      { id: 2, pvm: '2026-03-01', tunniste: 3 },
      { id: 3, pvm: '2026-01-01', tunniste: 1 },
    ];
    expect(jarjesta(osat, nouseva('pvm'))).toEqual([3, 2, 1]);
  });

  it('numero: sarja ensin, sitten numeerisesti (10 > 9), luonnokset viimeiseksi kumpaankin suuntaan', () => {
    const osat = [
      { id: 1, sarja: 'A', tunniste: 10 },
      { id: 2, sarja: 'A', tunniste: 9 },
      { id: 3, sarja: 'B', tunniste: 1 },
      { id: 4, tunniste: 0 },
      { id: 5, sarja: 'A', tunniste: 2 },
    ];
    expect(jarjesta(osat, nouseva('nro'))).toEqual([5, 2, 1, 3, 4]);
    expect(jarjesta(osat, laskeva('nro'))).toEqual([3, 1, 2, 5, 4]);
  });

  it('luonnokset keskenään uusin ensin', () => {
    const osat = [
      { id: 1, pvm: '2026-01-01' },
      { id: 2, pvm: '2026-05-01' },
      { id: 3, sarja: 'A', tunniste: 1 },
    ];
    expect(jarjesta(osat, nouseva('nro'))).toEqual([3, 2, 1]);
    expect(jarjesta(osat, laskeva('nro'))).toEqual([3, 2, 1]);
  });

  it('tyyppi: tyypin nimen mukaan, ei koodin', () => {
    // 100 = Meno, 200 = Tulo, 300 = Siirto, 700 = Muistio, 0 = Muu
    const osat = [
      { id: 1, tyyppi: 700 },
      { id: 2, tyyppi: 100 },
      { id: 3, tyyppi: 0 },
      { id: 4, tyyppi: 300 },
      { id: 5, tyyppi: 200 },
    ];
    expect(jarjesta(osat, nouseva('tyyppi'))).toEqual([2, 1, 3, 4, 5]);
    expect(jarjesta(osat, laskeva('tyyppi'))).toEqual([5, 4, 3, 1, 2]);
  });

  it('selite: suomalainen järjestys (å, ä, ö z:n jälkeen), tyhjät viimeiseksi', () => {
    const osat = [
      { id: 1, otsikko: 'Östersund' },
      { id: 2, otsikko: 'Zebra' },
      { id: 3, otsikko: 'Ämpäri' },
      { id: 4 },
      { id: 5, otsikko: 'Åke' },
      { id: 6, otsikko: 'Aamu' },
      { id: 7, otsikko: '  ' },
    ];
    // Suomessa: ... Z, Å, Ä, Ö
    expect(jarjesta(osat, nouseva('selite')).slice(0, 5)).toEqual([6, 2, 5, 3, 1]);
    expect(jarjesta(osat, laskeva('selite')).slice(0, 5)).toEqual([1, 3, 5, 2, 6]);
    // Tyhjät aina lopussa, keskenään uusin ensin (tässä samapäiväisiä: id laskevasti).
    expect(jarjesta(osat, nouseva('selite')).slice(5)).toEqual([7, 4]);
    expect(jarjesta(osat, laskeva('selite')).slice(5)).toEqual([7, 4]);
  });

  it('summa: sentit numeerisesti, tasat uusin ensin', () => {
    const osat = [
      { id: 1, snt: 1_000_00 },
      { id: 2, snt: 99_00 },
      { id: 3, snt: 99_00, pvm: '2026-06-01' },
      { id: 4, snt: 5 },
    ];
    expect(jarjesta(osat, nouseva('summa'))).toEqual([4, 3, 2, 1]);
    expect(jarjesta(osat, laskeva('summa'))).toEqual([1, 3, 2, 4]);
  });

  it('ei muuta syötettä', () => {
    const syote = [tosite({ id: 1, pvm: '2026-02-01' }), tosite({ id: 2, pvm: '2026-01-01' })];
    lajittele(syote, nouseva('pvm'));
    expect(idt(syote)).toEqual([1, 2]);
  });
});

describe('seuraavaLajittelu', () => {
  it('uusi sarake -> nouseva -> laskeva -> oletus', () => {
    let l = OLETUSLAJITTELU;
    l = seuraavaLajittelu(l, 'summa');
    expect(l).toEqual(nouseva('summa'));
    l = seuraavaLajittelu(l, 'summa');
    expect(l).toEqual(laskeva('summa'));
    l = seuraavaLajittelu(l, 'summa');
    expect(onOletuslajittelu(l)).toBe(true);
  });

  it('päivämäärä (oletus) vaihtelee vain nousevan ja laskevan välillä', () => {
    let l = seuraavaLajittelu(OLETUSLAJITTELU, 'pvm');
    expect(l).toEqual(nouseva('pvm'));
    l = seuraavaLajittelu(l, 'pvm');
    expect(l).toEqual(laskeva('pvm'));
    expect(onOletuslajittelu(l)).toBe(true);
  });

  it('toisen sarakkeen painallus aloittaa aina nousevasta', () => {
    expect(seuraavaLajittelu(laskeva('summa'), 'tyyppi')).toEqual(nouseva('tyyppi'));
    expect(seuraavaLajittelu(laskeva('summa'), 'pvm')).toEqual(nouseva('pvm'));
  });
});
