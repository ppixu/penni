import { escapeHtml } from './polut';

/** Yksi arkiston HTML-sivu. */
export interface Sivu {
  otsikko: string;
  /** Valmiiksi renderöity HTML, lisätään sellaisenaan. */
  runko: string;
  /** Sivun syvyys arkiston juuresta: 0 = juuressa, 1 = alikansiossa (`raportit/` ym.). */
  syvyys: 0 | 1;
  navi: {
    /** Kotilinkin teksti, esim. "Demo Oy · 2026". */
    kotiTeksti: string;
    /** Edellisen/seuraavan sivun suhteellinen osoite (tositesivuilla). */
    edellinen?: string;
    seuraava?: string;
  };
  alatunniste: string;
}

/** Kokonainen, skriptitön HTML-dokumentti, joka toimii `file://`-osoitteesta. */
export function htmlSivu(s: Sivu): string {
  const juuri = s.syvyys === 1 ? '../' : '';
  const navi = [`<a href="${juuri}index.html">${escapeHtml(s.navi.kotiTeksti)}</a>`];
  if (s.navi.edellinen !== undefined)
    navi.push(`<a href="${escapeHtml(s.navi.edellinen)}">← Edellinen</a>`);
  if (s.navi.seuraava !== undefined)
    navi.push(`<a href="${escapeHtml(s.navi.seuraava)}">Seuraava →</a>`);
  return [
    '<!doctype html><html lang="fi"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(s.otsikko)}</title>`,
    `<link rel="stylesheet" href="${juuri}static/arkisto.css"></head>`,
    `<body class="arkisto"><nav>${navi.join('')}</nav>`,
    `<main>${s.runko}</main>`,
    `<footer>${escapeHtml(s.alatunniste)}</footer></body></html>`,
  ].join('');
}
