import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { LaskuMalli, MalliRivi } from './laskuMalli.js';
import { MAKSUOSA_KORKEUS_MM, SARAKE, SISALTO_ALA_MM, mm } from './mitat.js';
import { rakennaLaskuPdf } from './rakennaLaskuPdf.js';

const NBSP = ' ';
const EUR = (s: string) => `${s}${NBSP}€`;

const RIVI: MalliRivi = {
  selite: 'Konsultointi',
  maara: '1',
  aHinta: EUR('100,00'),
  alv: '25,5 %',
  yhteensa: EUR('125,50'),
};

function rivit(n: number): MalliRivi[] {
  return Array.from({ length: n }, (_, i) => ({ ...RIVI, selite: `Työrivi ${i + 1}` }));
}

const MAKSU: NonNullable<LaskuMalli['maksu']> = {
  saaja: 'Demo Oy',
  iban: 'FI21 1234 5600 0007 85',
  bic: 'NDEAFIHH',
  viite: '1 00019 3',
  erapvm: '15.6.2026',
  summa: EUR('249,50'),
  virtuaaliviivakoodi: '',
  qr: '',
};

function malli(osa: Partial<LaskuMalli> = {}): LaskuMalli {
  return {
    laji: 'lasku',
    otsikko: 'Lasku',
    numero: '1',
    laskupvmIso: '2026-06-01',
    myyja: ['Demo Oy', 'Demokatu 1', '00100 Helsinki'],
    ostaja: ['Asiakas Oy', 'Asiakkaankatu 2', '00200 Espoo'],
    info: [
      { nimike: 'Laskun numero', arvo: '1' },
      { nimike: 'Laskupäivä', arvo: '1.6.2026' },
      { nimike: 'Eräpäivä', arvo: '15.6.2026' },
      { nimike: 'Maksuehto', arvo: '14 pv netto' },
      { nimike: 'Viitenumero', arvo: '1 00019 3' },
      { nimike: 'Viivästyskorko', arvo: 'korkolain mukaan' },
      { nimike: 'Huomautusaika', arvo: '8 pv' },
    ],
    aihe: 'Kesäkuun työt',
    rivit: rivit(3),
    summat: [
      { nimike: 'Yhteensä veroton', arvo: EUR('200,00') },
      { nimike: 'Alv 25,5 %', arvo: EUR('49,50') },
      { nimike: 'Verollinen yhteensä', arvo: EUR('249,50'), vahva: true },
    ],
    maksu: null,
    alatunniste: [
      ['Demo Oy', 'Demokatu 1', '00100 Helsinki'],
      ['Y-tunnus 1234567-8', 'ALV-tunnus FI12345678'],
      ['Kotipaikka Helsinki'],
      ['Puhelin 040 123 4567', 'Sähköposti laskut@demo.fi'],
    ],
    pdfEste: null,
    tiedostonimi: 'Lasku-1.pdf',
    ...osa,
  };
}

interface Teksti {
  str: string;
  x: number;
  y: number;
  leveys: number;
}

/** Normalisoi tiukat/kapeat välit tavalliseksi väliksi, jotta haut eivät riipu erotinmerkistä. */
const norm = (s: string) => s.replace(/[   ]/g, ' ');

async function lueTekstit(bytes: Uint8Array): Promise<Teksti[][]> {
  const tehtava = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await tehtava.promise;
  const sivut: Teksti[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const sisalto = await (await doc.getPage(i)).getTextContent();
    sivut.push(
      sisalto.items.flatMap((it) =>
        'str' in it && it.str.trim() !== ''
          ? [{ str: norm(it.str), x: it.transform[4], y: it.transform[5], leveys: it.width }]
          : [],
      ),
    );
  }
  await tehtava.destroy();
  return sivut;
}

const sivunTeksti = (s: Teksti[]) => s.map((t) => t.str).join('\n');

describe('rakennaLaskuPdf', () => {
  it('on deterministinen: sama malli antaa täsmälleen samat tavut', async () => {
    const a = await rakennaLaskuPdf(malli());
    const b = await rakennaLaskuPdf(malli());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('tulostaa numeron, summat, ryhmitellyn viitteen ja sivunumeron', async () => {
    const [sivu] = await lueTekstit(await rakennaLaskuPdf(malli()));
    const teksti = sivunTeksti(sivu ?? []);
    expect(teksti).toContain('Lasku');
    expect(teksti).toContain('Verollinen yhteensä');
    expect(teksti).toContain('249,50');
    expect(teksti).toContain('1 00019 3');
    expect(teksti).toContain('Sivu 1/1');
    expect(teksti).toContain('Asiakas Oy');
    expect(teksti).toContain('Kesäkuun työt');
    expect(teksti).toContain('Y-tunnus 1234567-8');
  });

  it('asettaa metatiedot laskun päivästä ja otsikosta', async () => {
    const bytes = await rakennaLaskuPdf(malli());
    // updateMetadata: false — muuten pdf-lib päivittäisi ModDate/Producer latauksessa "nyt"-arvoihin.
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getCreationDate()).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(pdf.getModificationDate()).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(pdf.getTitle()).toBe('Lasku 1');
    expect(pdf.getProducer()).toBe('Penni');
    // Fontin osajoukon nimessä ei saa olla satunnaista päätettä.
    const raaka = Buffer.from(bytes).toString('latin1');
    expect(raaka).toContain('/BaseFont /PENNIA+Inter-Regular');
    expect(raaka).toContain('/BaseFont /PENNIB+Inter-SemiBold');
  });

  it('renderöi Latin-1:n ulkopuoliset merkit ja negatiivisen summan miinuksen', async () => {
    const bytes = await rakennaLaskuPdf(
      malli({
        ostaja: ['Łukasz Šťastný', 'Ulica 1'],
        summat: [{ nimike: 'Yhteensä', arvo: `−${EUR('1 234,56')}`, vahva: true }],
      }),
    );
    const [sivu] = await lueTekstit(bytes);
    const teksti = sivunTeksti(sivu ?? []);
    expect(teksti).toContain('Łukasz Šťastný');
    expect(teksti).toContain('−1 234,56 €');
  });

  it('sivuttaa: otsikkorivi toistuu, summat vain viimeisellä sivulla', async () => {
    const bytes = await rakennaLaskuPdf(malli({ rivit: rivit(60) }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
    const sivut = await lueTekstit(bytes);
    expect(sivut.length).toBeGreaterThanOrEqual(2);
    sivut.forEach((s, i) => {
      const teksti = sivunTeksti(s);
      expect(teksti).toContain('Selite');
      expect(teksti).toContain(`Sivu ${i + 1}/${sivut.length}`);
      expect(teksti).toContain('Y-tunnus 1234567-8'); // alatunniste joka sivulla
      expect(teksti.includes('Verollinen yhteensä')).toBe(i === sivut.length - 1);
    });
    // Kaikki rivit tulostuvat täsmälleen kerran.
    const kaikki = sivut.map(sivunTeksti).join('\n');
    for (let i = 1; i <= 60; i++) {
      expect(kaikki.match(new RegExp(`Työrivi ${i}$`, 'gm'))?.length).toBe(1);
    }
  });

  it('rivittää pitkän selitteen sarakkeensa sisään', async () => {
    const selite = Array.from({ length: 60 }, (_, i) => `sana${i}`)
      .join(' ')
      .slice(0, 300);
    const [sivu] = await lueTekstit(await rakennaLaskuPdf(malli({ rivit: [{ ...RIVI, selite }] })));
    const osat = (sivu ?? []).filter((t) => /^sana\d/.test(t.str));
    expect(osat.length).toBeGreaterThan(1); // rivittyi
    expect(osat.map((t) => t.str).join(' ')).toBe(selite);
    for (const t of osat) expect(t.x + t.leveys).toBeLessThanOrEqual(mm(SARAKE.maaraAlku) + 0.01);
  });

  it('rikkoo yhtenäisen pitkän sanan eikä ylitä saraketta', async () => {
    const selite = 'x'.repeat(200);
    const [sivu] = await lueTekstit(await rakennaLaskuPdf(malli({ rivit: [{ ...RIVI, selite }] })));
    const osat = (sivu ?? []).filter((t) => /^x+$/.test(t.str));
    expect(osat.length).toBeGreaterThan(1);
    expect(osat.map((t) => t.str).join('')).toBe(selite);
    for (const t of osat) expect(t.x + t.leveys).toBeLessThanOrEqual(mm(SARAKE.maaraAlku) + 0.01);
  });

  it('varaa maksuosalle tilan viimeisen sivun alalaidasta, myös rajatapauksissa', async () => {
    const varausYla = mm(297 - (SISALTO_ALA_MM - MAKSUOSA_KORKEUS_MM)); // pdf-y, ylhäältä lukien
    for (const n of [1, 14, 17, 19, 22, 40]) {
      const sivut = await lueTekstit(
        await rakennaLaskuPdf(malli({ rivit: rivit(n), maksu: MAKSU })),
      );
      const viimeinen = sivut.at(-1) ?? [];
      const summa = viimeinen.find((t) => t.str === 'Verollinen yhteensä');
      expect(summa, `n=${n}: summat viimeisellä sivulla`).toBeDefined();
      expect(summa?.y, `n=${n}: summat varatun alueen yläpuolella`).toBeGreaterThan(varausYla);
      // Summia ei jätetä yksin: viimeisellä sivulla on aina vähintään yksi rivi.
      expect(
        viimeinen.some((t) => /^Työrivi \d+$/.test(t.str)),
        `n=${n}`,
      ).toBe(true);
    }
  });

  it('tulostaa tyhjän rivilistan ja tyhjän numeron kaatumatta', async () => {
    const bytes = await rakennaLaskuPdf(malli({ rivit: [], numero: null, aihe: null }));
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe('Lasku');
    expect(pdf.getPageCount()).toBe(1);
  });
});
