import { describe, expect, it, vi } from 'vitest';
import { kirjatKasittelijat } from './kirjatSilta.js';

const OSOITE = 'http://127.0.0.1:4321';
const KIRJA = '/kirjat/oy.penni';
const TESTI = '/kirjat/oy-testi.penni';

function tapahtuma(url: string | null = `${OSOITE}/tositteet`) {
  return { senderFrame: url === null ? null : { url } };
}

function riippuvuudet() {
  return {
    annaOsoite: () => OSOITE,
    nykyinen: () => KIRJA,
    viimeisimmat: () => [KIRJA, TESTI],
    avaaKirja: vi.fn().mockResolvedValue(undefined),
    valitseJaAvaa: vi.fn().mockResolvedValue(undefined),
    poistaViimeisin: vi.fn(),
  };
}

describe('kirjatKasittelijat', () => {
  it('kertoo avoimen kirjan ja viimeisimmät', () => {
    const k = kirjatKasittelijat(riippuvuudet());
    expect(k.kirjat(tapahtuma())).toEqual({ nykyinen: KIRJA, viimeisimmat: [KIRJA, TESTI] });
  });

  it('vaihtaa viimeisimpien listalla olevaan kirjaan', async () => {
    const r = riippuvuudet();
    await kirjatKasittelijat(r).vaihda(tapahtuma(), TESTI);
    expect(r.avaaKirja).toHaveBeenCalledWith(TESTI);
  });

  it('hylkää polun, joka ei ole viimeisimpien listalla', async () => {
    const r = riippuvuudet();
    await expect(kirjatKasittelijat(r).vaihda(tapahtuma(), '/etc/passwd')).rejects.toThrow(
      /Pääsy estetty/,
    );
    expect(r.avaaKirja).not.toHaveBeenCalled();
  });

  it('avaa dialogin pääprosessissa', async () => {
    const r = riippuvuudet();
    await kirjatKasittelijat(r).valitse(tapahtuma());
    expect(r.valitseJaAvaa).toHaveBeenCalledOnce();
  });

  it('poistaa kirjan viimeisimmistä, mutta ei avointa kirjaa', () => {
    const r = riippuvuudet();
    const k = kirjatKasittelijat(r);
    k.poista(tapahtuma(), TESTI);
    expect(r.poistaViimeisin).toHaveBeenCalledWith(TESTI);
    expect(() => k.poista(tapahtuma(), KIRJA)).toThrow(/Avointa kirjanpitoa/);
    expect(() => k.poista(tapahtuma('https://example.com/'), TESTI)).toThrow(/IPC-kutsu hylättiin/);
    expect(r.poistaViimeisin).toHaveBeenCalledOnce();
  });

  it('hylkää kutsut vieraalta sivulta', async () => {
    const r = riippuvuudet();
    const k = kirjatKasittelijat(r);
    const vieras = tapahtuma('https://example.com/');
    expect(() => k.kirjat(vieras)).toThrow(/IPC-kutsu hylättiin/);
    await expect(k.vaihda(vieras, TESTI)).rejects.toThrow(/IPC-kutsu hylättiin/);
    await expect(k.valitse(tapahtuma(null))).rejects.toThrow(/IPC-kutsu hylättiin/);
    expect(r.avaaKirja).not.toHaveBeenCalled();
    expect(r.valitseJaAvaa).not.toHaveBeenCalled();
  });
});
