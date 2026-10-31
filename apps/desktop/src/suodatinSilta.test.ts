import { describe, expect, it, vi } from 'vitest';
import { suodatinKasittelijat } from './suodatinSilta.js';

const OSOITE = 'http://127.0.0.1:4321';
const tapahtuma = (url: string | null = `${OSOITE}/tositteet`) => ({
  senderFrame: url === null ? null : { url },
});

function riippuvuudet() {
  const varasto = {
    suodattimet: vi.fn(() => ({ tositteet: { bucket: 'luonnos' } })),
    tallennaSuodatin: vi.fn(),
  };
  return { varasto, r: { annaOsoite: () => OSOITE, asetukset: () => varasto } };
}

describe('suodatinKasittelijat', () => {
  it('lukee ja tallentaa näkymien suodatinvalinnat', () => {
    const { varasto, r } = riippuvuudet();
    const k = suodatinKasittelijat(r);
    expect(k.lue(tapahtuma())).toEqual({ tositteet: { bucket: 'luonnos' } });
    k.tallenna(tapahtuma(), 'tositteet', { bucket: 'poistetut' });
    expect(varasto.tallennaSuodatin).toHaveBeenCalledWith('tositteet', { bucket: 'poistetut' });
  });

  it('hylkää kutsut vieraalta sivulta', () => {
    const { varasto, r } = riippuvuudet();
    const k = suodatinKasittelijat(r);
    expect(() => k.lue(tapahtuma('https://example.com/'))).toThrow();
    expect(() => k.tallenna(tapahtuma(null), 'tositteet', {})).toThrow();
    expect(varasto.suodattimet).not.toHaveBeenCalled();
    expect(varasto.tallennaSuodatin).not.toHaveBeenCalled();
  });

  it('hylkää kutsut, kun kirjaa ei ole auki', () => {
    const { varasto } = riippuvuudet();
    const k = suodatinKasittelijat({ annaOsoite: () => undefined, asetukset: () => varasto });
    expect(() => k.lue(tapahtuma())).toThrow();
  });
});
