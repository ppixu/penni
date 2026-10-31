/**
 * Demon kuitti- ja laskuliitteet: yksisivuinen PDF, jossa on tekstikerros. Tekstikerros on
 * tarkoituksellinen — selaimen kuitinluku lukee sen pdf.js:llä suoraan (ei näkömallia), joten
 * demossa kuitin pudottaminen Uusi tosite -lomakkeelle toimii ilman mallin latausta.
 *
 * Sama rakenne kuin @penni/luku/testi/luoTestiPdf, mutta Courier + WinAnsiEncoding, jotta
 * ä/ö/€ piirtyvät ja poimiutuvat oikein, ja kuitin mittainen sivu.
 */

const WIN_ANSI: Record<string, number> = { '€': 0x80, '–': 0x96, '—': 0x97 };

/** WinAnsi-tavu merkille; tuntemattomat merkit korvataan kysymysmerkillä. */
function winAnsi(merkki: string): number {
  const erikois = WIN_ANSI[merkki];
  if (erikois !== undefined) return erikois;
  const koodi = merkki.charCodeAt(0);
  return koodi < 0x100 ? koodi : 0x3f;
}

/** PDF-merkkijonoliteraali ASCII-muodossa: suojaukset ja ei-ASCII oktaalikoodeina. */
function literaali(s: string): string {
  let ulos = '';
  for (const merkki of s) {
    const tavu = winAnsi(merkki);
    if (merkki === '\\' || merkki === '(' || merkki === ')') ulos += `\\${merkki}`;
    else if (tavu < 0x20 || tavu > 0x7e) ulos += `\\${tavu.toString(8).padStart(3, '0')}`;
    else ulos += merkki;
  }
  return ulos;
}

const RIVIVALI = 12;

/** Rakentaa PDF:n riveistä. Leveys pisteinä; korkeus mitoitetaan rivimäärän mukaan. */
export function luoKuittiPdf(rivit: readonly string[], leveys = 260): Uint8Array {
  const korkeus = Math.max(200, 48 + rivit.length * RIVIVALI);
  const sisalto = [
    'BT',
    '/F1 9 Tf',
    `${RIVIVALI} TL`,
    `18 ${korkeus - 24} Td`,
    // `'` = siirry seuraavalle riville ja piirrä: pdf.js merkitsee osat rivinvaihdoiksi (hasEOL).
    ...rivit.map((r) => `(${literaali(r)}) '`),
    'ET',
  ].join('\n');

  const oliot = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${leveys} ${korkeus}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    `<< /Length ${sisalto.length} >>\nstream\n${sisalto}\nendstream`,
  ];

  let ulos = '%PDF-1.4\n';
  const siirtymat: number[] = [];
  for (const [i, olio] of oliot.entries()) {
    siirtymat.push(ulos.length);
    ulos += `${i + 1} 0 obj\n${olio}\nendobj\n`;
  }
  const xref = ulos.length;
  ulos += `xref\n0 ${oliot.length + 1}\n0000000000 65535 f \n`;
  for (const siirtyma of siirtymat) ulos += `${String(siirtyma).padStart(10, '0')} 00000 n \n`;
  ulos += `trailer\n<< /Size ${oliot.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Kaikki on ASCII:ta (ei-ASCII oktaalikoodeina), joten merkki-indeksit ovat tavusiirtymiä.
  const tavut = new Uint8Array(ulos.length);
  for (let i = 0; i < ulos.length; i++) tavut[i] = ulos.charCodeAt(i);
  return tavut;
}
