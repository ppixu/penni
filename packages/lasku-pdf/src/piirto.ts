import { type PDFFont, type PDFPage, type RGB, rgb } from 'pdf-lib';
import { mm, yPt } from './mitat.js';

/** Piirtoapurit ja värit, joita sekä laskun runko että maksuosa käyttävät (mitat mm, y ylhäältä). */

export const TEKSTI = rgb(0.09, 0.09, 0.11);
export const HIMMEA = rgb(0.42, 0.42, 0.46);
export const VIIVA = rgb(0.85, 0.85, 0.88);
export const TAUSTA = rgb(0.965, 0.965, 0.975);

/** Teksti perusviivalle (xMm, yMm); kutistuu (min 6 pt), jos ei mahdu `maxLeveysMm`:iin. */
export function teksti(
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

/** Oikeaan reunaan tasattu teksti; kutistuu (min 6 pt), jos ei mahdu `maxLeveysMm`:iin. */
export function tekstiOikealle(
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

export function viiva(
  sivu: PDFPage,
  vasenMm: number,
  oikeaMm: number,
  yMm: number,
  vari: RGB,
): void {
  sivu.drawLine({
    start: { x: mm(vasenMm), y: yPt(yMm) },
    end: { x: mm(oikeaMm), y: yPt(yMm) },
    thickness: 0.5,
    color: vari,
  });
}
