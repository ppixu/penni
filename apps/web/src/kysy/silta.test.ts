import { afterEach, describe, expect, it } from 'vitest';
import { annaKysySilta, onkoKysySilta } from './silta';

afterEach(() => {
  window.penni = undefined;
});

describe('kysysilta', () => {
  it('ei ole käytettävissä selaimessa', () => {
    expect(onkoKysySilta()).toBe(false);
    expect(() => annaKysySilta()).toThrow(/työpöytäsovelluksessa/);
  });

  it('ei ole käytettävissä kun silta ei tarjoa kysy-metodia (vanha työpöytäversio)', () => {
    window.penni = {
      valitseJaLue: async () => null,
      tuo: async () => null,
      avaaKirja: async () => undefined,
    } as unknown as typeof window.penni;
    expect(onkoKysySilta()).toBe(false);
  });

  it('on käytettävissä kun silta tarjoaa kysy-metodin', () => {
    window.penni = {
      valitseJaLue: async () => null,
      tuo: async () => null,
      avaaKirja: async () => undefined,
      kysyTila: async () => ({ ok: true, malli: 'qwen3.5:2b' }),
      kysy: async () => {},
      kysyPeruuta: async () => {},
    } as unknown as typeof window.penni;
    expect(onkoKysySilta()).toBe(true);
    expect(annaKysySilta()).toBe(window.penni);
  });
});
