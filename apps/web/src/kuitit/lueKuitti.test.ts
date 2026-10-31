import { OCR_KEHOTE } from '@penni/engine';
import { describe, expect, it, vi } from 'vitest';
import { type LukuRiippuvuudet, type Lukumalli, lueKuitti } from './lueKuitti.js';

const TEKSTI = [
  'Kahvila   Aamu   Oy',
  'Laskun   paivays   15.07.2026',
  'Alv   14   %   0,79',
  'Yhteensa   EUR   6,40',
].join('\n');

function malli(muuta: Partial<Lukumalli> = {}): Lukumalli {
  return {
    saatavilla: vi.fn().mockResolvedValue(true),
    lataa: vi.fn().mockResolvedValue(undefined),
    tulkitse: vi.fn().mockResolvedValue(TEKSTI),
    ...muuta,
  };
}
function riippuvuudet(muuta: Partial<LukuRiippuvuudet> = {}) {
  const m = malli();
  const r: LukuRiippuvuudet = {
    pdfTeksti: vi.fn().mockResolvedValue(''),
    rasteroiPdf: vi.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' })),
    malli: () => m,
    lupa: vi.fn().mockResolvedValue(true),
    vaihe: vi.fn(),
    signal: new AbortController().signal,
    ...muuta,
  };
  return { r, m };
}
const TAVUT = new Uint8Array([1, 2, 3]);

describe('lueKuitti', () => {
  it('lukee tekstikerroksellisen PDF:n koskematta malliin', async () => {
    const { r, m } = riippuvuudet({ pdfTeksti: vi.fn().mockResolvedValue(TEKSTI) });
    const t = await lueKuitti(TAVUT, 'application/pdf', r);
    expect(t).toMatchObject({
      ok: true,
      kuitti: { myyja: 'Kahvila Aamu Oy', pvm: '2026-07-15', bruttoSumma: 640 },
    });
    expect(m.lataa).not.toHaveBeenCalled();
    expect(r.lupa).not.toHaveBeenCalled();
  });

  it('rasteroi tekstittömän PDF:n ja litteroi sen mallilla OCR-kehotteella', async () => {
    const { r, m } = riippuvuudet();
    const t = await lueKuitti(TAVUT, 'application/pdf', r);
    expect(r.rasteroiPdf).toHaveBeenCalledOnce();
    expect(m.tulkitse).toHaveBeenCalledWith(expect.any(Blob), OCR_KEHOTE);
    expect(t.ok).toBe(true);
    expect(r.vaihe).toHaveBeenCalledWith({ vaihe: 'luetaan' });
  });

  it('lukee kuvan mallilla ja raportoi latauksen edistymisen', async () => {
    const m = malli({ lataa: vi.fn(async (e: (o: number) => void) => e(0.5)) });
    const { r } = riippuvuudet({ malli: () => m });
    await lueKuitti(TAVUT, 'image/png', r);
    expect(r.vaihe).toHaveBeenCalledWith({ vaihe: 'ladataanMallia', osuus: 0 });
    expect(r.vaihe).toHaveBeenCalledWith({ vaihe: 'ladataanMallia', osuus: 0.5 });
  });

  it('ei lue tukemattomia tiedostoja', async () => {
    const { r, m } = riippuvuudet();
    expect(await lueKuitti(TAVUT, 'image/heic', r)).toEqual({ ok: false, syy: 'eiTuettu' });
    expect(await lueKuitti(TAVUT, 'text/plain', r)).toEqual({ ok: false, syy: 'eiTuettu' });
    expect(m.saatavilla).not.toHaveBeenCalled();
  });

  it('ilman WebGPU:ta palauttaa eiGpu kysymättä lupaa', async () => {
    const { r } = riippuvuudet({
      malli: () => malli({ saatavilla: vi.fn().mockResolvedValue(false) }),
    });
    expect(await lueKuitti(TAVUT, 'image/png', r)).toEqual({ ok: false, syy: 'eiGpu' });
    expect(r.lupa).not.toHaveBeenCalled();
  });

  it('ilman lupaa ei lataa mallia', async () => {
    const { r, m } = riippuvuudet({ lupa: vi.fn().mockResolvedValue(false) });
    expect(await lueKuitti(TAVUT, 'image/png', r)).toEqual({ ok: false, syy: 'eiLupaa' });
    expect(m.lataa).not.toHaveBeenCalled();
  });

  it('peruttu luku ei palauta kuittia', async () => {
    const ohjain = new AbortController();
    const m = malli({
      tulkitse: vi.fn(async () => {
        ohjain.abort();
        return TEKSTI;
      }),
    });
    const { r } = riippuvuudet({ malli: () => m, signal: ohjain.signal });
    expect(await lueKuitti(TAVUT, 'image/png', r)).toEqual({ ok: false, syy: 'peruttu' });
  });

  it('perumisen aiheuttama virhe ei ole kirjattava virhe', async () => {
    const varoitus = vi.spyOn(console, 'warn');
    const ohjain = new AbortController();
    const m = malli({
      tulkitse: vi.fn(async () => {
        ohjain.abort();
        throw new DOMException('peruttu', 'AbortError');
      }),
    });
    const { r } = riippuvuudet({ malli: () => m, signal: ohjain.signal });
    expect(await lueKuitti(TAVUT, 'image/png', r)).toEqual({ ok: false, syy: 'peruttu' });
    expect(varoitus).not.toHaveBeenCalled();
  });

  it('mallin virhe ja tyhjä litteraatti ovat eri syitä', async () => {
    const varoitus = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const kaatuva = riippuvuudet({
      malli: () => malli({ tulkitse: vi.fn().mockRejectedValue(new Error('GPU')) }),
    });
    expect(await lueKuitti(TAVUT, 'image/png', kaatuva.r)).toEqual({ ok: false, syy: 'virhe' });
    expect(varoitus).toHaveBeenCalledOnce();
    expect(varoitus.mock.calls[0]?.join(' ')).toContain('GPU');
    const tyhja = riippuvuudet({
      malli: () => malli({ tulkitse: vi.fn().mockResolvedValue('   ') }),
    });
    expect(await lueKuitti(TAVUT, 'image/png', tyhja.r)).toEqual({ ok: false, syy: 'tyhja' });
  });
});
