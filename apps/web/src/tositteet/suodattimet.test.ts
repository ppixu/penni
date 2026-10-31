import { muistinAvain } from '@/lib/muisti';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OLETUSSUODATTIMET,
  type TositeSuodattimet,
  lueTositeSuodattimet,
  tallennaTositeSuodattimet,
  tulkitseSuodattimet,
} from './suodattimet';

const AVAIN = muistinAvain('tositteet');

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('tositelistan suodatinmuisti', () => {
  it('palauttaa tallennetut valinnat', () => {
    const s: TositeSuodattimet = {
      bucket: 'luonnos',
      laji: 'menot',
      maksutila: 'avoimet',
      valinta: 'q2',
      oma: { alkupvm: '', loppupvm: '' },
      jarj: 'summa',
      suunta: 'nouseva',
    };
    tallennaTositeSuodattimet(s);
    expect(lueTositeSuodattimet()).toEqual(s);
  });

  it('säilyttää käsin syötetyn välin päivinä', () => {
    tallennaTositeSuodattimet({
      ...OLETUSSUODATTIMET,
      valinta: null,
      oma: { alkupvm: '2026-02-01', loppupvm: '2026-02-28' },
    });
    expect(lueTositeSuodattimet()).toMatchObject({
      valinta: null,
      oma: { alkupvm: '2026-02-01', loppupvm: '2026-02-28' },
    });
  });

  it('muistaa kuukausinapin ja Tämä vuosi -valinnan', () => {
    for (const valinta of ['m09', 'tilikausi'] as const) {
      tallennaTositeSuodattimet({ ...OLETUSSUODATTIMET, valinta });
      expect(lueTositeSuodattimet().valinta).toBe(valinta);
    }
  });

  it('käyttää oletuksia kun muistia ei ole', () => {
    expect(lueTositeSuodattimet()).toEqual(OLETUSSUODATTIMET);
  });

  it('pudottaa tuntemattomat ja vioittuneet kentät oletukseen kenttä kerrallaan', () => {
    window.localStorage.setItem(
      AVAIN,
      JSON.stringify({
        bucket: 'roskakori',
        laji: 'tulot',
        maksutila: 42,
        valinta: 'q9',
        oma: { alkupvm: 'eilen', loppupvm: '2026-01-31' },
        jarj: 'summa',
        suunta: 'sivuttain',
      }),
    );
    expect(lueTositeSuodattimet()).toEqual({
      ...OLETUSSUODATTIMET,
      laji: 'tulot',
      oma: { alkupvm: '', loppupvm: '2026-01-31' },
    });
  });

  it('kestää rikkinäisen JSONin ja ei-olion', () => {
    window.localStorage.setItem(AVAIN, '{rikki');
    expect(lueTositeSuodattimet()).toEqual(OLETUSSUODATTIMET);
    expect(tulkitseSuodattimet('teksti')).toEqual(OLETUSSUODATTIMET);
    expect(tulkitseSuodattimet(null)).toEqual(OLETUSSUODATTIMET);
  });

  it('toimii vaikka localStorage heittäisi', () => {
    // Estetty sivustodata: jo localStorage-olion haku heittää (SecurityError).
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => tallennaTositeSuodattimet({ ...OLETUSSUODATTIMET, laji: 'menot' })).not.toThrow();
    expect(lueTositeSuodattimet()).toEqual(OLETUSSUODATTIMET);
  });
});
