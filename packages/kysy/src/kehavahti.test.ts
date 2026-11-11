import { describe, expect, it } from 'vitest';
import { Kehavahti } from './kehavahti.js';

const lause = 'Käyttäjä kysyy pankkitilin saldoa vuoden lopussa.';

describe('Kehavahti', () => {
  it('hälyttää vasta, kun sama lause tulee neljännen kerran', () => {
    const v = new Kehavahti();
    expect(v.lisaa(`${lause} `)).toBe(false);
    expect(v.lisaa(`${lause} `)).toBe(false);
    expect(v.lisaa(`${lause} `)).toBe(false);
    expect(v.lisaa(`${lause} `)).toBe(true);
  });

  it('tunnistaa lauseen, vaikka striimin palat pilkkovat sen mistä kohtaa tahansa', () => {
    const v = new Kehavahti();
    const virta = `${lause}\n`.repeat(4);
    const tulokset: boolean[] = [];
    for (let i = 0; i < virta.length; i += 7) tulokset.push(v.lisaa(virta.slice(i, i + 7)));
    expect(tulokset.at(-1)).toBe(true);
    expect(tulokset.filter(Boolean)).toHaveLength(1);
  });

  it('ei välitä kirjainkoosta eikä välilyöntien määrästä', () => {
    const v = new Kehavahti();
    v.lisaa(`${lause}\n`);
    v.lisaa(`${lause.toUpperCase()}\n`);
    v.lisaa(`  ${lause.replace(/ /g, '   ')}\n`);
    expect(v.lisaa(`${lause}\n`)).toBe(true);
  });

  it('lyhyet toistuvat palat ja eri lauseet eivät hälytä', () => {
    const v = new Kehavahti();
    for (let i = 0; i < 20; i++) expect(v.lisaa('Odota. Ok. ')).toBe(false);
    for (let i = 0; i < 20; i++)
      expect(v.lisaa(`Tarkistan tilin ${1900 + i} saldon nyt.\n`)).toBe(false);
  });
});
