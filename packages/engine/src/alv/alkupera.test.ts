import { describe, expect, it } from 'vitest';
import { alkuperaKoodista, alkuperaMaasta, tositteenAlkupera } from './alkupera.js';
import { AlvKoodi, alvKoodilla } from './koodit.js';

const v = (alvKoodi: number) => ({ alvKoodi });

describe('alkuperaKoodista', () => {
  it.each([
    [AlvKoodi.MYYNNIT_NETTO, 'kotimaa'],
    [AlvKoodi.MYYNNIT_BRUTTO, 'kotimaa'],
    [AlvKoodi.OSTOT_NETTO, 'kotimaa'],
    [AlvKoodi.OSTOT_BRUTTO, 'kotimaa'],
    [AlvKoodi.MYYNNIT_MARGINAALI, 'kotimaa'],
    [AlvKoodi.OSTOT_MARGINAALI, 'kotimaa'],
    [AlvKoodi.MAKSUPERUSTEINEN_MYYNTI, 'kotimaa'],
    [AlvKoodi.MAKSUPERUSTEINEN_OSTO, 'kotimaa'],
    [AlvKoodi.RAKENNUSPALVELU_MYYNTI, 'kotimaa'],
    [AlvKoodi.RAKENNUSPALVELU_OSTO, 'kotimaa'],
    [AlvKoodi.YHTEISOMYYNTI_TAVARAT, 'eu'],
    [AlvKoodi.YHTEISOMYYNTI_PALVELUT, 'eu'],
    [AlvKoodi.YHTEISOHANKINNAT_TAVARAT, 'eu'],
    [AlvKoodi.YHTEISOHANKINNAT_PALVELUT, 'eu'],
    [27, 'muu'], // MAAHANTUONTI (kitsas.h:40)
    [AlvKoodi.MAAHANTUONTI_PALVELUT, 'muu'],
    [927, 'muu'], // MAAHANTUONTI_VERO (kitsas.h:50)
  ] as const)('%i → %s', (koodi, alkupera) => {
    expect(alkuperaKoodista(koodi)).toBe(alkupera);
  });

  it('luokittelee vero- ja vähennysviennit peruskoodinsa mukaan', () => {
    expect(alkuperaKoodista(alvKoodilla(AlvKoodi.MYYNNIT_NETTO, AlvKoodi.ALVKIRJAUS))).toBe(
      'kotimaa',
    );
    expect(
      alkuperaKoodista(alvKoodilla(AlvKoodi.YHTEISOHANKINNAT_PALVELUT, AlvKoodi.ALVVAHENNYS)),
    ).toBe('eu');
    expect(alkuperaKoodista(alvKoodilla(AlvKoodi.MAAHANTUONTI_PALVELUT, AlvKoodi.ALVKIRJAUS))).toBe(
      'muu',
    );
    expect(
      alkuperaKoodista(
        alvKoodilla(AlvKoodi.MYYNNIT_NETTO, AlvKoodi.MAKSUPERUSTEINEN_KOHDENTAMATON),
      ),
    ).toBe('kotimaa');
  });

  it.each([
    [AlvKoodi.EIALV, 'veroton'],
    [AlvKoodi.ALV0, '0-verokanta kattaa myös viennin EU:n ulkopuolelle (alvlaskelma.cpp:175)'],
    [901, 'tilitys'],
    [AlvKoodi.VAHENNYSKELVOTON, 'vähennyskelvoton'],
  ])('%i ei luokittele (%s)', (koodi) => {
    expect(alkuperaKoodista(koodi)).toBeUndefined();
  });
});

describe('alkuperaMaasta', () => {
  it('Suomi on kotimaa, EU-jäsen EU, muu muualla; kirjainkoolla ei väliä', () => {
    expect(alkuperaMaasta('fi')).toBe('kotimaa');
    expect(alkuperaMaasta('FI')).toBe('kotimaa');
    expect(alkuperaMaasta('se')).toBe('eu');
    expect(alkuperaMaasta('EE')).toBe('eu');
    expect(alkuperaMaasta('gr')).toBe('eu');
    expect(alkuperaMaasta('el')).toBe('eu'); // Kreikan EU-alv-etuliite
    expect(alkuperaMaasta('us')).toBe('muu');
    expect(alkuperaMaasta('gb')).toBe('muu');
    expect(alkuperaMaasta('no')).toBe('muu');
  });

  it('tyhjä tai tuntematon muoto ei luokittele', () => {
    expect(alkuperaMaasta('')).toBeUndefined();
    expect(alkuperaMaasta('suomi')).toBeUndefined();
  });
});

describe('tositteenAlkupera', () => {
  it('vientien alv-koodi ratkaisee', () => {
    expect(tositteenAlkupera([v(AlvKoodi.OSTOT_NETTO), v(0)])).toBe('kotimaa');
    expect(tositteenAlkupera([v(AlvKoodi.YHTEISOHANKINNAT_PALVELUT), v(0)])).toBe('eu');
  });

  it('ulkomaisin luokka voittaa (muu > eu > kotimaa)', () => {
    expect(tositteenAlkupera([v(AlvKoodi.OSTOT_NETTO), v(AlvKoodi.YHTEISOHANKINNAT_TAVARAT)])).toBe(
      'eu',
    );
    expect(
      tositteenAlkupera([v(AlvKoodi.YHTEISOHANKINNAT_TAVARAT), v(AlvKoodi.MAAHANTUONTI_PALVELUT)]),
    ).toBe('muu');
  });

  it('ilman luokittelevaa koodia käytetään kumppanin maata', () => {
    expect(tositteenAlkupera([v(0), v(0)], 'de')).toBe('eu');
    expect(tositteenAlkupera([v(AlvKoodi.ALV0)], 'us')).toBe('muu');
    expect(tositteenAlkupera([v(0)], 'fi')).toBe('kotimaa');
  });

  it('alv-koodi voittaa kumppanin maan', () => {
    expect(tositteenAlkupera([v(AlvKoodi.OSTOT_NETTO)], 'us')).toBe('kotimaa');
  });

  it('ei mitään kun koodeja eikä maata ole', () => {
    expect(tositteenAlkupera([v(0)])).toBeUndefined();
    expect(tositteenAlkupera([])).toBeUndefined();
  });
});
