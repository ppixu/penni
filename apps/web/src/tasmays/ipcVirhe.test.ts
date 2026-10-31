import { describe, expect, it } from 'vitest';
import { siivoaIpcVirhe } from './ipcVirhe.js';

describe('siivoaIpcVirhe', () => {
  it('palauttaa viestin sellaisenaan kun IPC-etuliitettä ei ole', () => {
    expect(siivoaIpcVirhe('Kansiossa ei ole kuitteja: /tmp/kuitit')).toBe(
      'Kansiossa ei ole kuitteja: /tmp/kuitit',
    );
  });

  it('riisuu Electronin IPC-etuliitteen ja virheluokan nimen', () => {
    const raaka =
      "Error invoking remote method 'tasmays:lueAineisto': LukuVirhe: " +
      'Kansiossa ei ole kuitteja: /tmp/kuitit';
    expect(siivoaIpcVirhe(raaka)).toBe('Kansiossa ei ole kuitteja: /tmp/kuitit');
  });

  it('pudottaa pinolistauksen etuliitteen riisumisen jälkeen', () => {
    const raaka =
      "Error invoking remote method 'tasmays:lueAineisto': LukuVirhe: Virhe\n    at foo (bar.js:1:1)";
    expect(siivoaIpcVirhe(raaka)).toBe('Virhe');
  });

  it('säilyttää monirivisen viestin kun IPC-etuliitettä ei ole', () => {
    const raaka = 'Tallennus epäonnistui.\nKokeile uudelleen.';
    expect(siivoaIpcVirhe(raaka)).toBe(raaka);
  });

  it('riisuu myös pelkän Error-etuliitteen ilman omaa virheluokkaa', () => {
    const raaka = "Error invoking remote method 'tasmays:lueTiedosto': Error: ENOENT";
    expect(siivoaIpcVirhe(raaka)).toBe('ENOENT');
  });
});
