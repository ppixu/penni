import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Kuva } from './rasterointi.js';
import {
  OCR_KEHOTE,
  VisioVirhe,
  cacheAvain,
  rakennaPyynto,
  tulkitseVastaus,
  visioKuitti,
  visioTeksti,
} from './vision.js';

const asetukset = { malli: 'qwen3.5:2b', ajattelu: false, url: 'http://localhost:11434/api/chat' };
const kuva: Kuva = { tavut: new Uint8Array([1, 2, 3]), mime: 'image/png' };
const KELPO_JSON = '{"valuutta":"EUR","alv":[]}';
const RIKKI_JSON = 'ei json tässä ollenkaan';

/** Vastaa Ollaman onnistunutta /api/chat-vastausta, ilman verkkoa (fetch on mockattu). */
const ollamaVastaus = (sisalto: string): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ message: { role: 'assistant', content: sisalto } }),
    text: () => Promise.resolve(''),
  }) as unknown as Response;

describe('tulkitseVastaus', () => {
  it('hyväksyy sisällön', () => {
    expect(tulkitseVastaus({ message: { role: 'assistant', content: '{"myyja":"X"}' } })).toEqual({
      ok: true,
      sisalto: '{"myyja":"X"}',
    });
  });

  it('tunnistaa budjetin loppumisen: tyhjä content mutta ajattelua', () => {
    const v = { message: { role: 'assistant', content: '', thinking: 'pohdin kuittia' } };
    expect(tulkitseVastaus(v)).toEqual({ ok: false, syy: 'budjetti' });
  });

  it('tunnistaa budjetin loppumisen myös done_reason=length perusteella', () => {
    const v = { message: { role: 'assistant', content: '' }, done_reason: 'length' };
    expect(tulkitseVastaus(v)).toEqual({ ok: false, syy: 'budjetti' });
  });

  it('erottaa aidosti tyhjän vastauksen budjetista', () => {
    const v = { message: { role: 'assistant', content: '' }, done_reason: 'stop' };
    expect(tulkitseVastaus(v)).toEqual({ ok: false, syy: 'tyhja' });
  });
});

describe('cacheAvain', () => {
  const KEHOTE = 'kehote';
  const URL = 'http://localhost:11434/api/chat';

  it('erottelee tilan, mallin ja ajattelun', () => {
    const tavut = new Uint8Array([1, 2, 3]);
    const a = cacheAvain(tavut, 'qwen3.5:2b', 'poiminta', false, KEHOTE, URL);
    const b = cacheAvain(tavut, 'qwen3.5:2b', 'ocr', false, KEHOTE, URL);
    const c = cacheAvain(tavut, 'qwen3.5:2b', 'poiminta', true, KEHOTE, URL);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toMatch(/\.txt$/);
  });

  it('antaa saman avaimen samoille tavuille', () => {
    expect(cacheAvain(new Uint8Array([9]), 'm', 'ocr', false, KEHOTE, URL)).toBe(
      cacheAvain(new Uint8Array([9]), 'm', 'ocr', false, KEHOTE, URL),
    );
  });

  it('erottelee kehotteen (finding #6): eri kehote → eri avain samoilla tavuilla', () => {
    const tavut = new Uint8Array([1, 2, 3]);
    const a = cacheAvain(tavut, 'm', 'poiminta', false, 'kehote yksi', URL);
    const b = cacheAvain(tavut, 'm', 'poiminta', false, 'kehote kaksi', URL);
    expect(a).not.toBe(b);
  });

  it('erottelee päätepisteen (finding #6): eri url → eri avain samoilla tavuilla', () => {
    const tavut = new Uint8Array([1, 2, 3]);
    const a = cacheAvain(tavut, 'm', 'poiminta', false, KEHOTE, 'http://localhost:11434/api/chat');
    const b = cacheAvain(tavut, 'm', 'poiminta', false, KEHOTE, 'http://localhost:9999/api/chat');
    expect(a).not.toBe(b);
  });
});

describe('rakennaPyynto', () => {
  it('pyytää json-muotoa ja pienen budjetin ilman ajattelua', () => {
    const p = rakennaPyynto('QUJD', 'kehote', asetukset, true);
    expect(p.format).toBe('json');
    expect(p.think).toBe(false);
    expect(p.options).toEqual({ temperature: 0, num_predict: 500 });
  });

  it('nostaa budjetin kun ajattelu on päällä ja jättää formaatin pois ocr-tilassa', () => {
    const p = rakennaPyynto('QUJD', 'kehote', { ...asetukset, ajattelu: true }, false);
    expect(p.think).toBe(true);
    expect(p.options).toEqual({ temperature: 0, num_predict: 3000 });
    expect('format' in p).toBe(false);
  });
});

describe('visioKuitti: JSON-korjausyritys', () => {
  it('korjaa itsensä kun ensimmäinen vastaus ei jäsenny mutta toinen jäsentyy', async () => {
    const kutsuFn = vi.fn().mockResolvedValueOnce(RIKKI_JSON).mockResolvedValueOnce(KELPO_JSON);
    const kuitti = await visioKuitti(kuva, asetukset, kutsuFn);
    expect(kuitti).toEqual({ valuutta: 'EUR', alv: [] });
    expect(kutsuFn).toHaveBeenCalledTimes(2);
  });

  it('heittää VisioVirhe(jasennys) kun molemmat yritykset epäonnistuvat, korkeintaan yksi uusinta', async () => {
    // 'jasennys', ei 'tyhja': malli VASTASI (molemmilla kerroilla) ei-tyhjällä sisällöllä, se ei
    // vain koskaan jäsentynyt kelvolliseksi Kuitti-JSON:ksi — eri tapahtuma kuin aidosti tyhjä
    // vastaus (loppukatselmus finding #3).
    const kutsuFn = vi.fn().mockResolvedValue(RIKKI_JSON);
    await expect(visioKuitti(kuva, asetukset, kutsuFn)).rejects.toMatchObject({
      name: 'VisioVirhe',
      syy: 'jasennys',
    });
    expect(kutsuFn).toHaveBeenCalledTimes(2);
  });

  it('ei uusinnu kun ensimmäinen vastaus jäsentyy heti', async () => {
    const kutsuFn = vi.fn().mockResolvedValueOnce(KELPO_JSON);
    const kuitti = await visioKuitti(kuva, asetukset, kutsuFn);
    expect(kuitti).toEqual({ valuutta: 'EUR', alv: [] });
    expect(kutsuFn).toHaveBeenCalledTimes(1);
  });

  it('ei uusinnu budjetin loppuessa — VisioVirhe(budjetti) kulkee läpi sellaisenaan', async () => {
    const budjettiVirhe = new VisioVirhe('budjetti', 'malli ei palauttanut sisältöä (budjetti)');
    const kutsuFn = vi.fn().mockRejectedValueOnce(budjettiVirhe);
    await expect(visioKuitti(kuva, asetukset, kutsuFn)).rejects.toBe(budjettiVirhe);
    expect(kutsuFn).toHaveBeenCalledTimes(1);
  });

  it('käyttää eri "tilaa" uusintakutsulle ettei se osu ensimmäisen yrityksen välimuistiavaimeen', async () => {
    const kutsuFn = vi.fn().mockResolvedValueOnce(RIKKI_JSON).mockResolvedValueOnce(KELPO_JSON);
    await visioKuitti(kuva, asetukset, kutsuFn);
    const ensimmäisenTila = kutsuFn.mock.calls[0]?.[4];
    const uusinnanTila = kutsuFn.mock.calls[1]?.[4];
    expect(ensimmäisenTila).toBe('poiminta');
    expect(uusinnanTila).not.toBe(ensimmäisenTila);
  });
});

describe('kutsu: HTTP-tason virheet (finding #2, fetch mockattu — ei verkkoa)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('HTTP-virhevastaus (esim. muistivirhe Ollamalta) heittää VisioVirhe(kutsu), ei (tyhja)', async () => {
    // fetch ei heitä non-2xx-vastauksesta — Ollaman virherunko (esim. "model requires more
    // system memory") kulkisi muuten läpi tulkitseVastaukseen ja näyttäisi "mallilta ei
    // saatu sisältöä" -virheeltä. Palvelin/verkkovirhe on aina 'kutsu', ei koskaan 'tyhja'.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('{"error":"model requires more system memory"}'),
        json: () => Promise.reject(new Error('ei pitäisi kutsua')),
      } as unknown as Response),
    );
    await expect(visioKuitti(kuva, asetukset)).rejects.toMatchObject({
      name: 'VisioVirhe',
      syy: 'kutsu',
      message: expect.stringContaining('500'),
    });
  });

  it('verkkovirhe (fetch hylkää) heittää VisioVirhe(kutsu)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434')),
    );
    await expect(visioTeksti(kuva, asetukset)).rejects.toMatchObject({
      name: 'VisioVirhe',
      syy: 'kutsu',
    });
  });
});

describe('kutsuVälimuistilla: atominen kirjoitus (finding #7, fetch mockattu — ei verkkoa)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('kirjoittaa lopullisen tiedoston ilman jäljelle jääviä .tmp-tiedostoja', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vlm-cache-test-'));
    try {
      const fetchMock = vi.fn().mockResolvedValue(ollamaVastaus('rivi 1\nrivi 2'));
      vi.stubGlobal('fetch', fetchMock);

      const teksti = await visioTeksti(kuva, { ...asetukset, cacheDir: dir });
      expect(teksti).toBe('rivi 1\nrivi 2');

      const tiedostot = readdirSync(dir);
      expect(tiedostot).toHaveLength(1);
      expect(tiedostot[0]).toMatch(/\.txt$/);
      expect(tiedostot.some((t) => t.includes('.tmp-'))).toBe(false);
      const tiedosto = tiedostot[0];
      if (tiedosto !== undefined) {
        expect(readFileSync(join(dir, tiedosto), 'utf8')).toBe('rivi 1\nrivi 2');
      }

      // Toinen kutsu samoilla syötteillä osuu välimuistiin: fetch ei kutsuudu uudestaan.
      const teksti2 = await visioTeksti(kuva, { ...asetukset, cacheDir: dir });
      expect(teksti2).toBe('rivi 1\nrivi 2');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('OCR_KEHOTE (VLM-piikki §3c vika 1)', () => {
  it('vaatii rivinvaihtojen säilyttämisen: yksi tulostettu rivi per litteraattirivi', () => {
    expect(OCR_KEHOTE).toMatch(/own line/);
    expect(OCR_KEHOTE).toMatch(/line breaks/);
    expect(OCR_KEHOTE).toMatch(/Never join/);
    expect(OCR_KEHOTE).toMatch(/same visual row/); // otsikko ja summa samalle riville
  });

  it('kieltää arvojen laskemisen ja keksimisen mutta pyytää silti pelkkää tekstiä', () => {
    expect(OCR_KEHOTE).toMatch(/Do not calculate/);
    expect(OCR_KEHOTE).toMatch(/do not write one/);
    expect(OCR_KEHOTE).toMatch(/plain text only/);
  });

  it('lähetetään sellaisenaan ocr-tilassa', async () => {
    const hae = vi.fn().mockResolvedValue(ollamaVastaus('rivi 1\nrivi 2'));
    vi.stubGlobal('fetch', hae);
    await visioTeksti(kuva, asetukset);
    const runko = JSON.parse(String((hae.mock.calls[0]?.[1] as { body: string }).body)) as {
      messages: { content: string }[];
    };
    expect(runko.messages[0]?.content).toBe(OCR_KEHOTE);
  });
});
