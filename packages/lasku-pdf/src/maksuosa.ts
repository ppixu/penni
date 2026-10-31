import {
  type PDFPage,
  fill,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingColor,
} from 'pdf-lib';
import QRCode from 'qrcode';
import { code128c } from './code128.js';
import type { Fontit } from './fontit.js';
import type { Maksuosa } from './laskuMalli.js';
import {
  SISALTO_LEVEYS_MM,
  SISALTO_OIKEA_MM,
  SISALTO_VASEN_MM,
  VIIVAKOODI_KORKEUS_MM,
  VIIVAKOODI_MODUULI_MM,
  mm,
  yPt,
} from './mitat.js';
import { HIMMEA, TEKSTI, VIIVA, teksti } from './piirto.js';

/** Suorakulmio mm:nä sivun vasemmasta yläkulmasta. */
export interface Alue {
  vasen: number;
  yla: number;
  oikea: number;
  ala: number;
}

export interface MaksuosaTulos {
  /** Maksuosan käyttämä korkeus (mm), alkaen annetusta y:stä. */
  korkeus: number;
  /** Palkkien ympäröivä suorakulmio (ilman tyhjiä alueita); null jos viivakoodia ei piirretty. */
  viivakoodiRect: Alue | null;
  /** QR:n moduulialue (ilman tyhjää aluetta); null jos QR:ää ei piirretty. */
  qrRect: Alue | null;
}

const MUSTA = rgb(0, 0, 0);

/** Rivi "Virtuaaliviivakoodi: …" ja sen jälkeinen väli. */
const RIVI_KORKEUS_MM = 7;
const LAATIKKO_KORKEUS_MM = 30;
/** Viivakoodin yläreunan etäisyys maksulaatikon alareunasta. */
const LAATIKON_JA_VIIVAKOODIN_VALI_MM = 5;
const QR_KOKO_MM = 30;
/**
 * Laatikon oikea reuna: QR:n ja laatikon väliin jää 6 mm, joten QR:n tyhjä alue
 * (EPC069-12: ≥ 4 moduulia, tässä noin 2,7 mm) pysyy vapaana.
 */
const LAATIKKO_OIKEA_MM = SISALTO_OIKEA_MM - QR_KOKO_MM - 6;

interface Suorakulmio {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Täytettyjä suorakulmioita yhtenä polkuna (ei saumoja vierekkäisten välillä). */
function taytaSuorakulmiot(sivu: PDFPage, rects: Suorakulmio[]): void {
  sivu.pushOperators(
    pushGraphicsState(),
    setFillingColor(MUSTA),
    ...rects.map((r) => rectangle(mm(r.x), yPt(r.y + r.h), mm(r.w), mm(r.h))),
    fill(),
    popGraphicsState(),
  );
}

/** Code 128C -palkit täytettyinä suorakulmioina; palkkien x lasketaan moduulimäärästä ilman kertymävirhettä. */
function piirraViivakoodi(sivu: PDFPage, leveydet: number[], yla: number): Alue {
  const moduuleja = leveydet.reduce((a, b) => a + b, 0);
  const leveys = moduuleja * VIIVAKOODI_MODUULI_MM;
  // Keskitetty vaakasuunnassa (opas s. 3), jotta tyhjät alueet ovat mahdollisimman suuret.
  const vasen = SISALTO_VASEN_MM + (SISALTO_LEVEYS_MM - leveys) / 2;
  const palkit: Suorakulmio[] = [];
  let kertyma = 0;
  leveydet.forEach((moduulit, i) => {
    if (i % 2 === 0) {
      palkit.push({
        x: vasen + kertyma * VIIVAKOODI_MODUULI_MM,
        y: yla,
        w: moduulit * VIIVAKOODI_MODUULI_MM,
        h: VIIVAKOODI_KORKEUS_MM,
      });
    }
    kertyma += moduulit;
  });
  taytaSuorakulmiot(sivu, palkit);
  return { vasen, yla, oikea: vasen + leveys, ala: yla + VIIVAKOODI_KORKEUS_MM };
}

/** SEPA-QR täytettyinä neliöinä (vaakasuuntaiset tummat jaksot yhdistetty). */
function piirraQr(sivu: PDFPage, data: string, vasen: number, yla: number): Alue {
  const { modules } = QRCode.create(data, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const kenno = QR_KOKO_MM / n;
  const jaksot: Suorakulmio[] = [];
  for (let r = 0; r < n; r++) {
    let alku = -1;
    for (let c = 0; c <= n; c++) {
      const tumma = c < n && modules.get(r, c) === 1;
      if (tumma && alku < 0) alku = c;
      if (!tumma && alku >= 0) {
        jaksot.push({
          x: vasen + alku * kenno,
          y: yla + r * kenno,
          w: (c - alku) * kenno,
          h: kenno,
        });
        alku = -1;
      }
    }
  }
  taytaSuorakulmiot(sivu, jaksot);
  return { vasen, yla, oikea: vasen + QR_KOKO_MM, ala: yla + QR_KOKO_MM };
}

/**
 * Piirtää maksuosan: rivi "Virtuaaliviivakoodi: …", maksulaatikko (saaja, IBAN, BIC, viite,
 * eräpäivä, summa), SEPA-QR laatikon oikealla puolella ja Code 128 -pankkiviivakoodi
 * laatikon alla. `y` on maksuosan yläreuna (mm ylhäältä). Tyhjä viivakoodi tai QR jättää
 * vastaavan osan pois. Palauttaa käytetyn korkeuden ja koodien sijainnit (testikoukku).
 */
export function piirraMaksuosa(
  sivu: PDFPage,
  maksu: Maksuosa,
  y: number,
  fontit: Fontit,
): MaksuosaTulos {
  const leveydet = code128c(maksu.virtuaaliviivakoodi);
  if (leveydet !== null) {
    teksti(
      sivu,
      `Virtuaaliviivakoodi: ${maksu.virtuaaliviivakoodi}`,
      SISALTO_VASEN_MM,
      y + 3,
      fontit.normaali,
      8.5,
      TEKSTI,
      SISALTO_LEVEYS_MM,
    );
  }

  // Maksulaatikko: kaksi riviä × kolme saraketta (otsikko pienellä, arvo alla).
  const laatikkoYla = y + RIVI_KORKEUS_MM;
  sivu.drawRectangle({
    x: mm(SISALTO_VASEN_MM),
    y: yPt(laatikkoYla + LAATIKKO_KORKEUS_MM),
    width: mm(LAATIKKO_OIKEA_MM - SISALTO_VASEN_MM),
    height: mm(LAATIKKO_KORKEUS_MM),
    borderColor: VIIVA,
    borderWidth: 0.75,
  });
  const sarakeX = [SISALTO_VASEN_MM + 3, SISALTO_VASEN_MM + 62, SISALTO_VASEN_MM + 112] as const;
  const sarakeLeveys = [56, 47, LAATIKKO_OIKEA_MM - sarakeX[2] - 3] as const;
  const kentat: [string, string, 0 | 1 | 2, 0 | 1, boolean?][] = [
    ['Saaja', maksu.saaja, 0, 0],
    ['IBAN', maksu.iban, 1, 0],
    ['BIC', maksu.bic, 2, 0],
    ['Viitenumero', maksu.viite, 0, 1],
    ['Eräpäivä', maksu.erapvm, 1, 1],
    ['Yhteensä EUR', maksu.summa, 2, 1, true],
  ];
  for (const [otsikko, arvo, sarake, rivi, vahva] of kentat) {
    if (otsikko === 'BIC' && arvo === '') continue; // tuntematon BIC → solu pois, kuten HTML-näkymässä
    const x = sarakeX[sarake];
    const leveys = sarakeLeveys[sarake];
    const ylaY = laatikkoYla + rivi * (LAATIKKO_KORKEUS_MM / 2);
    teksti(sivu, otsikko, x, ylaY + 5, fontit.normaali, 7.5, HIMMEA, leveys);
    teksti(
      sivu,
      arvo,
      x,
      ylaY + 11,
      vahva ? fontit.lihava : fontit.normaali,
      vahva ? 11 : 9.5,
      TEKSTI,
      leveys,
    );
  }

  const qrRect =
    maksu.qr !== '' ? piirraQr(sivu, maksu.qr, SISALTO_OIKEA_MM - QR_KOKO_MM, laatikkoYla) : null;

  const viivakoodiYla = laatikkoYla + LAATIKKO_KORKEUS_MM + LAATIKON_JA_VIIVAKOODIN_VALI_MM;
  const viivakoodiRect = leveydet !== null ? piirraViivakoodi(sivu, leveydet, viivakoodiYla) : null;

  const ala = viivakoodiRect?.ala ?? laatikkoYla + LAATIKKO_KORKEUS_MM;
  return { korkeus: ala - y, viivakoodiRect, qrRect };
}
