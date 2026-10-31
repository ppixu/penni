import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { csvRivi, csvSentit, csvTiedosto } from './csv';

describe('csvSentit', () => {
  it.each([
    [123450, '1234,50'],
    [-5, '-0,05'],
    [0, '0,00'],
    [5, '0,05'],
    [100, '1,00'],
    [-123450, '-1234,50'],
    [Number.MAX_SAFE_INTEGER, '90071992547409,91'],
    [-Number.MAX_SAFE_INTEGER, '-90071992547409,91'],
  ])('%i senttiä -> %s', (sentit, odotettu) => {
    expect(csvSentit(Euro.fromCents(sentit))).toBe(odotettu);
  });
});

describe('csvRivi', () => {
  it('lainaa puolipisteen, lainausmerkit ja rivinvaihdon sisältävät kentät', () => {
    expect(csvRivi(['a;b', 'say "hi"', 'x\ny', 3, null])).toBe('"a;b";"say ""hi""";"x\ny";3;');
  });

  it('lainaa kentän jossa on CR', () => {
    expect(csvRivi(['a\rb'])).toBe('"a\rb"');
  });

  it('jättää tavalliset kentät lainaamatta ja tyhjentää undefinedin', () => {
    expect(csvRivi(['abc', undefined, 'ä ö'])).toBe('abc;;ä ö');
  });
});

describe('csvRivi: kaavainjektion esto', () => {
  it.each([
    ["=cmd|' /c calc'!A0", "'=cmd|' /c calc'!A0"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['+1', "'+1"],
    ['-x', "'-x"],
    ['\tx', "'\tx"],
    ['=a;b', `"'=a;b"`],
  ])('%j -> %j', (syote, odotettu) => {
    expect(csvRivi([syote])).toBe(odotettu);
  });

  it('jättää luvut ja rahamerkkijonot ennalleen', () => {
    expect(csvRivi(['-1234,50', -5, csvSentit(-123450 as Cents)])).toBe('-1234,50;-5;-1234,50');
  });
});

describe('csvTiedosto', () => {
  it('alkaa BOM:lla ja päättää jokaisen rivin CRLF:ään', () => {
    const tavut = csvTiedosto(['a'], [['1']]);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(tavut)).toBe('\uFEFFa\r\n1\r\n');
    expect([...tavut.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('kirjoittaa pelkän otsikkorivin kun rivejä ei ole', () => {
    const tavut = csvTiedosto(['a', 'b;c'], []);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(tavut)).toBe('\uFEFFa;"b;c"\r\n');
  });
});
