import { describe, expect, it, vi } from 'vitest';
import { luoEdistymisLaskuri } from './edistyminen.js';

const edistys = (file: string, loaded: number, total: number) => ({
  status: 'progress',
  name: 'malli',
  file,
  progress: total > 0 ? (loaded / total) * 100 : 0,
  loaded,
  total,
});

const kokonais = (loaded: number, total: number) => ({
  status: 'progress_total',
  name: 'malli',
  progress: total > 0 ? (loaded / total) * 100 : 0,
  loaded,
  total,
  files: {},
});

describe('luoEdistymisLaskuri', () => {
  it('antaa prosessorin tiedostoille vain pienen osan palkista', () => {
    const ilmoita = vi.fn();
    const laskuri = luoEdistymisLaskuri(ilmoita);
    laskuri(edistys('tokenizer.json', 50, 100));
    laskuri(edistys('tokenizer.json', 100, 100));
    laskuri(edistys('preprocessor_config.json', 10, 10));
    const arvot = ilmoita.mock.calls.map(([o]) => o);
    expect(arvot).toEqual([0.025, 0.05]);
  });

  it('ei jäädy 100 %:iin: palkki liikkuu painotiedostojen latauksen ajan ja ylettyy 1:een vasta lopussa', () => {
    const ilmoita = vi.fn();
    const laskuri = luoEdistymisLaskuri(ilmoita);
    // Prosessorin pienet tiedostot valmiiksi.
    laskuri(edistys('tokenizer.json', 100, 100));
    laskuri(edistys('config.json', 20, 20));
    // Mallin lataus: kirjasto kertoo ensin kaikki odotetut tiedostot (kokonaistavut),
    // sitten painot etenevät.
    const KOKO = 1000;
    laskuri(kokonais(20, KOKO));
    laskuri(edistys('malli.onnx', 0, 980));
    laskuri(kokonais(20, KOKO));
    laskuri(edistys('malli.onnx', 245, 980));
    laskuri(kokonais(265, KOKO));
    laskuri(edistys('malli.onnx', 490, 980));
    laskuri(kokonais(510, KOKO));
    laskuri(edistys('malli.onnx', 980, 980));
    laskuri(kokonais(1000, KOKO));

    const arvot: number[] = ilmoita.mock.calls.map(([o]) => o);
    const prosessoriPaattyy = arvot.indexOf(0.05);
    expect(prosessoriPaattyy).toBeGreaterThanOrEqual(0);
    const mallinAikana = arvot.slice(prosessoriPaattyy + 1);
    expect(mallinAikana.length).toBeGreaterThan(1);
    for (let i = 1; i < arvot.length; i++) expect(arvot[i]).toBeGreaterThan(arvot[i - 1] ?? 0);
    // 1 vasta aivan lopussa, ei aiemmin.
    expect(arvot.filter((o) => o >= 1)).toEqual([1]);
    expect(arvot.at(-1)).toBe(1);
    expect(mallinAikana.slice(0, -1).every((o) => o < 1)).toBe(true);
    // Puolivälissä painoja palkki on selvästi alle 100 %.
    expect(arvot).toContain(0.05 + 0.95 * 0.51);
  });

  it('ei pienene, vaikka kokonaisosuus tai tiedostokohtainen osuus ottaisi askeleen taakse', () => {
    const ilmoita = vi.fn();
    const laskuri = luoEdistymisLaskuri(ilmoita);
    laskuri(kokonais(500, 1000));
    laskuri(kokonais(400, 1000));
    laskuri(kokonais(500, 1000));
    laskuri(kokonais(600, 1000));
    // Mallin vaiheen alettua prosessorin tiedostoilmoitukset eivät enää vaikuta.
    laskuri(edistys('tokenizer.json', 100, 100));
    laskuri(edistys('malli.onnx', 900, 1000));
    expect(ilmoita.mock.calls.map(([o]) => o)).toEqual([0.05 + 0.95 * 0.5, 0.05 + 0.95 * 0.6]);
  });

  it('ohittaa tiedostokohtaiset ilmoitukset, jotka kirjasto toistaa kokonaisilmoituksen jälkeen', () => {
    const ilmoita = vi.fn();
    const laskuri = luoEdistymisLaskuri(ilmoita);
    laskuri(kokonais(100, 1000));
    laskuri(edistys('a', 1000, 1000));
    expect(ilmoita).toHaveBeenCalledTimes(1);
  });

  it('ohittaa muut tilat ja tyhjät kokonaisuudet', () => {
    const ilmoita = vi.fn();
    const laskuri = luoEdistymisLaskuri(ilmoita);
    laskuri({ status: 'initiate', file: 'a' });
    laskuri({ status: 'done', file: 'a' });
    laskuri(edistys('a', 0, 0));
    laskuri(kokonais(0, 0));
    expect(ilmoita).not.toHaveBeenCalled();
  });

  it('rajaa osuuden 1:een', () => {
    const ilmoita = vi.fn();
    const laskuri = luoEdistymisLaskuri(ilmoita);
    laskuri(kokonais(1200, 1000));
    expect(ilmoita.mock.calls.map(([o]) => o)).toEqual([1]);
  });
});
