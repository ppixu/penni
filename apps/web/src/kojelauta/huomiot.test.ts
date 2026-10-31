import type { Tilikausi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { type HuomioSyote, kojelaudanHuomiot } from './huomiot.js';

const K25 = { alkaa: '2025-01-01', loppuu: '2025-12-31' } as Tilikausi;
const K26 = { alkaa: '2026-01-01', loppuu: '2026-12-31' } as Tilikausi;

function syote(muutos: Partial<HuomioSyote> = {}): HuomioSyote {
  return {
    tanaan: '2026-10-25',
    asetukset: { AlvVelvollinen: 'false' },
    tilikaudet: [K25, K26],
    kausiKk: 3,
    alvIlmoitettuAsti: undefined,
    luonnoksia: 0,
    vastaavaa: 100,
    vastattavaa: 100,
    ...muutos,
  };
}

const avaimet = (s: HuomioSyote) => kojelaudanHuomiot(s).map((h) => h.avain);

describe('kojelaudanHuomiot', () => {
  it('kunnossa olevassa kirjassa ei huomioita', () => {
    expect(
      avaimet(syote({ asetukset: { AlvVelvollinen: 'false', TilitPaatetty: '2025-12-31' } })),
    ).toEqual([]);
  });

  it('tase ei täsmää on virhe ja ylimpänä', () => {
    const h = kojelaudanHuomiot(syote({ vastaavaa: 100, vastattavaa: 90, luonnoksia: 2 }));
    expect(h[0]).toMatchObject({ avain: 'tase', taso: 'virhe' });
  });

  it('alv: myöhässä oleva ilmoitus on varoitus', () => {
    // Q2 2026 erääntyi 12.8.2026.
    const h = kojelaudanHuomiot(
      syote({ asetukset: { AlvVelvollinen: 'true' }, alvIlmoitettuAsti: '2026-03-31' }),
    );
    expect(h.find((x) => x.avain === 'alv')).toMatchObject({
      taso: 'varoitus',
      otsikko: 'Arvonlisäveroilmoitus myöhässä',
    });
  });

  it('alv: alle 12 pv eräpäivään on vinkki, kauempana ei mitään', () => {
    // Q3 2026 erääntyy 12.11.2026.
    const alv = { asetukset: { AlvVelvollinen: 'true' }, alvIlmoitettuAsti: '2026-06-30' };
    expect(avaimet(syote({ ...alv, tanaan: '2026-11-05' }))).toContain('alv');
    expect(avaimet(syote({ ...alv, tanaan: '2026-10-25' }))).not.toContain('alv');
  });

  it('luonnokset näkyvät määränä', () => {
    expect(kojelaudanHuomiot(syote({ luonnoksia: 3 }))[0]?.otsikko).toBe(
      '3 tositetta on luonnoksena',
    );
  });

  it('uusi tilikausi alle 30 pv ennen viimeisen kauden loppua', () => {
    expect(avaimet(syote({ tanaan: '2026-12-10' }))).toContain('uusikausi');
    expect(avaimet(syote({ tanaan: '2026-11-20' }))).not.toContain('uusikausi');
  });

  it('tilinpäätös 2 pv – 5 kk kauden jälkeen, ellei kautta ole lukittu', () => {
    expect(avaimet(syote({ tanaan: '2026-03-01' }))).toContain('tilinpaatos-2025-01-01');
    expect(
      avaimet(syote({ tanaan: '2026-03-01', asetukset: { TilitPaatetty: '2025-12-31' } })),
    ).not.toContain('tilinpaatos-2025-01-01');
    expect(avaimet(syote({ tanaan: '2026-07-01' }))).not.toContain('tilinpaatos-2025-01-01');
  });
});
