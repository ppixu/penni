import { afterEach, describe, expect, it } from 'vitest';
import { annaTasmaysSilta, onkoTasmaysSilta } from './silta';

afterEach(() => {
  window.penni = undefined;
});

describe('täsmäytyssilta', () => {
  it('ei ole käytettävissä selaimessa', () => {
    expect(onkoTasmaysSilta()).toBe(false);
    expect(() => annaTasmaysSilta()).toThrow(/työpöytäsovelluksessa/);
  });

  it('on käytettävissä kun silta tarjoaa täsmäytysmetodit', () => {
    window.penni = {
      valitseJaLue: async () => null,
      tuo: async () => null,
      avaaKirja: async () => undefined,
      valitseTiliote: async () => null,
      valitseKuittikansio: async () => null,
      lueAineisto: async () => ({
        tiliote: { tiedosto: '', tapahtumat: [] },
        kuitit: [],
        lukematta: [],
      }),
      lueTiedosto: async () => new Uint8Array(),
    } as unknown as typeof window.penni;
    expect(onkoTasmaysSilta()).toBe(true);
  });
});
