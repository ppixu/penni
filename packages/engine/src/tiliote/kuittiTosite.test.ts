import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { type Tili, lataaKartta } from '../accounts/tili.js';
import { AlvKoodi } from '../alv/koodit.js';
import { type Kohdennus, KohdennusTyyppi } from '../kohdennukset/kohdennus.js';
import type { Kuitti } from '../kuitti/kuitti.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import type { TositeVienti } from '../vouchers/types.js';
import { luoTositeMatchista, luoTositeValinnasta, paatteleMenotili } from './kuittiTosite.js';
import type { Tilitapahtuma } from './poimiTiliote.js';

const CHART: Tili[] = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  { numero: 7570, tyyppi: 'D', nimi: { fi: 'Atk-kulut' } },
]);

const e = (s: string): Cents => Euro.fromString(s);
const debet = (v: TositeVienti[]): number => v.reduce((s, x) => s + x.debet, 0);
const kredit = (v: TositeVienti[]): number => v.reduce((s, x) => s + x.kredit, 0);

function kuitti(osa: Partial<Kuitti>): Kuitti {
  return { valuutta: 'EUR', alv: [], ...osa };
}

describe('luoTositeMatchista', () => {
  it('kotimaan osto (25,5 %): netto menotilille, alv saatavaan, brutto pankista', () => {
    const tapahtuma: Tilitapahtuma = {
      pvm: '2026-05-04',
      nimi: 'VERKKOKAUPPA',
      maara: e('-999.00'),
    };
    const k = kuitti({
      bruttoSumma: e('999.00'),
      alv: [{ kanta: 25.5, netto: e('796.02'), vero: e('202.98'), brutto: e('999.00') }],
    });
    const t = luoTositeMatchista(tapahtuma, k, CHART);
    expect(t.tyyppi).toBe(TositeTyyppi.MENO);
    expect(t.tila).toBe(TositeTila.LUONNOS);
    expect(debet(t.viennit)).toBe(kredit(t.viennit)); // tasapaino
    expect(t.viennit.find((v) => v.tili === 4000)?.debet).toBe(e('796.02'));
    expect(t.viennit.find((v) => v.tili === 1763)?.debet).toBe(e('202.98'));
    expect(t.viennit.find((v) => v.tili === 1910)?.kredit).toBe(e('999.00'));
  });

  it('kotimaan myyntitulo (0 %): brutto myyntitilille, brutto pankkiin', () => {
    const tapahtuma: Tilitapahtuma = {
      pvm: '2026-04-28',
      nimi: 'Revontuli Oy',
      viite: '412000012',
      maara: e('8764.20'),
    };
    const k = kuitti({ bruttoSumma: e('8764.20'), alv: [{ kanta: 0, brutto: e('8764.20') }] });
    const t = luoTositeMatchista(tapahtuma, k, CHART);
    expect(t.tyyppi).toBe(TositeTyyppi.TULO);
    expect(debet(t.viennit)).toBe(kredit(t.viennit));
    expect(t.viennit.find((v) => v.tili === 3000)?.kredit).toBe(e('8764.20'));
    expect(t.viennit.find((v) => v.tili === 1910)?.debet).toBe(e('8764.20'));
    expect(t.viite).toBe('412000012');
  });

  it('ilman alv-erittelyä: koko brutto verottomana menotilille (tasapainossa)', () => {
    const tapahtuma: Tilitapahtuma = { pvm: '2026-04-16', nimi: 'GITHUB', maara: e('-6.03') };
    const t = luoTositeMatchista(tapahtuma, kuitti({ bruttoSumma: e('6.03') }), CHART);
    expect(debet(t.viennit)).toBe(kredit(t.viennit));
    expect(t.viennit.find((v) => v.tili === 4000)?.debet).toBe(e('6.03'));
    expect(t.viennit.find((v) => v.tili === 1910)?.kredit).toBe(e('6.03'));
  });

  it('palveluosto EU:n ulkopuolelta (US): käänteinen alv 25,5 %, koodi 29, pankki maksaa netton', () => {
    const tapahtuma: Tilitapahtuma = {
      pvm: '2026-04-07',
      nimi: 'PILVIPALVELU',
      maara: e('-20.00'),
    };
    const k = kuitti({
      bruttoSumma: e('20.00'),
      alv: [{ kanta: 0, brutto: e('20.00') }],
      kaanteinenAlv: true,
      alue: 'MUU',
    });
    const t = luoTositeMatchista(tapahtuma, k, CHART);
    expect(debet(t.viennit)).toBe(kredit(t.viennit)); // tasapaino
    expect(t.viennit.find((v) => v.tili === 4000)).toMatchObject({
      debet: e('20.00'),
      alvKoodi: 29,
    });
    expect(t.viennit.find((v) => v.tili === 1763)?.debet).toBe(e('5.10')); // vähennettävä ALV
    expect(t.viennit.find((v) => v.tili === 2939)?.kredit).toBe(e('5.10')); // suoritettava ALV
    expect(t.viennit.find((v) => v.tili === 1910)?.kredit).toBe(e('20.00')); // pankki: netto
  });

  it('EU-palveluosto: käänteinen alv koodilla 25', () => {
    const tapahtuma: Tilitapahtuma = { pvm: '2026-05-07', nimi: 'MALLISIVU', maara: e('-23.47') };
    const k = kuitti({
      bruttoSumma: e('23.47'),
      alv: [{ kanta: 0, brutto: e('23.47') }],
      kaanteinenAlv: true,
      alue: 'EU',
    });
    const t = luoTositeMatchista(tapahtuma, k, CHART);
    expect(debet(t.viennit)).toBe(kredit(t.viennit));
    expect(t.viennit.find((v) => v.tili === 4000)?.alvKoodi).toBe(25);
  });

  it('valuuttaero: kirjaa pankin euromäärän, ei kuitin vierasvaluuttaista summaa', () => {
    // Kuitti 25,00 USD, mutta pankki veloitti 23,47 EUR (nimitäsmäys). Pankki ratkaisee summan.
    const tapahtuma: Tilitapahtuma = {
      pvm: '2026-05-07',
      nimi: 'MALLISIVU SYSTEMS OU',
      maara: e('-23.47'),
    };
    const k = kuitti({
      valuutta: 'USD',
      bruttoSumma: e('25.00'),
      alv: [{ kanta: 0, brutto: e('25.00') }],
      kaanteinenAlv: true,
      alue: 'EU',
      myyja: 'Mallisivu Systems OÜ',
    });
    const t = luoTositeMatchista(tapahtuma, k, CHART);
    expect(debet(t.viennit)).toBe(kredit(t.viennit)); // tasapaino
    expect(t.viennit.find((v) => v.tili === 4000)?.debet).toBe(e('23.47')); // pankin euromäärä
    expect(t.viennit.find((v) => v.tili === 4000)?.alvKoodi).toBe(25);
    expect(t.viennit.find((v) => v.tili === 1910)?.kredit).toBe(e('23.47')); // pankki maksaa euromäärän
  });

  it('ohjaa menon myyjäkohtaiselle tilille (menotiliSaannot), muuten oletukselle', () => {
    const tapahtuma: Tilitapahtuma = { pvm: '2026-04-16', nimi: 'GITHUB', maara: e('-6.03') };
    const t = luoTositeMatchista(
      tapahtuma,
      kuitti({ bruttoSumma: e('6.03'), myyja: 'GitHub, Inc.' }),
      CHART,
      {
        menotiliSaannot: [{ hae: 'github', tili: 7570 }],
      },
    );
    expect(t.viennit.find((v) => v.tili === 7570)?.debet).toBe(e('6.03'));
    expect(t.viennit.find((v) => v.tili === 4000)).toBeUndefined();
    // Sääntö ei täsmää kuitin myyjään eikä pankin nimeen -> oletustili (ensimmäinen MENO-tili 4000).
    const t2 = luoTositeMatchista(
      { pvm: '2026-04-16', nimi: 'TUNTEMATON', maara: e('-6.03') },
      kuitti({ bruttoSumma: e('6.03'), myyja: 'Tuntematon Oy' }),
      CHART,
      {
        menotiliSaannot: [{ hae: 'github', tili: 7570 }],
      },
    );
    expect(t2.viennit.find((v) => v.tili === 4000)?.debet).toBe(e('6.03'));
  });

  it('reitittää menon pankkitapahtuman nimen perusteella kun kuitin juridinen nimi ei täsmää sääntöön', () => {
    // Kuitti käyttää juridista nimeä (Anysphere), pankki brändiä (CURSOR) johon sääntö osuu.
    const tapahtuma: Tilitapahtuma = {
      pvm: '2026-05-29',
      nimi: 'CURSOR, AI POWERED IDE',
      maara: e('-17.43'),
    };
    const t = luoTositeMatchista(
      tapahtuma,
      kuitti({ bruttoSumma: e('20.00'), myyja: 'Anysphere, Inc.' }),
      CHART,
      { menotiliSaannot: [{ hae: 'cursor', tili: 7570 }] },
    );
    expect(t.viennit.find((v) => v.tili === 7570)?.debet).toBe(e('17.43'));
    expect(t.viennit.find((v) => v.tili === 4000)).toBeUndefined();
  });

  it('asettaa otsikoksi myyjän ja säilyttää päiväyksen', () => {
    const t = luoTositeMatchista(
      { pvm: '2026-05-04', nimi: 'VERKKOKAUPPA', maara: e('-999.00') },
      kuitti({ bruttoSumma: e('999.00'), myyja: 'Verkkokauppa.com Oyj', alv: [] }),
      CHART,
    );
    expect(t.otsikko).toBe('Verkkokauppa.com Oyj');
    expect(t.pvm).toBe('2026-05-04');
  });
});

describe('paatteleMenotili', () => {
  const SAANNOT = [
    { hae: 'github', tili: 7570 },
    { hae: 'cursor', tili: 7570 },
    { hae: 'verkkokauppa', tili: 7680 },
  ];

  it('kuvaa myyjän tilille säännön mukaan (normalisoi nimen)', () => {
    expect(paatteleMenotili('GitHub, Inc.', SAANNOT, 4000)).toBe(7570);
    expect(paatteleMenotili('VERKKOKAUPPA.COM MYYMALAT', SAANNOT, 4000)).toBe(7680);
  });

  it('palauttaa oletuksen kun sääntö ei täsmää tai myyjää ei ole', () => {
    expect(paatteleMenotili('Tuntematon Oy', SAANNOT, 4000)).toBe(4000);
    expect(paatteleMenotili(undefined, SAANNOT, 4000)).toBe(4000);
  });

  it('ensimmäinen täsmäävä sääntö voittaa', () => {
    const s = [
      { hae: 'cursor', tili: 1 },
      { hae: 'cursor', tili: 2 },
    ];
    expect(paatteleMenotili('Cursor', s, 9)).toBe(1);
  });
});

describe('arkistotunnus pankkiviennille', () => {
  const valinta = { tili: 4000, alvKoodi: 0, alvProsentti: 0 };
  const pankkiVienti = (t: { viennit: TositeVienti[] }): TositeVienti | undefined =>
    t.viennit.find((v) => v.tili === 1910);

  it('luoTositeValinnasta kopioi tapahtuman arkistotunnuksen pankkiviennille', () => {
    const tapahtuma: Tilitapahtuma = {
      pvm: '2026-10-31',
      nimi: 'Testi Oy',
      maara: e('-10.00'),
      arkistotunnus: '261031ABC123',
    };
    const t = luoTositeValinnasta(tapahtuma, valinta, CHART);
    expect(pankkiVienti(t)?.arkistotunnus).toBe('261031ABC123');
    expect(t.viennit.find((v) => v.tili === 4000)?.arkistotunnus).toBeUndefined();
  });

  it('luoTositeValinnasta jättää kentän pois ilman arkistotunnusta', () => {
    const tapahtuma: Tilitapahtuma = { pvm: '2026-10-31', nimi: 'Testi Oy', maara: e('-10.00') };
    const t = luoTositeValinnasta(tapahtuma, valinta, CHART);
    expect(pankkiVienti(t)).toBeDefined();
    expect('arkistotunnus' in (pankkiVienti(t) ?? {})).toBe(false);
  });

  it('luoTositeMatchista kopioi arkistotunnuksen pankkiviennille', () => {
    const tapahtuma: Tilitapahtuma = {
      pvm: '2026-10-31',
      nimi: 'Testi Oy',
      maara: e('-10.00'),
      arkistotunnus: '261031ABC123',
    };
    const t = luoTositeMatchista(tapahtuma, kuitti({ bruttoSumma: e('10.00') }), CHART);
    expect(pankkiVienti(t)?.arkistotunnus).toBe('261031ABC123');
    const { arkistotunnus: _pois, ...ilmanTunnusta } = tapahtuma;
    const ilman = luoTositeMatchista(ilmanTunnusta, kuitti({ bruttoSumma: e('10.00') }), CHART);
    expect('arkistotunnus' in (pankkiVienti(ilman) ?? {})).toBe(false);
  });
});

describe('tilin oletuskohdennus', () => {
  const KARTTA: Tili[] = lataaKartta([
    { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' }, kohdennus: 2 },
    { numero: 7570, tyyppi: 'D', nimi: { fi: 'Atk-kulut' } },
  ]);
  const KOHDENNUKSET: Kohdennus[] = [
    { id: 2, tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta' } },
    {
      id: 3,
      tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
      nimi: { fi: 'Päättynyt' },
      paattyy: '2026-01-31',
    },
  ];
  const tapahtuma: Tilitapahtuma = { pvm: '2026-05-04', nimi: 'KAUPPA', maara: e('-124.00') };
  const k = kuitti({
    bruttoSumma: e('124.00'),
    alv: [{ kanta: 24, netto: e('100.00'), vero: e('24.00'), brutto: e('124.00') }],
  });

  it('meno- ja alv-vienti saavat menotilin oletuskohdennuksen, pankkivienti ei', () => {
    const t = luoTositeMatchista(tapahtuma, k, KARTTA, {
      menotili: 4000,
      kohdennukset: KOHDENNUKSET,
    });
    expect(t.viennit.find((v) => v.tili === 4000)?.kohdennus).toBe(2);
    expect(t.viennit.find((v) => v.tili === 1763)?.kohdennus).toBe(2);
    expect(t.viennit.find((v) => v.tili === 1910)).not.toHaveProperty('kohdennus');
  });

  it('ilman kohdennuslistaa, oletuksetonta tiliä tai voimassa olevaa oletusta ei kohdennusta', () => {
    const ilmanListaa = luoTositeMatchista(tapahtuma, k, KARTTA, { menotili: 4000 });
    const oletukseton = luoTositeMatchista(tapahtuma, k, KARTTA, {
      menotili: 7570,
      kohdennukset: KOHDENNUKSET,
    });
    const paattynyt = luoTositeMatchista(
      tapahtuma,
      k,
      lataaKartta([
        { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
        { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' }, kohdennus: 3 },
      ]),
      { menotili: 4000, kohdennukset: KOHDENNUKSET },
    );
    for (const t of [ilmanListaa, oletukseton, paattynyt])
      expect(t.viennit.some((v) => v.kohdennus !== undefined)).toBe(false);
  });

  it('kirjaushistorian valinta saa tilin oletuskohdennuksen', () => {
    const t = luoTositeValinnasta(
      tapahtuma,
      { tili: 4000, alvKoodi: AlvKoodi.OSTOT_NETTO, alvProsentti: 24 },
      KARTTA,
      { kohdennukset: KOHDENNUKSET },
    );
    expect(t.viennit.find((v) => v.tili === 4000)?.kohdennus).toBe(2);
  });
});
