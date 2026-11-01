import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  type MuistutusLaskentaSyote,
  OLETUS_MUISTUTUSMAKSU,
  laskeMaksumuistutus,
} from './maksumuistutus.js';

const c = (n: number) => n as Cents;

function syote(muutos: Partial<MuistutusLaskentaSyote> = {}): MuistutusLaskentaSyote {
  return {
    alkuperainen: { erapvm: '2026-04-30' },
    aiemmatMuistutukset: [],
    aiempiSaldo: c(100000),
    pvm: '2026-05-30',
    korko: true,
    viivkorko: 11.5,
    peruskorko: 2.5,
    yritysasiakas: false,
    ...muutos,
  };
}

/** Kuten `syote`, mutta ilman viivkorkoa (avainta ei ole, ei `undefined`-arvoa). */
function syoteIlmanViivkorkoa(
  muutos: Partial<MuistutusLaskentaSyote> = {},
): MuistutusLaskentaSyote {
  const { viivkorko: _pois, ...loput } = syote();
  return { ...loput, ...muutos };
}

describe('laskeMaksumuistutus', () => {
  it('perustapaus: korko eräpäivää seuraavasta päivästä muistutuspäivään', () => {
    expect(laskeMaksumuistutus(syote())).toEqual({
      maksu: 500,
      korko: 945,
      viivkorko: 11.5,
      korkoalkaa: '2026-05-01',
      korkoloppuu: '2026-05-30',
      aiempiSaldo: 100000,
    });
  });

  it('oletusmaksu on 5 euroa', () => {
    expect(OLETUS_MUISTUTUSMAKSU).toBe(500);
  });

  it('karkausvuosi jakaa 366:lla', () => {
    const t = laskeMaksumuistutus(
      syote({ alkuperainen: { erapvm: '2028-01-31' }, pvm: '2028-03-01' }),
    );
    expect(t.korkoalkaa).toBe('2028-02-01');
    expect(t.korko).toBe(943);
  });

  it('toinen muistutus: korko alkaa edellisen muistutuksen jälkeen, perusteena vain pääoma', () => {
    const t = laskeMaksumuistutus(
      syote({
        aiemmatMuistutukset: [{ pvm: '2026-05-30', maksu: c(500), korko: c(945) }],
        aiempiSaldo: c(101445),
        pvm: '2026-06-29',
      }),
    );
    expect(t.korkoalkaa).toBe('2026-05-31');
    expect(t.korko).toBe(945);
  });

  it('osittain maksettu: korko jäljellä olevasta saldosta', () => {
    expect(laskeMaksumuistutus(syote({ aiempiSaldo: c(40000) })).korko).toBe(378);
  });

  it('peruste ei mene negatiiviseksi', () => {
    const t = laskeMaksumuistutus(
      syote({
        aiemmatMuistutukset: [{ pvm: '2026-05-01', maksu: c(500), korko: c(945) }],
        aiempiSaldo: c(1000),
        pvm: '2026-06-01',
      }),
    );
    expect(t.korko).toBe(0);
  });

  it('korko 0, kun muistutuspäivä on ennen korkoalkaa', () => {
    const t = laskeMaksumuistutus(syote({ pvm: '2026-04-30' }));
    expect(t.korko).toBe(0);
    expect(t.korkoalkaa).toBe('2026-05-01');
  });

  it('korko 0 samana päivänä kuin eräpäivä, 1 päivä seuraavana', () => {
    expect(laskeMaksumuistutus(syote({ pvm: '2026-05-01' })).korko).toBe(
      Math.round((100000 * 1150) / (10000 * 365)),
    );
  });

  it('korko: false antaa koron 0 mutta ilmoittaa viivkorkon', () => {
    const t = laskeMaksumuistutus(syote({ korko: false }));
    expect(t.korko).toBe(0);
    expect(t.viivkorko).toBe(11.5);
  });

  it('oletuskorko: peruskorko + 7 kuluttajalle, + 8 yritykselle', () => {
    const o = { peruskorko: 2.5 };
    expect(laskeMaksumuistutus(syoteIlmanViivkorkoa(o)).viivkorko).toBe(9.5);
    expect(laskeMaksumuistutus(syoteIlmanViivkorkoa({ ...o, yritysasiakas: true })).viivkorko).toBe(
      10.5,
    );
  });

  it('laskun oma viivkorko voittaa oletuksen, dialogin arvo voittaa molemmat', () => {
    const o = { peruskorko: 2.5, yritysasiakas: true };
    expect(
      laskeMaksumuistutus(
        syoteIlmanViivkorkoa({ ...o, alkuperainen: { erapvm: '2026-04-30', viivkorko: 16 } }),
      ).viivkorko,
    ).toBe(16);
    expect(
      laskeMaksumuistutus(
        syote({
          ...o,
          viivkorko: 12,
          alkuperainen: { erapvm: '2026-04-30', viivkorko: 16 },
        }),
      ).viivkorko,
    ).toBe(12);
  });

  it('maksu 0 säilyy nollana', () => {
    expect(laskeMaksumuistutus(syote({ maksu: c(0) })).maksu).toBe(0);
  });

  it('pyöristää puolikkaan poispäin nollasta', () => {
    // 1825 * 1000 * 1 / 3 650 000 = 0,5 tasan -> 1
    expect(
      laskeMaksumuistutus(syote({ aiempiSaldo: c(1825), viivkorko: 10, pvm: '2026-05-01' })).korko,
    ).toBe(1);
  });
});
