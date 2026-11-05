import { readFileSync } from 'node:fs';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi } from '../alv/koodit.js';
import { tallennaMyyntilasku, tallennaSuoritus, tiliAsetuksesta } from './myyntilaskuResource.js';

describe('tiliAsetuksesta: kirjoitusasut', () => {
  it.each([
    ['LaskuSaatavaTili', 'LaskuSaatavatili'],
    ['AlvVelkaTili', 'AlvVelkatili'],
    ['OstoVelkaTili', 'Ostovelkatili'],
  ])('%s: tilikarttapohjan asu %s toimii yksin', (avain, pohja) => {
    expect(tiliAsetuksesta({ [pohja]: '1234' }, avain)).toBe(1234);
  });

  it.each([
    ['LaskuSaatavaTili', 'LaskuSaatavaTili'],
    ['AlvVelkaTili', 'AlvVelkaTili'],
    ['OstoVelkaTili', 'OstoVelkaTili'],
  ])('%s: vanha asu toimii yksin', (avain, vanha) => {
    expect(tiliAsetuksesta({ [vanha]: '4321' }, avain)).toBe(4321);
  });

  it.each([
    ['LaskuSaatavaTili', 'LaskuSaatavatili', 'LaskuSaatavaTili'],
    ['AlvVelkaTili', 'AlvVelkatili', 'AlvVelkaTili'],
    ['OstoVelkaTili', 'Ostovelkatili', 'OstoVelkaTili'],
  ])('%s: pohjan asu voittaa, kun molemmat ovat eri arvoisia', (avain, pohja, vanha) => {
    expect(tiliAsetuksesta({ [pohja]: '1111', [vanha]: '2222' }, avain)).toBe(1111);
  });

  it('tyhjä pohjan arvo ei peitä vanhaa asua', () => {
    expect(
      tiliAsetuksesta({ LaskuSaatavatili: '', LaskuSaatavaTili: '1701' }, 'LaskuSaatavaTili'),
    ).toBe(1701);
  });

  it('LaskuMaksutili putoaa LaskuTilit-listan ensimmäiseen tiliin', () => {
    expect(tiliAsetuksesta({ LaskuTilit: '1910' }, 'LaskuMaksutili')).toBe(1910);
    expect(tiliAsetuksesta({ LaskuTilit: '1910 1920 1930' }, 'LaskuMaksutili')).toBe(1910);
    expect(tiliAsetuksesta({ LaskuTilit: ' 1910, 1920' }, 'LaskuMaksutili')).toBe(1910);
    expect(tiliAsetuksesta({ LaskuTilit: 'x 1920' }, 'LaskuMaksutili')).toBe(1920);
    expect(tiliAsetuksesta({ LaskuTilit: '' }, 'LaskuMaksutili')).toBeUndefined();
  });

  it('LaskuMaksutili voittaa LaskuTilit-listan', () => {
    expect(tiliAsetuksesta({ LaskuMaksutili: '1900', LaskuTilit: '1910' }, 'LaskuMaksutili')).toBe(
      1900,
    );
  });

  it('muut avaimet toimivat kuten ennen', () => {
    expect(tiliAsetuksesta({ OletusMyyntitili: '3000' }, 'OletusMyyntitili')).toBe(3000);
    expect(tiliAsetuksesta({}, 'OletusMyyntitili')).toBeUndefined();
  });
});

describe('laskutus oikean tilikarttapohjan asetuksilla', () => {
  const pohja = JSON.parse(
    readFileSync(new URL('../../../../charts/yritys/asetukset.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const avaimet = [
    'LaskuSaatavatili',
    'AlvVelkatili',
    'Ostovelkatili',
    'LaskuTilit',
    'OletusMyyntitili',
  ];
  const asetukset = Object.fromEntries(avaimet.map((k) => [k, String(pohja[k])]));

  const seed = () =>
    createMemoryStorage({
      tilit: [
        { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
        { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
        { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { AlvVelvollinen: 'true', ...asetukset },
    });
  const env = { aika: '2026-06-01T00:00:00.000Z' };

  it('pohjassa ei ole vanhoja avaimia', () => {
    expect(asetukset).not.toHaveProperty('LaskuSaatavaTili');
    expect(asetukset.LaskuSaatavatili).toBe('1701');
  });

  it('tallennaMyyntilasku kirjaa ja tallennaSuoritus käyttää LaskuTilit-tiliä', async () => {
    const s = seed();
    const lasku = await tallennaMyyntilasku(
      s,
      {
        pvm: '2026-06-01',
        rivit: [
          { myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 },
        ],
      },
      env,
    );
    expect(lasku.tila).toBe(100);
    expect(lasku.viennit.find((v) => v.tili === 1701)?.debet).toBe(12550);
    expect(lasku.viennit.find((v) => v.tili === 2939)?.kredit).toBe(2550);

    const suoritus = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-10', summa: Euro.fromCents(12550) },
      env,
    );
    expect(suoritus.viennit.some((v) => v.tili === 1910)).toBe(true);
  });
});
