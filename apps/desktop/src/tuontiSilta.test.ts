import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KitsasYhteenveto } from '@penni/tuonti';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { TuonninTulos } from './tuoKirja.js';
import { type TuontiDialogi, tuontiKasittelijat } from './tuontiSilta.js';

const OSOITE = 'http://127.0.0.1:4321';

function tapahtuma(url: string | null = `${OSOITE}/tuonti`) {
  return { senderFrame: url === null ? null : { url }, sender: { send: vi.fn() } };
}

const juuri = mkdtempSync(join(tmpdir(), 'penni-tuontiSilta-'));
afterAll(() => rmSync(juuri, { recursive: true, force: true }));
const lahde = join(juuri, 'oy.kitsas');
const kohde = join(juuri, 'kirjanpito.penni');
const muuKirja = join(juuri, 'muu.penni');
const linkki = join(juuri, 'linkki.kitsas');
writeFileSync(lahde, 'kitsas');
writeFileSync(muuKirja, 'muu');
symlinkSync(muuKirja, linkki);

function dialogi(): TuontiDialogi {
  return {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [lahde] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: kohde }),
  };
}

function riippuvuudet() {
  return {
    annaOsoite: () => OSOITE,
    avaaKirja: vi.fn().mockResolvedValue(undefined),
    esikatsele: vi.fn(() => ({}) as KitsasYhteenveto),
    tuo: vi.fn(async (_lahde: string, k: string) => {
      writeFileSync(k, 'penni');
      return { kohde: k } as TuonninTulos;
    }),
  };
}

describe('tuontiKasittelijat', () => {
  it('koko polku: valitse → suorita → avaa', async () => {
    const r = riippuvuudet();
    const k = tuontiKasittelijat(dialogi(), r);
    expect(await k.valitse(tapahtuma())).toEqual({ polku: lahde, yhteenveto: {} });
    expect((await k.suorita(tapahtuma(), lahde))?.kohde).toBe(kohde);
    expect(r.tuo).toHaveBeenCalledWith(lahde, kohde, expect.any(Function));
    await k.avaa(tapahtuma(), kohde);
    expect(r.avaaKirja).toHaveBeenCalledWith(kohde);
  });

  it('suorita hylkää lähteen, jota ei valittu dialogista, avaamatta tallennusdialogia', async () => {
    const r = riippuvuudet();
    const d = dialogi();
    const k = tuontiKasittelijat(d, r);
    await k.valitse(tapahtuma());
    await expect(k.suorita(tapahtuma(), muuKirja)).rejects.toThrow(/Pääsy estetty/);
    await expect(k.suorita(tapahtuma(), `${juuri}/x/../muu.penni`)).rejects.toThrow(
      /Pääsy estetty/,
    );
    await expect(k.suorita(tapahtuma(), linkki)).rejects.toThrow(/Pääsy estetty/);
    expect(d.showSaveDialog).not.toHaveBeenCalled();
    expect(r.tuo).not.toHaveBeenCalled();
  });

  it('avaa hylkää kirjan, jota ei tuotu tässä istunnossa', async () => {
    const r = riippuvuudet();
    const k = tuontiKasittelijat(dialogi(), r);
    await expect(k.avaa(tapahtuma(), muuKirja)).rejects.toThrow(/Pääsy estetty/);
    await expect(k.avaa(tapahtuma(), join(juuri, 'uusi.penni'))).rejects.toThrow(/Pääsy estetty/);
    expect(r.avaaKirja).not.toHaveBeenCalled();
  });

  it('hylkää vieraan lähettäjän kaikissa kanavissa', async () => {
    const r = riippuvuudet();
    const d = dialogi();
    const k = tuontiKasittelijat(d, r);
    await k.valitse(tapahtuma());
    await k.suorita(tapahtuma(), lahde);
    const vieras = tapahtuma('http://127.0.0.1:9999/');
    await expect(k.valitse(vieras)).rejects.toThrow(/IPC-kutsu hylättiin/);
    await expect(k.suorita(vieras, lahde)).rejects.toThrow(/IPC-kutsu hylättiin/);
    await expect(k.avaa(tapahtuma(null), kohde)).rejects.toThrow(/IPC-kutsu hylättiin/);
    expect(d.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(r.avaaKirja).not.toHaveBeenCalled();
  });
});
