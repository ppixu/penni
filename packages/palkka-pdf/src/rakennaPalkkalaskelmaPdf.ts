import { type Fontit, lataaFontit } from '@penni/lasku-pdf';
import { PDFDocument, type PDFFont, type PDFPage, type RGB, rgb } from 'pdf-lib';
import type { PalkkalaskelmaMalli, PalkkalaskelmaRyhma } from './palkkalaskelmaMalli.js';

/** A4-asettelu millimetreinä (y ylhäältä), samat värit ja fontit kuin laskuissa. */

const MM_PT = 72 / 25.4;
const mm = (n: number): number => n * MM_PT;
const A4_LEVEYS_MM = 210;
const A4_KORKEUS_MM = 297;
const yPt = (ylaMm: number): number => mm(A4_KORKEUS_MM - ylaMm);

const VASEN = 15;
const OIKEA = A4_LEVEYS_MM - 15;
/** Sisällön alaraja; sivunumero sen alapuolella. */
const ALA = 275;
const RIVIKORKEUS = 6;

const TEKSTI = rgb(0.09, 0.09, 0.11);
const HIMMEA = rgb(0.42, 0.42, 0.46);
const VIIVA = rgb(0.85, 0.85, 0.88);
const TAUSTA = rgb(0.965, 0.965, 0.975);

const SARAKE = { maaraOikea: 128, aHintaOikea: 158, summaOikea: OIKEA, seliteLeveys: 95 } as const;

const RYHMAOTSIKOT: Record<PalkkalaskelmaRyhma, string> = {
  palkka: 'Palkka',
  edut: 'Luontoisedut',
  verovapaat: 'Verovapaat korvaukset',
  vahennykset: 'Vähennykset',
};

function teksti(
  sivu: PDFPage,
  s: string,
  xMm: number,
  yMm: number,
  font: PDFFont,
  koko: number,
  vari: RGB = TEKSTI,
  maxLeveysMm?: number,
): void {
  let k = koko;
  if (maxLeveysMm !== undefined) {
    while (k > 6 && font.widthOfTextAtSize(s, k) > mm(maxLeveysMm)) k -= 0.25;
  }
  if (s !== '') sivu.drawText(s, { x: mm(xMm), y: yPt(yMm), font, size: k, color: vari });
}

function tekstiOikealle(
  sivu: PDFPage,
  s: string,
  oikeaMm: number,
  yMm: number,
  font: PDFFont,
  koko: number,
  vari: RGB = TEKSTI,
  maxLeveysMm?: number,
): void {
  let k = koko;
  if (maxLeveysMm !== undefined) {
    while (k > 6 && font.widthOfTextAtSize(s, k) > mm(maxLeveysMm)) k -= 0.25;
  }
  if (s === '') return;
  sivu.drawText(s, {
    x: mm(oikeaMm) - font.widthOfTextAtSize(s, k),
    y: yPt(yMm),
    font,
    size: k,
    color: vari,
  });
}

function viiva(sivu: PDFPage, yMm: number, vari: RGB = VIIVA): void {
  sivu.drawLine({
    start: { x: mm(VASEN), y: yPt(yMm) },
    end: { x: mm(OIKEA), y: yPt(yMm) },
    thickness: 0.5,
    color: vari,
  });
}

function laatikko(sivu: PDFPage, yla: number, korkeus: number): void {
  sivu.drawRectangle({
    x: mm(VASEN),
    y: yPt(yla + korkeus),
    width: mm(OIKEA - VASEN),
    height: mm(korkeus),
    color: TAUSTA,
  });
}

/** Rivitys sanoittain `leveysMm`:n mukaan. */
function rivita(s: string, font: PDFFont, koko: number, leveysMm: number): string[] {
  const rivit: string[] = [];
  let nyt = '';
  for (const sana of s.split(' ')) {
    const ehdokas = nyt === '' ? sana : `${nyt} ${sana}`;
    if (nyt !== '' && font.widthOfTextAtSize(ehdokas, koko) > mm(leveysMm)) {
      rivit.push(nyt);
      nyt = sana;
    } else {
      nyt = ehdokas;
    }
  }
  if (nyt !== '') rivit.push(nyt);
  return rivit;
}

/** Maksupäivä 'p.k.vvvv' -> UTC-keskiyö; kiinteä metatietoaika pitää tavut samoina. */
function metatietoPvm(maksupaiva: string): Date {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(maksupaiva);
  if (!m) return new Date(0);
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

interface Piirtaja {
  doc: PDFDocument;
  f: Fontit;
  sivut: PDFPage[];
  sivu: PDFPage;
  /** Seuraavan rivin perusviiva (mm ylhäältä). */
  y: number;
}

function uusiSivu(p: Piirtaja, m: PalkkalaskelmaMalli): void {
  p.sivu = p.doc.addPage([mm(A4_LEVEYS_MM), mm(A4_KORKEUS_MM)]);
  p.sivut.push(p.sivu);
  if (p.sivut.length > 1) {
    teksti(p.sivu, 'Palkkalaskelma', VASEN, 20, p.f.lihava, 12);
    tekstiOikealle(
      p.sivu,
      `${m.tyontekija.nimi} · ${m.kausi}`,
      OIKEA,
      20,
      p.f.normaali,
      9,
      HIMMEA,
      120,
    );
    viiva(p.sivu, 24);
    p.y = 34;
  }
}

/** Varmistaa `tarve` mm tilaa; muuten aloittaa uuden sivun. */
function tilaa(p: Piirtaja, m: PalkkalaskelmaMalli, tarve: number): void {
  if (p.y + tarve > ALA) uusiSivu(p, m);
}

function otsikko(p: Piirtaja, m: PalkkalaskelmaMalli): void {
  const { sivu, f } = p;
  teksti(sivu, 'Palkkalaskelma', VASEN, 22, f.lihava, 20);
  tekstiOikealle(sivu, m.tyonantaja.nimi, OIKEA, 20, f.lihava, 11, TEKSTI, 85);
  tekstiOikealle(sivu, `Y-tunnus ${m.tyonantaja.ytunnus}`, OIKEA, 25.5, f.normaali, 9, HIMMEA);
  viiva(sivu, 31);

  // Työntekijä vasemmalla, kausi ja maksupäivä oikealla.
  teksti(sivu, 'TYÖNTEKIJÄ', VASEN, 40, f.lihava, 7.5, HIMMEA);
  let y = 46;
  teksti(sivu, m.tyontekija.nimi, VASEN, y, f.lihava, 11, TEKSTI, 90);
  y += 5.2;
  for (const rivi of m.tyontekija.osoite ?? []) {
    teksti(sivu, rivi, VASEN, y, f.normaali, 10, TEKSTI, 90);
    y += 4.8;
  }
  teksti(sivu, `Syntymäaika ${m.tyontekija.syntymaaika}`, VASEN, y, f.normaali, 10, TEKSTI, 90);
  y += 4.8;
  if (m.tyontekija.iban) {
    teksti(sivu, `IBAN ${m.tyontekija.iban}`, VASEN, y, f.normaali, 10, TEKSTI, 90);
    y += 4.8;
  }

  teksti(sivu, 'MAKSU', 115, 40, f.lihava, 7.5, HIMMEA);
  teksti(sivu, 'Palkkakausi', 115, 46, f.normaali, 10, HIMMEA);
  teksti(sivu, m.kausi, 148, 46, f.normaali, 10, TEKSTI, OIKEA - 148);
  teksti(sivu, 'Maksupäivä', 115, 51.2, f.normaali, 10, HIMMEA);
  teksti(sivu, m.maksupaiva, 148, 51.2, f.normaali, 10);

  p.y = Math.max(y, 56) + 8;
}

function taulukonOtsikko(p: Piirtaja): void {
  const { sivu, f } = p;
  teksti(sivu, 'Selite', VASEN, p.y, f.lihava, 8.5, HIMMEA);
  tekstiOikealle(sivu, 'Määrä', SARAKE.maaraOikea, p.y, f.lihava, 8.5, HIMMEA);
  tekstiOikealle(sivu, 'à-hinta', SARAKE.aHintaOikea, p.y, f.lihava, 8.5, HIMMEA);
  tekstiOikealle(sivu, 'Summa', SARAKE.summaOikea, p.y, f.lihava, 8.5, HIMMEA);
  p.y += 2;
  viiva(sivu, p.y);
  p.y += 6;
}

function taulukko(p: Piirtaja, m: PalkkalaskelmaMalli): void {
  taulukonOtsikko(p);
  let edellinen: PalkkalaskelmaRyhma | null = null;
  for (const r of m.rivit) {
    if (r.ryhma !== edellinen) {
      // Ryhmäotsikko ei jää sivun viimeiseksi riviksi.
      tilaa(p, m, RIVIKORKEUS * 3 + 2);
      p.y += edellinen === null ? 0 : 2;
      p.sivu.drawRectangle({
        x: mm(VASEN),
        y: yPt(p.y + 1.8),
        width: mm(OIKEA - VASEN),
        height: mm(RIVIKORKEUS - 0.4),
        color: TAUSTA,
      });
      teksti(p.sivu, RYHMAOTSIKOT[r.ryhma], VASEN + 1.5, p.y, p.f.lihava, 9);
      p.y += RIVIKORKEUS;
      edellinen = r.ryhma;
    }
    tilaa(p, m, RIVIKORKEUS);
    teksti(p.sivu, r.selite, VASEN + 1.5, p.y, p.f.normaali, 10, TEKSTI, SARAKE.seliteLeveys);
    if (r.maara)
      tekstiOikealle(p.sivu, r.maara, SARAKE.maaraOikea, p.y, p.f.normaali, 10, TEKSTI, 24);
    if (r.ahinta) {
      tekstiOikealle(p.sivu, r.ahinta, SARAKE.aHintaOikea, p.y, p.f.normaali, 10, HIMMEA, 28);
    }
    tekstiOikealle(p.sivu, r.summa, SARAKE.summaOikea, p.y, p.f.normaali, 10);
    p.y += RIVIKORKEUS;
  }
}

function yhteenveto(p: Piirtaja, m: PalkkalaskelmaMalli): void {
  const { f } = p;
  const pidatysRivit = rivita(m.pidatys, f.normaali, 9.5, OIKEA - VASEN - 40);
  const tarve = 16 + 4 + pidatysRivit.length * 4.6 + 6 + 28;
  tilaa(p, m, tarve);

  p.y += 3;
  viiva(p.sivu, p.y - 4, HIMMEA);
  laatikko(p.sivu, p.y - 3, 11);
  teksti(p.sivu, 'Nettopalkka', VASEN + 1.5, p.y + 4, f.lihava, 13);
  tekstiOikealle(p.sivu, m.nettopalkka, OIKEA, p.y + 4, f.lihava, 13);
  p.y += 18;

  teksti(p.sivu, 'Ennakonpidätys', VASEN, p.y, f.lihava, 9.5, HIMMEA);
  for (const rivi of pidatysRivit) {
    teksti(p.sivu, rivi, VASEN + 40, p.y, f.normaali, 9.5);
    p.y += 4.6;
  }
  p.y += 7;

  teksti(p.sivu, 'Vuoden alusta', VASEN, p.y, f.lihava, 7.5, HIMMEA);
  p.y += 3;
  viiva(p.sivu, p.y);
  p.y += 6;
  const sarakkeet: [string, string][] = [
    ['Bruttopalkka', m.vuodenAlusta.brutto],
    ['Ennakonpidätys', m.vuodenAlusta.ennakonpidatys],
    ['Nettopalkka', m.vuodenAlusta.netto],
  ];
  sarakkeet.forEach(([nimike, arvo], i) => {
    const vasen = VASEN + i * 62;
    teksti(p.sivu, nimike, vasen, p.y, f.normaali, 9, HIMMEA);
    teksti(p.sivu, arvo, vasen, p.y + 5.5, f.lihava, 11, TEKSTI, 58);
  });
  p.y += 12;
}

/** Palkkalaskelma A4-PDF:nä. Deterministinen: kiinteät metatiedot ja fontin osajoukon nimi. */
export async function rakennaPalkkalaskelmaPdf(m: PalkkalaskelmaMalli): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const f = await lataaFontit(doc);
  const sivu = doc.addPage([mm(A4_LEVEYS_MM), mm(A4_KORKEUS_MM)]);
  const p: Piirtaja = { doc, f, sivut: [sivu], sivu, y: 0 };

  otsikko(p, m);
  taulukko(p, m);
  yhteenveto(p, m);

  const n = p.sivut.length;
  p.sivut.forEach((s, i) => {
    tekstiOikealle(s, `Sivu ${i + 1}/${n}`, OIKEA, 287, f.normaali, 8, HIMMEA);
    teksti(s, m.tyonantaja.nimi, VASEN, 287, f.normaali, 8, HIMMEA, 100);
  });

  // Kiinteät metatiedot (ei "nyt"-aikaa): sama malli antaa aina samat tavut.
  const pvm = metatietoPvm(m.maksupaiva);
  doc.setTitle(`Palkkalaskelma ${m.maksupaiva}`);
  doc.setAuthor(m.tyonantaja.nimi);
  doc.setProducer('Penni');
  doc.setCreator('Penni');
  doc.setLanguage('fi-FI');
  doc.setCreationDate(pvm);
  doc.setModificationDate(pvm);

  return doc.save({ useObjectStreams: false });
}
