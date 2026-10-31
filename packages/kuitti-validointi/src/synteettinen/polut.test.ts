import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_LASKURI_POLKU,
  FIKSTUURIHAKEMISTO,
  PAKETTIHAKEMISTO,
  alustaLaskuri,
  fikstuuriPolku,
} from './polut.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'polut-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fikstuuriPolku', () => {
  it('hyväksyy fikstuurihakemiston tiedostot', () => {
    expect(fikstuuriPolku('totuus.json')).toBe(join(FIKSTUURIHAKEMISTO, 'totuus.json'));
    expect(fikstuuriPolku('01-kauppakuitti.png')).toBe(
      join(FIKSTUURIHAKEMISTO, '01-kauppakuitti.png'),
    );
  });

  it('kieltäytyy poluista fikstuurihakemiston ulkopuolella', () => {
    expect(() => fikstuuriPolku('../../README.md')).toThrow(/Kieltäydytään/);
    expect(() => fikstuuriPolku('../fixtures/synteettinen/../../package.json')).toThrow(
      /Kieltäydytään/,
    );
    expect(() => fikstuuriPolku('/etc/hosts')).toThrow(/Kieltäydytään/);
    expect(() => fikstuuriPolku(join(dir, 'oikea-kuitti.jpg'))).toThrow(/Kieltäydytään/);
    expect(() => fikstuuriPolku('')).toThrow(/Kieltäydytään/); // itse hakemisto ei ole tiedosto
  });

  it('kieltäytyy symlinkistä joka osoittaa ulos juuresta', () => {
    const juuri = join(dir, 'juuri');
    const ulko = join(dir, 'ulko');
    mkdirSync(juuri);
    mkdirSync(ulko);
    writeFileSync(join(ulko, 'oikea.jpg'), 'x');
    symlinkSync(join(ulko, 'oikea.jpg'), join(juuri, 'linkki.jpg'));
    writeFileSync(join(juuri, 'ok.png'), 'x');
    expect(fikstuuriPolku('ok.png', juuri)).toBe(join(juuri, 'ok.png'));
    expect(() => fikstuuriPolku('linkki.jpg', juuri)).toThrow(/symlink/);
  });
});

describe('Workers AI -kutsulaskurin paikka', () => {
  it('on yksi kiinteä polku paketin juuressa, ei tulosten hakemiston alla', () => {
    expect(AI_LASKURI_POLKU.startsWith(PAKETTIHAKEMISTO)).toBe(true);
    expect(AI_LASKURI_POLKU).not.toMatch(/tulokset/);
    expect(AI_LASKURI_POLKU).toBe(join(PAKETTIHAKEMISTO, '.ai-tila', 'laskuri.json'));
  });

  it('eri --out ei vaikuta: sama kiinteä laskuri, vanhat out-laskurit vain migraation lähteenä', () => {
    const kiintea = join(dir, 'kiintea', 'laskuri.json');
    const outA = join(dir, 'A');
    const outB = join(dir, 'B');
    mkdirSync(outA);
    mkdirSync(outB);
    writeFileSync(join(outA, 'ai-laskuri.json'), '{"kutsuja":32}');
    const a = alustaLaskuri(kiintea, [join(outA, 'ai-laskuri.json')], []);
    expect(a.luku()).toBe(32);
    expect(existsSync(kiintea)).toBe(true);
    // toinen --out ilman omaa laskuria: kiinteä laskuri on jo olemassa, ja se pätee sellaisenaan
    const b = alustaLaskuri(kiintea, [join(outB, 'ai-laskuri.json')], [join(outB, 'cache-ai')]);
    expect(b.polku).toBe(a.polku);
    expect(b.luku()).toBe(32);
    b.varaa();
    expect(a.luku()).toBe(33);
  });
});

describe('alustaLaskuri', () => {
  it('migroi vanhojen laskurien maksimin eikä pienennä sitä', () => {
    const v1 = join(dir, 'v1.json');
    const v2 = join(dir, 'v2.json');
    writeFileSync(v1, '{"kutsuja":10}');
    writeFileSync(v2, '{"kutsuja":32}');
    const kiintea = join(dir, 'k', 'laskuri.json');
    const l = alustaLaskuri(kiintea, [v1, join(dir, 'puuttuu.json'), v2], []);
    expect(l.luku()).toBe(32);
    expect(JSON.parse(readFileSync(kiintea, 'utf8'))).toEqual({ kutsuja: 32 });
  });

  it('kieltäytyy kun laskuri puuttuu mutta välimuistissa on jo vastauksia', () => {
    const cache = join(dir, 'cache-ai');
    mkdirSync(cache);
    writeFileSync(join(cache, 'abc.txt'), 'vastaus');
    expect(() => alustaLaskuri(join(dir, 'k', 'laskuri.json'), [], [cache])).toThrow(/puuttuu/);
    expect(existsSync(join(dir, 'k', 'laskuri.json'))).toBe(false);
  });

  it('alkaa nollasta vain kun mitään ei ole kulutettu (ei laskureita, tyhjä tai puuttuva välimuisti)', () => {
    const cache = join(dir, 'cache-ai');
    mkdirSync(cache);
    expect(alustaLaskuri(join(dir, 'k', 'laskuri.json'), [], [cache, join(dir, 'ei')]).luku()).toBe(
      0,
    );
  });

  it('olemassa olevaa laskuria ei kosketa vaikka välimuistissa olisi vastauksia', () => {
    const kiintea = join(dir, 'laskuri.json');
    writeFileSync(kiintea, '{"kutsuja":5}');
    const cache = join(dir, 'cache-ai');
    mkdirSync(cache);
    writeFileSync(join(cache, 'a.txt'), 'x');
    expect(alustaLaskuri(kiintea, [], [cache]).luku()).toBe(5);
  });
});
