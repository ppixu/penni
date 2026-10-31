import { afterEach, describe, expect, it } from 'vitest';
import { type EtusivunTiedot, etusivuHtml, varmenneHtml } from './ArkistoEtusivu';
import { ARKISTO_CSS, kokoaSovelluksenCss } from './arkistoCss';

/** Tailwind v4 -preflightin olennaiset nollaukset (tuotannossa `@layer base`, jota jsdom ei jäsennä). */
const PREFLIGHT = `
*, ::before, ::after { margin: 0; padding: 0; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
a { color: inherit; text-decoration: inherit; }
ol, ul, menu { list-style: none; }
`;

const TIEDOT: EtusivunTiedot = {
  nimi: 'Demo Oy',
  kausi: { alkaa: '2025-01-01', loppuu: '2025-12-31' },
  arkistoitu: '2026-10-31T10:00:00.000Z',
  versio: 'testi',
  juuriTiiviste: 'ab'.repeat(32),
  vahvistettu: null,
  raportit: [],
  alv: [],
  tositteita: 2,
  liitteita: 1,
  varoitukset: [],
};

/** Asettaa dokumentin rungoksi arkistosivun `<body>`-sisällön ja tyyliksi preflight + arkiston CSS. */
function lataaSivu(sivu: string, lisa = ''): void {
  const tyyli = document.createElement('style');
  tyyli.textContent = `${PREFLIGHT}\n${ARKISTO_CSS}`;
  document.head.appendChild(tyyli);
  const jasennetty = new DOMParser().parseFromString(sivu, 'text/html');
  document.body.className = jasennetty.body.className;
  document.body.innerHTML = jasennetty.body.innerHTML + lisa;
}

function tyyli(valitsin: string): CSSStyleDeclaration {
  const el = document.querySelector(valitsin);
  if (!el) throw new Error(`ei elementtiä ${valitsin}`);
  return getComputedStyle(el);
}

describe('ARKISTO_CSS', () => {
  afterEach(() => {
    for (const s of Array.from(document.head.querySelectorAll('style'))) s.remove();
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('palauttaa preflightin nollaamat otsikot, listat, linkit ja varoituksen etusivulla', () => {
    lataaSivu(etusivuHtml(TIEDOT));
    expect(tyyli('main h1').fontSize).toBe('22px');
    expect(tyyli('main h1').fontWeight).toBe('600');
    expect(tyyli('main h2').fontSize).toBe('17px');
    expect(tyyli('main h3').fontWeight).toBe('600');
    expect(tyyli('main ul').listStyle).toBe('disc');
    expect(tyyli('main ul a').color).toBe('var(--accent)');
    expect(tyyli('main ul a').textDecoration).toBe('underline');
    expect(tyyli('main .varoitus').color).toBe('var(--danger)');
    expect(tyyli('main .varoitus').background).toBe('var(--danger-soft)');
  });

  it('muotoilee varmenteen taulukon ja tiivisteen', () => {
    lataaSivu(varmenneHtml(TIEDOT));
    expect(tyyli('main table.varmenne th').fontWeight).toBe('600');
    expect(tyyli('main table.varmenne td').padding).toBe('6px 18px 6px 0px');
    expect(tyyli('main code').fontFamily).toContain('monospace');
    expect(tyyli('main ol').listStyle).toBe('decimal');
  });

  it('ei koske uudelleenkäytettyjen komponenttien otsikoihin, listoihin ja linkkeihin', () => {
    lataaSivu(
      etusivuHtml(TIEDOT).replace(
        '<main>',
        '<main><div id="komponentti"><h2>x</h2><ul><li><a href="#">y</a></li></ul></div>',
      ),
    );
    expect(tyyli('#komponentti h2').fontSize).toBe('inherit');
    expect(tyyli('#komponentti ul').listStyle).toBe('none');
    expect(tyyli('#komponentti a').textDecoration).toBe('inherit');
  });

  it('ei pakota taulukoita koko levyisiksi (uudelleenkäytetyillä on oma w-full)', () => {
    expect(ARKISTO_CSS).not.toMatch(/body\.arkisto table\s*\{/);
  });
});

describe('kokoaSovelluksenCss', () => {
  it('kokoaa säännöt, ohittaa @font-face-säännöt ja lukukelvottomat arkit', () => {
    const doc = {
      styleSheets: [
        {
          cssRules: [
            { type: CSSRule.FONT_FACE_RULE, cssText: '@font-face { src: url(/assets/x.woff2); }' },
            { type: CSSRule.STYLE_RULE, cssText: 'h1 { font-size: inherit; }' },
          ],
        },
        {
          get cssRules(): never {
            throw new DOMException('kielletty', 'SecurityError');
          },
        },
        { cssRules: [{ type: CSSRule.STYLE_RULE, cssText: '.w-full { width: 100%; }' }] },
      ],
    } as unknown as Document;
    expect(kokoaSovelluksenCss(doc)).toBe('h1 { font-size: inherit; }\n.w-full { width: 100%; }');
  });
});
