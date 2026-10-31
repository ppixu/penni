import { type Canvas, createCanvas } from '@napi-rs/canvas';
import { sepaQr, virtuaaliviivakoodi } from '@penni/validator';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { readBarcodes } from 'zxing-wasm/reader';
import { lataaFontit } from './fontit.js';
import type { LaskuMalli } from './laskuMalli.js';
import { type Alue, type MaksuosaTulos, piirraMaksuosa } from './maksuosa.js';
import {
  A4_KORKEUS,
  A4_LEVEYS,
  MAKSUOSA_KORKEUS_MM,
  MM_PT,
  SISALTO_ALA_MM,
  VIIVAKOODI_HILJAINEN_ALUE_MM,
  VIIVAKOODI_KORKEUS_MAX_MM,
  VIIVAKOODI_KORKEUS_MIN_MM,
  VIIVAKOODI_LEVEYS_MAX_MM,
  VIIVAKOODI_LEVEYS_MIN_MM,
  VIIVAKOODI_MODUULI_MM,
  mm,
} from './mitat.js';
import { rakennaLaskuPdf } from './rakennaLaskuPdf.js';

const DPI = 300;
const PX_PER_MM = DPI / 25.4;
const NBSP = '\u00a0';

const IBAN = 'FI2112345600000785';
const VIITE = '1000193';
const ERAPVM = '2026-06-15';
const MAARA = 24950;

const VIIVAKOODI = virtuaaliviivakoodi({
  iban: IBAN,
  maara: MAARA as never,
  viite: VIITE,
  erapvm: ERAPVM,
});
const QR = sepaQr({
  iban: IBAN,
  saaja: 'Demo Oy',
  maara: MAARA as never,
  viite: VIITE,
  erapvm: ERAPVM,
});

const MAKSU: NonNullable<LaskuMalli['maksu']> = {
  saaja: 'Demo Oy',
  iban: 'FI21 1234 5600 0007 85',
  bic: 'NDEAFIHH',
  viite: '1 00019 3',
  erapvm: '15.6.2026',
  summa: `249,50${NBSP}€`,
  virtuaaliviivakoodi: VIIVAKOODI,
  qr: QR,
};

function malli(maksu: LaskuMalli['maksu']): LaskuMalli {
  return {
    laji: 'lasku',
    otsikko: 'Lasku',
    numero: '1',
    laskupvmIso: '2026-06-01',
    myyja: ['Demo Oy', 'Demokatu 1', '00100 Helsinki'],
    ostaja: ['Asiakas Oy', 'Asiakkaankatu 2', '00200 Espoo'],
    info: [{ nimike: 'Laskun numero', arvo: '1' }],
    aihe: null,
    rivit: [
      {
        selite: 'Konsultointi',
        maara: '1',
        aHinta: `200,00${NBSP}€`,
        alv: '25,5 %',
        yhteensa: `249,50${NBSP}€`,
      },
    ],
    summat: [{ nimike: 'Verollinen yhteensä', arvo: `249,50${NBSP}€`, vahva: true }],
    maksu,
    alatunniste: [['Demo Oy', 'Demokatu 1', '00100 Helsinki']],
    pdfEste: null,
    tiedostonimi: 'Lasku-1.pdf',
  };
}

// ---------- apurit: rasterointi, dekoodaus, sisältövirta ----------

interface Raster {
  canvas: Canvas;
  teksti: string[];
}

/** Piirtää sivun 1 pdfjs:llä 300 dpi:n canvasille ja lukee samalla sivun tekstit. */
async function rasteroi(bytes: Uint8Array): Promise<Raster> {
  const tehtava = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await tehtava.promise;
  const sivu = await doc.getPage(1);
  const viewport = sivu.getViewport({ scale: DPI / 72 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await sivu.render({
    canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const sisalto = await sivu.getTextContent();
  const teksti = sisalto.items.flatMap((it) => ('str' in it ? [it.str] : []));
  await tehtava.destroy();
  return { canvas, teksti };
}

/** Rajaa canvasilta alueen (mm sivun vasemmasta yläkulmasta, reunoille `varaMm` lisää). */
function rajaa(canvas: Canvas, a: Alue, varaMm: number): ImageData {
  const x = Math.round((a.vasen - varaMm) * PX_PER_MM);
  const y = Math.round((a.yla - varaMm) * PX_PER_MM);
  const w = Math.round((a.oikea - a.vasen + 2 * varaMm) * PX_PER_MM);
  const h = Math.round((a.ala - a.yla + 2 * varaMm) * PX_PER_MM);
  return canvas.getContext('2d').getImageData(x, y, w, h) as unknown as ImageData;
}

/** Onko alue (mm) pikselitasolla täysin valkoinen? */
function onValkoinen(canvas: Canvas, a: Alue): boolean {
  const { data } = rajaa(canvas, a, 0);
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 0) < 250 || (data[i + 1] ?? 0) < 250 || (data[i + 2] ?? 0) < 250) return false;
  }
  return true;
}

/** Sivun 1 sisältövirran tekstimuodossa (pdf-lib pakkaa virrat). */
async function sisaltoVirta(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const sisalto = pdf.getPage(0).node.Contents();
  const virrat =
    sisalto instanceof PDFArray
      ? sisalto.asArray().map((r) => pdf.context.lookup(r, PDFRawStream))
      : [sisalto as PDFRawStream];
  return virrat
    .map((v) => Buffer.from(decodePDFRawStream(v).decode()).toString('latin1'))
    .join('\n');
}

interface Suorakulmio {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kaikki `x y w h re` -operaattorit (pt, PDF-koordinaatit). */
function suorakulmiot(virta: string): Suorakulmio[] {
  const luku = '(-?\\d+(?:\\.\\d+)?)';
  const re = new RegExp(`${luku} ${luku} ${luku} ${luku} re`, 'g');
  return [...virta.matchAll(re)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
  }));
}

const lahella = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/** Viivakoodin palkit sisältövirrasta: ne suorakulmiot, joiden korkeus on viivakoodin korkeus. */
function palkit(virta: string): Suorakulmio[] {
  return suorakulmiot(virta).filter((r) => r.h > mm(VIIVAKOODI_KORKEUS_MIN_MM) - 0.5);
}

// ---------- testit ----------

describe('piirraMaksuosa', () => {
  let bytes: Uint8Array;
  let raster: Raster;
  let virta: string;
  let hook: MaksuosaTulos;

  beforeAll(async () => {
    bytes = await rakennaLaskuPdf(malli(MAKSU));
    raster = await rasteroi(bytes);
    virta = await sisaltoVirta(bytes);

    // Testikoukku: sama piirto irralliseen sivuun antaa viivakoodin ja QR:n sijainnin (mm).
    const doc = await PDFDocument.create({ updateMetadata: false });
    const fontit = await lataaFontit(doc);
    const sivu = doc.addPage([A4_LEVEYS, A4_KORKEUS]);
    hook = piirraMaksuosa(sivu, MAKSU, SISALTO_ALA_MM - MAKSUOSA_KORKEUS_MM, fontit);
  }, 60_000);

  it('viivakoodi dekoodautuu 300 dpi:n rasterista takaisin 54 numeroksi', async () => {
    expect(VIIVAKOODI).toHaveLength(54);
    const rect = hook.viivakoodiRect;
    expect(rect).not.toBeNull();
    if (rect === null) return;
    const tulokset = await readBarcodes(rajaa(raster.canvas, rect, 4), { formats: ['Code128'] });
    expect(tulokset.map((t) => t.text)).toEqual([VIIVAKOODI]);
    expect(tulokset[0]?.isValid).toBe(true);
  });

  it('SEPA-QR dekoodautuu rasterista takaisin täsmälleen samaksi payloadiksi', async () => {
    const rect = hook.qrRect;
    expect(rect).not.toBeNull();
    if (rect === null) return;
    const tulokset = await readBarcodes(rajaa(raster.canvas, rect, 4), { formats: ['QRCode'] });
    expect(tulokset.map((t) => t.text)).toEqual([QR]);
  });

  it('koko sivu dekoodautuu: yksi Code128 ja yksi QR, ei muita koodeja', async () => {
    const { canvas } = raster;
    const kuva = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const tulokset = await readBarcodes(kuva as unknown as ImageData, {
      formats: ['Code128', 'QRCode'],
    });
    expect(tulokset.map((t) => [t.format, t.text]).sort()).toEqual(
      [
        ['Code128', VIIVAKOODI],
        ['QRCode', QR],
      ].sort(),
    );
  });

  it('viivakoodin geometria täyttää Pankkiviivakoodi-oppaan (v5.3) vaatimukset', () => {
    const rivi = palkit(virta);
    // Code 128C: start 3 + 28 symbolia × 3 + stop 4 = 91 palkkia (332 moduulia).
    expect(rivi).toHaveLength(91);
    const kapein = Math.min(...rivi.map((r) => r.w)) / MM_PT;
    expect(kapein).toBeGreaterThanOrEqual(VIIVAKOODI_MODUULI_MM - 0.001);

    const vasen = Math.min(...rivi.map((r) => r.x)) / MM_PT;
    const oikea = Math.max(...rivi.map((r) => r.x + r.w)) / MM_PT;
    const leveys = oikea - vasen;
    expect(leveys).toBeGreaterThanOrEqual(VIIVAKOODI_LEVEYS_MIN_MM);
    expect(leveys).toBeLessThanOrEqual(VIIVAKOODI_LEVEYS_MAX_MM);

    for (const r of rivi) {
      const korkeus = r.h / MM_PT;
      expect(korkeus).toBeGreaterThanOrEqual(VIIVAKOODI_KORKEUS_MIN_MM - 0.001);
      expect(korkeus).toBeLessThanOrEqual(VIIVAKOODI_KORKEUS_MAX_MM + 0.001);
      expect(lahella(r.y, rivi[0]?.y ?? 0)).toBe(true); // kaikki palkit samalta perusviivalta
    }

    // Koukun ilmoittama laatikko on sama kuin sisältövirran palkit (yläreuna ylhäältä mitattuna).
    const rect = hook.viivakoodiRect;
    expect(rect).not.toBeNull();
    expect(lahella(rect?.vasen ?? 0, vasen, 0.001)).toBe(true);
    expect(lahella(rect?.oikea ?? 0, oikea, 0.001)).toBe(true);
    const ylaPdf = ((rivi[0]?.y ?? 0) + (rivi[0]?.h ?? 0)) / MM_PT;
    expect(lahella(rect?.yla ?? 0, 297 - ylaPdf, 0.001)).toBe(true);
  });

  it('viivakoodin molemmilla puolilla on oppaan vaatima tyhjä alue (rasterista mitattuna)', () => {
    const rect = hook.viivakoodiRect;
    if (rect === null) throw new Error('viivakoodi puuttuu');
    const hiljainen = VIIVAKOODI_HILJAINEN_ALUE_MM;
    const korkeus = { yla: rect.yla, ala: rect.ala };
    // Pikselin pyöristys: jätetään 0,1 mm marginaali itse palkkien reunaan.
    const reuna = 0.1;
    expect(
      onValkoinen(raster.canvas, {
        ...korkeus,
        vasen: rect.vasen - hiljainen,
        oikea: rect.vasen - reuna,
      }),
    ).toBe(true);
    expect(
      onValkoinen(raster.canvas, {
        ...korkeus,
        vasen: rect.oikea + reuna,
        oikea: rect.oikea + hiljainen,
      }),
    ).toBe(true);
    // Sanity: tarkistus ei ole triviaalisti tosi — itse palkit eivät ole valkoisia.
    expect(onValkoinen(raster.canvas, { ...korkeus, vasen: rect.vasen, oikea: rect.oikea })).toBe(
      false,
    );
  });

  it('tulostaa viivakoodin numerot selväkielisenä ja maksulaatikon tiedot', () => {
    const t = raster.teksti.join('\n').replace(/[\u00a0\u202f\u2009]/g, ' ');
    expect(t).toContain(`Virtuaaliviivakoodi: ${VIIVAKOODI}`);
    for (const odotettu of [
      'Saaja',
      'Demo Oy',
      'IBAN',
      'FI21 1234 5600 0007 85',
      'BIC',
      'NDEAFIHH',
      'Viitenumero',
      '1 00019 3',
      'Eräpäivä',
      '15.6.2026',
      'Yhteensä EUR',
      '249,50 €',
    ]) {
      expect(t, odotettu).toContain(odotettu);
    }
  });

  it('jättää BIC-solun pois kun BIC on tyhjä (kuten HTML-näkymä)', async () => {
    const ilmanBic = await rasteroi(await rakennaLaskuPdf(malli({ ...MAKSU, bic: '' })));
    const t = ilmanBic.teksti.join('\n');
    expect(t).not.toContain('BIC');
    expect(t).toContain('FI21 1234 5600 0007 85');
  });

  it('on deterministinen maksuosan kanssa', async () => {
    const toinen = await rakennaLaskuPdf(malli(MAKSU));
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(toinen))).toBe(0);
  });

  it('palkit ja QR pysyvät sivun varatulla alueella alatunnisteen yläpuolella', () => {
    const rajat = [hook.viivakoodiRect, hook.qrRect];
    for (const r of rajat) {
      expect(r).not.toBeNull();
      expect(r?.yla ?? 0).toBeGreaterThanOrEqual(SISALTO_ALA_MM - MAKSUOSA_KORKEUS_MM);
      expect(r?.ala ?? 999).toBeLessThanOrEqual(SISALTO_ALA_MM);
    }
    expect(hook.korkeus).toBeLessThanOrEqual(MAKSUOSA_KORKEUS_MM);
  });
});

describe('maksuosa puuttuvilla koodeilla', () => {
  it('ilman maksua ei tule viivakoodin riviä eikä palkkeja', async () => {
    const bytes = await rakennaLaskuPdf(malli(null));
    const { teksti } = await rasteroi(bytes);
    expect(teksti.join('\n')).not.toContain('Virtuaaliviivakoodi');
    expect(palkit(await sisaltoVirta(bytes))).toHaveLength(0);
  });

  it('tyhjä viivakoodi: ei palkkeja eikä riviä, mutta maksulaatikko ja QR säilyvät', async () => {
    const bytes = await rakennaLaskuPdf(malli({ ...MAKSU, virtuaaliviivakoodi: '' }));
    const { canvas, teksti } = await rasteroi(bytes);
    const t = teksti.join('\n');
    expect(t).not.toContain('Virtuaaliviivakoodi');
    expect(t).toContain('Yhteensä EUR');
    expect(palkit(await sisaltoVirta(bytes))).toHaveLength(0);
    const kuva = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const tulokset = await readBarcodes(kuva as unknown as ImageData, {
      formats: ['Code128', 'QRCode'],
    });
    expect(tulokset.map((r) => r.format)).toEqual(['QRCode']);
  });

  it('tyhjä QR: ei QR:ää, viivakoodi säilyy', async () => {
    const bytes = await rakennaLaskuPdf(malli({ ...MAKSU, qr: '' }));
    const { canvas } = await rasteroi(bytes);
    const kuva = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const tulokset = await readBarcodes(kuva as unknown as ImageData, {
      formats: ['Code128', 'QRCode'],
    });
    expect(tulokset.map((r) => [r.format, r.text])).toEqual([['Code128', VIIVAKOODI]]);
  });
});
