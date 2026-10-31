import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JARJESTYKSEN_AVAIN,
  LISTALTA,
  listanNaapurit,
  lueListanJarjestys,
  onListalta,
  tallennaListanJarjestys,
  tyhjennaListanJarjestys,
} from './listanJarjestys';

afterEach(() => {
  vi.restoreAllMocks();
  tyhjennaListanJarjestys();
});

describe('listan järjestys', () => {
  it('ilman tallennusta järjestystä ei ole', () => {
    expect(lueListanJarjestys()).toBeNull();
  });

  it('tallentaa ja lukee järjestyksen; kaksoiskappaleista jää ensimmäinen', () => {
    tallennaListanJarjestys('kirjanpidossa', [5, 2, 9, 2]);
    expect(lueListanJarjestys()).toEqual({ bucket: 'kirjanpidossa', idt: [5, 2, 9] });
  });

  it('järjestys säilyy sessionStoragessa (sivun uudelleenlataus samassa ikkunassa)', () => {
    tallennaListanJarjestys('luonnos', [3, 1]);
    const raaka = window.sessionStorage.getItem(JARJESTYKSEN_AVAIN);
    // Uusi sivu: muistissa ei ole mitään, mutta sessionStorage on tallessa.
    tyhjennaListanJarjestys();
    window.sessionStorage.setItem(JARJESTYKSEN_AVAIN, raaka as string);
    expect(lueListanJarjestys()).toEqual({ bucket: 'luonnos', idt: [3, 1] });
  });

  it('vioittunut tallenne ei kaada, vaan järjestystä ei ole', () => {
    for (const roska of [
      '{ ei jsonia',
      'null',
      '[]',
      JSON.stringify({ bucket: 'tuntematon', idt: [1] }),
      JSON.stringify({ bucket: 'luonnos', idt: 'x' }),
      JSON.stringify({ bucket: 'luonnos', idt: [1, 'a', -2, 1.5] }),
    ]) {
      tyhjennaListanJarjestys();
      window.sessionStorage.setItem(JARJESTYKSEN_AVAIN, roska);
      expect(lueListanJarjestys()).toBeNull();
    }
  });

  it('toimii muistissa, kun sessionStorage heittää', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('estetty');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('estetty');
    });
    expect(() => tallennaListanJarjestys('kirjanpidossa', [4, 7])).not.toThrow();
    expect(lueListanJarjestys()).toEqual({ bucket: 'kirjanpidossa', idt: [4, 7] });
    expect(() => tyhjennaListanJarjestys()).not.toThrow();
    expect(lueListanJarjestys()).toBeNull();
  });
});

describe('listanNaapurit', () => {
  const jarjestys = { bucket: 'kirjanpidossa' as const, idt: [30, 10, 20, 40] };
  const kaikki = () => true;

  it('edellinen ja seuraava listan järjestyksessä; päissä null', () => {
    expect(listanNaapurit(jarjestys, 10, kaikki)).toEqual({ edellinen: 30, seuraava: 20 });
    expect(listanNaapurit(jarjestys, 30, kaikki)).toEqual({ edellinen: null, seuraava: 10 });
    expect(listanNaapurit(jarjestys, 40, kaikki)).toEqual({ edellinen: 20, seuraava: null });
  });

  it('listalta puuttuva tosite → null (käytetään numerojärjestystä)', () => {
    expect(listanNaapurit(jarjestys, 99, kaikki)).toBeNull();
    expect(listanNaapurit(null, 10, kaikki)).toBeNull();
  });

  it('ohittaa naapurit, joita ei enää ole (poistettu tai siirtynyt toiseen ryhmään)', () => {
    const olemassa = (id: number) => id !== 20 && id !== 30;
    expect(listanNaapurit(jarjestys, 10, olemassa)).toEqual({ edellinen: null, seuraava: 40 });
  });
});

describe('listalta-merkintä', () => {
  it('tunnistaa vain listan oman merkinnän', () => {
    expect(onListalta(LISTALTA)).toBe(true);
    expect(onListalta({ ...LISTALTA, __TSR_index: 3 })).toBe(true);
    for (const muu of [undefined, null, {}, { listalta: 'true' }, { __TSR_index: 1 }])
      expect(onListalta(muu)).toBe(false);
  });
});
