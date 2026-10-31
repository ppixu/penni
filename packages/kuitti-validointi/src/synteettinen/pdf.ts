/**
 * Minimaalinen PDF-kirjoittaja synteettisiä kuittifikstuureita varten: yksi sivu, suorakaiteita
 * ja tekstiä standardifonteilla (Courier/Helvetica/Times, WinAnsi). Ei riippuvuuksia — tuloksena
 * on oikea PDF jossa on tekstikerros, ja `pdftoppm` rasteroi sen kuvaksi.
 */

export type Fontti =
  | 'Courier'
  | 'Courier-Bold'
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Times-Italic'
  | 'Times-Roman';

export interface PdfTeksti {
  x: number;
  /** Tekstin perusviivan korkeus sivun alareunasta (PDF-koordinaatisto). */
  y: number;
  teksti: string;
  fontti: Fontti;
  koko: number;
  /** Harmaasävy 0 (musta) … 1 (valkoinen); oletus 0. */
  harmaa?: number;
}

export interface PdfLaatikko {
  x: number;
  y: number;
  leveys: number;
  korkeus: number;
  /** RGB 0…1. */
  vari: [number, number, number];
}

export interface PdfSivu {
  leveys: number;
  korkeus: number;
  laatikot?: PdfLaatikko[];
  tekstit: PdfTeksti[];
}

/** Merkkijono → WinAnsi (cp1252) -tavut; €-merkki on 0x80, latin1 muuten, tuntematon → '?'. */
export function winAnsi(s: string): Uint8Array {
  const ulos: number[] = [];
  for (const merkki of s) {
    const koodi = merkki.codePointAt(0) ?? 63;
    if (merkki === '€') ulos.push(0x80);
    else if (koodi < 256) ulos.push(koodi);
    else ulos.push(63);
  }
  return Uint8Array.from(ulos);
}

/** Escapoi PDF-merkkijonoliteraalin erikoismerkit tavutasolla. */
function pdfMerkkijono(tavut: Uint8Array): Uint8Array {
  const ulos: number[] = [0x28]; // (
  for (const b of tavut) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) ulos.push(0x5c);
    ulos.push(b);
  }
  ulos.push(0x29); // )
  return Uint8Array.from(ulos);
}

const luku = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Rakentaa PDF-tiedoston tavut. Pure ja deterministinen (ei aikaleimoja). */
export function kirjoitaPdf(sivu: PdfSivu): Uint8Array {
  const fontit = [...new Set(sivu.tekstit.map((t) => t.fontti))];
  const fonttiNimi = (f: Fontti): string => `F${fontit.indexOf(f) + 1}`;

  const sisalto: Uint8Array[] = [];
  const enkooda = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'latin1'));
  for (const l of sivu.laatikot ?? []) {
    sisalto.push(
      enkooda(
        `${l.vari.map(luku).join(' ')} rg ${luku(l.x)} ${luku(l.y)} ${luku(l.leveys)} ${luku(l.korkeus)} re f\n`,
      ),
    );
  }
  for (const t of sivu.tekstit) {
    sisalto.push(
      enkooda(
        `BT ${luku(t.harmaa ?? 0)} g /${fonttiNimi(t.fontti)} ${luku(t.koko)} Tf ${luku(t.x)} ${luku(t.y)} Td `,
      ),
      pdfMerkkijono(winAnsi(t.teksti)),
      enkooda(' Tj ET\n'),
    );
  }
  const virta = Buffer.concat(sisalto);

  const fonttiObjektit = fontit.map(
    (f) => `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`,
  );
  const fonttiViitteet = fontit.map((f, i) => `/${fonttiNimi(f)} ${5 + i} 0 R`).join(' ');

  const objektit: (string | Buffer)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${luku(sivu.leveys)} ${luku(sivu.korkeus)}] /Contents 4 0 R /Resources << /Font << ${fonttiViitteet} >> >> >>`,
    Buffer.concat([
      Buffer.from(`<< /Length ${virta.length} >>\nstream\n`, 'latin1'),
      virta,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    ...fonttiObjektit,
  ];

  const osat: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const siirtymat: number[] = [];
  let paikka = osat[0]?.length ?? 0;
  objektit.forEach((o, i) => {
    siirtymat.push(paikka);
    const rivi = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      typeof o === 'string' ? Buffer.from(o, 'latin1') : o,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    osat.push(rivi);
    paikka += rivi.length;
  });
  const xref = [
    `xref\n0 ${objektit.length + 1}\n`,
    '0000000000 65535 f \n',
    ...siirtymat.map((s) => `${String(s).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objektit.length + 1} /Root 1 0 R >>\nstartxref\n${paikka}\n%%EOF\n`,
  ].join('');
  osat.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(osat));
}
