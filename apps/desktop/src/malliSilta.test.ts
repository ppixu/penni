import { describe, expect, it, vi } from 'vitest';
import { malliKasittelijat } from './malliSilta.js';

const OSOITE = 'http://127.0.0.1:4321';
const tapahtuma = (url: string | null = `${OSOITE}/tositteet/uusi`) => ({
  senderFrame: url === null ? null : { url },
});

function riippuvuudet(lupa = false) {
  const varasto = { malliLupa: vi.fn(() => lupa), annaMalliLupa: vi.fn() };
  return { varasto, r: { annaOsoite: () => OSOITE, asetukset: () => varasto } };
}

describe('malliKasittelijat', () => {
  it('kertoo ja tallentaa suostumuksen', () => {
    const { varasto, r } = riippuvuudet(true);
    const k = malliKasittelijat(r);
    expect(k.lupa(tapahtuma())).toBe(true);
    k.annaLupa(tapahtuma());
    expect(varasto.annaMalliLupa).toHaveBeenCalledOnce();
  });

  it('hylkää kutsut vieraalta sivulta', () => {
    const { varasto, r } = riippuvuudet();
    const k = malliKasittelijat(r);
    expect(() => k.annaLupa(tapahtuma('https://example.com/'))).toThrow();
    expect(varasto.annaMalliLupa).not.toHaveBeenCalled();
  });
});
