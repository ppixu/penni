import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { HETU, TYONTEKIJA, c, tapausA } from './fikstuuri.testapu.js';
import { type PalkkalaskelmaMalli, palkkalaskelmaMalli } from './palkkalaskelmaMalli.js';
import { rakennaPalkkalaskelmaPdf } from './rakennaPalkkalaskelmaPdf.js';

const norm = (s: string) => s.replace(/[\u00a0\u202f\u2009]/g, ' ');

function malli(): PalkkalaskelmaMalli {
  const { henkilo, ajo } = tapausA();
  return palkkalaskelmaMalli({
    henkilo,
    ajo,
    maksupaiva: '2026-10-31',
    tyontekija: TYONTEKIJA,
    tyonantaja: { nimi: 'Demo Oy', ytunnus: '1234567-8' },
    vuodenAlusta: { brutto: c(3_020_000), ennakonpidatys: c(604_000), netto: c(2_203_660) },
  });
}

async function lueTeksti(bytes: Uint8Array): Promise<string[]> {
  const tehtava = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await tehtava.promise;
  const sivut: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const sisalto = await (await doc.getPage(i)).getTextContent();
    sivut.push(
      sisalto.items
        .flatMap((it) => ('str' in it && it.str.trim() !== '' ? [norm(it.str)] : []))
        .join('\n'),
    );
  }
  await tehtava.destroy();
  return sivut;
}

describe('rakennaPalkkalaskelmaPdf', () => {
  it('tuottaa PDF:n', async () => {
    const bytes = await rakennaPalkkalaskelmaPdf(malli());
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('on deterministinen', async () => {
    const a = await rakennaPalkkalaskelmaPdf(malli());
    const b = await rakennaPalkkalaskelmaPdf(malli());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('sisältää nettopalkan, rivit, pidätyksen ja vuoden alun luvut', async () => {
    const [sivu] = await lueTeksti(await rakennaPalkkalaskelmaPdf(malli()));
    const t = sivu ?? '';
    for (const osa of [
      'Palkkalaskelma',
      'Demo Oy',
      '1234567-8',
      'Testi Työntekijä',
      '01.01.1990',
      'FI21 1234 5600 0007 85',
      '1.10.2026 – 31.10.2026',
      'Nettopalkka',
      '2 203,66',
      'Puhelinetu (ei makseta rahana)',
      'Ennakonpidätys',
      '−604,00',
      '20,0 % (tuloraja 30 000,00 €, kertymä 3 020,00 €)',
      'Vuoden alusta',
      '30 200,00',
    ]) {
      expect(t, osa).toContain(osa);
    }
  });

  it('ei sisällä henkilötunnuksen yksilönumeroa eikä tarkistemerkkiä', async () => {
    const teksti = (await lueTeksti(await rakennaPalkkalaskelmaPdf(malli()))).join('\n');
    expect(teksti).not.toContain(HETU);
    expect(teksti).not.toContain(HETU.slice(7));
  });

  it('asettaa metatiedot maksupäivästä', async () => {
    const pdf = await PDFDocument.load(await rakennaPalkkalaskelmaPdf(malli()), {
      updateMetadata: false,
    });
    expect(pdf.getCreationDate()).toEqual(new Date('2026-10-31T00:00:00Z'));
    expect(pdf.getTitle()).toBe('Palkkalaskelma 31.10.2026');
    expect(pdf.getProducer()).toBe('Penni');
  });

  it('jatkaa pitkän rivilistan uudelle sivulle', async () => {
    const m = malli();
    const rivit = Array.from({ length: 60 }, (_, i) => ({
      ...(m.rivit[0] as PalkkalaskelmaMalli['rivit'][number]),
      selite: `Lisä ${i + 1}`,
    }));
    const sivut = await lueTeksti(await rakennaPalkkalaskelmaPdf({ ...m, rivit }));
    expect(sivut.length).toBeGreaterThan(1);
    expect(sivut.join('\n')).toContain('Lisä 60');
    expect(sivut.join('\n')).toContain('Nettopalkka');
  });
});
