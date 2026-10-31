/**
 * Rakentaa kelvollisen yksisivuisen PDF:n, jossa on tekstikerros — testiaineistoa
 * tiliote- ja kuittilukijoille. Näin testit eivät tarvitse oikeaa pankkiaineistoa
 * eikä repoon committoida binäärifikstuureja.
 *
 * Rivit näytetään `'`-operaattorilla (siirry seuraavalle riville ja piirrä teksti),
 * koska pdf.js merkitsee sen tuottamat tekstiosat rivinvaihdoiksi (`hasEOL`), ja
 * pdfTeksti nojaa juuri siihen rivijaossa.
 */
function suojaa(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function luoTestiPdf(rivit: readonly string[]): Uint8Array {
  const sisalto = [
    'BT',
    '/F1 10 Tf',
    '14 TL',
    '40 800 Td',
    ...rivit.map((r) => `(${suojaa(r)}) '`),
    'ET',
  ].join('\n');

  const oliot = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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

  // latin1: yksi tavu per merkki, joten merkki-indeksit yllä ovat myös tavusiirtymiä.
  const tavut = new Uint8Array(ulos.length);
  for (let i = 0; i < ulos.length; i++) tavut[i] = ulos.charCodeAt(i) & 0xff;
  return tavut;
}
