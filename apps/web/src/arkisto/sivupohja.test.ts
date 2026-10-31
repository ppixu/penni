import { describe, expect, it } from 'vitest';
import { ARKISTO_CSS, kokoaSovelluksenCss } from './arkistoCss';
import { htmlSivu } from './sivupohja';

describe('htmlSivu', () => {
  const html = htmlSivu({
    otsikko: 'A & <B>',
    runko: '<p>x</p>',
    syvyys: 1,
    navi: { kotiTeksti: 'Oy', seuraava: 'b.html' },
    alatunniste: 'f',
  });

  it('kokoaa kokonaisen HTML-dokumentin ilman skriptejä', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="fi">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>A &amp; &lt;B&gt;</title>');
    expect(html).toContain('href="../static/arkisto.css"');
    expect(html).toContain('href="../index.html"');
    expect(html).toContain('href="b.html"');
    expect(html).toContain('<main><p>x</p></main>');
    expect(html).toContain('<footer>f</footer>');
    expect(html).not.toContain('<script');
  });

  it('jättää puuttuvan edellisen linkin pois ja käyttää juuritasolla polkuja sellaisenaan', () => {
    expect(html).not.toContain('Edellinen');
    const juuri = htmlSivu({
      otsikko: 'Etusivu',
      runko: '',
      syvyys: 0,
      navi: { kotiTeksti: 'Demo <Oy>', edellinen: 'a.html' },
      alatunniste: 'Arkistoitu & valmis',
    });
    expect(juuri).toContain('href="static/arkisto.css"');
    expect(juuri).toContain('href="index.html"');
    expect(juuri).toContain('Demo &lt;Oy&gt;');
    expect(juuri).toContain('href="a.html"');
    expect(juuri).not.toContain('Seuraava');
    expect(juuri).toContain('<footer>Arkistoitu &amp; valmis</footer>');
  });
});

describe('arkiston CSS', () => {
  it('kokoaa luettavien arkkien säännöt ja ohittaa arkin, jonka cssRules heittää', () => {
    const luettava = {
      cssRules: [{ cssText: '.a { color: red; }' }, { cssText: '.b { margin: 0px; }' }],
    };
    const lukukielto = {
      get cssRules(): never {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    };
    const doc = { styleSheets: [lukukielto, luettava] } as unknown as Document;
    expect(kokoaSovelluksenCss(doc)).toBe('.a { color: red; }\n.b { margin: 0px; }');
  });

  it('piilottaa navigoinnin tulosteesta ja pakottaa vaalean teeman', () => {
    expect(ARKISTO_CSS).toMatch(/@media print[\s\S]*nav \{ display: none; \}/);
    expect(ARKISTO_CSS).toContain('color-scheme: light');
    // Väritunnukset kiinnitetään vaaleisiin arvoihin body.arkisto-tasolla.
    const runko = ARKISTO_CSS.match(/body\.arkisto \{([^}]*)\}/)?.[1] ?? '';
    expect(runko).toContain('--text: #18181b;');
    expect(runko).toContain('--text-muted: #6b7280;');
    expect(runko).toContain('--bg-app: #ffffff;');
    expect(runko).toContain('background: #ffffff;');
  });
});
