import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { type Tili, lataaKartta } from '../accounts/tili.js';
import { AlvKoodi } from '../alv/koodit.js';
import { TositeTyyppi } from '../vouchers/enums.js';
import type { TositeVienti } from '../vouchers/types.js';
import {
  type HistoriaTosite,
  ehdotaKirjaus,
  onkoOmistajanLiike,
  opiKirjaushistoriasta,
  paivitaOtsikko,
} from './ehdotaKirjaus.js';
import { luoTositeValinnasta } from './kuittiTosite.js';
import type { Tilitapahtuma } from './poimiTiliote.js';

const CHART: Tili[] = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } },
  { numero: 2361, tyyppi: 'BY', nimi: { fi: 'Yksityissijoitukset rahana' } },
  { numero: 2365, tyyppi: 'BY', nimi: { fi: 'Yksityisnostot rahana' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  { numero: 7661, tyyppi: 'D', nimi: { fi: 'Ohjelmistot' } },
  { numero: 7570, tyyppi: 'D', nimi: { fi: 'Atk-kulut' } },
  { numero: 9900, tyyppi: 'DVE', nimi: { fi: 'Ennakkoverot' } },
]);

const e = (s: string): Cents => Euro.fromString(s);
const Z = e('0');

function v(tili: number, debet: string, kredit: string, extra: Partial<TositeVienti> = {}) {
  return {
    tili,
    debet: e(debet),
    kredit: e(kredit),
    pvm: '2026-06-01',
    alvKoodi: 0,
    alvProsentti: 0,
    ...extra,
  };
}

function tosite(
  id: number,
  pvm: string,
  otsikko: string | undefined,
  viennit: TositeVienti[],
): HistoriaTosite & { id: number } {
  return {
    id,
    pvm,
    tyyppi: TositeTyyppi.MENO,
    tila: 100,
    tunniste: id,
    sarja: '',
    viennit,
    ...(otsikko ? { otsikko } : {}),
  };
}

// Keksitty historia: ohjelmistotilaus ilman alv:tä, myynti 25,5 %, oman pääoman liikkeet, vero.
const HISTORIA = [
  tosite(1, '2026-05-01', 'Pilvipalvelu Pro', [v(7661, '18.00', '0'), v(1910, '0', '18.00')]),
  tosite(2, '2026-05-10', 'Koodipalvelu', [v(7570, '6.12', '0'), v(1910, '0', '6.12')]),
  tosite(3, '2026-05-27', 'Asiakas Oy lasku 12', [
    v(1910, '1255.00', '0'),
    v(3000, '0', '1000.00', { alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 }),
    v(2939, '0', '255.00', { alvKoodi: 111, alvProsentti: 25.5 }),
  ]),
  tosite(4, '2026-05-28', undefined, [
    v(2365, '500.00', '0'),
    v(1910, '0', '500.00', { selite: 'MEIKÄLÄINEN MATTI' }),
  ]),
  tosite(5, '2026-05-29', 'Pääomasijoitus', [
    v(1910, '300.00', '0', { selite: 'MEIKÄLÄINEN MATTI' }),
    v(2361, '0', '300.00'),
  ]),
  tosite(6, '2026-05-30', 'Ennakkovero', [
    v(9900, '120.00', '0'),
    v(1910, '0', '120.00', { selite: 'VEROHALLINTO' }),
  ]),
];

const tap = (nimi: string, maara: string, pvm = '2026-07-01'): Tilitapahtuma => ({
  pvm,
  nimi,
  maara: e(maara),
});

describe('ehdotaKirjaus', () => {
  const muisti = opiKirjaushistoriasta(HISTORIA, CHART);

  it('pankkinimi vs. aiempi otsikko: ensimmäinen merkitsevä sana riittää', () => {
    expect(ehdotaKirjaus(muisti, tap('PILVIPALVELU* PRO TILAUS', '-18.00'))).toMatchObject({
      tili: 7661,
      alvKoodi: 0,
      otsikko: 'Pilvipalvelu Pro',
      lahdeTosite: 1,
    });
    expect(ehdotaKirjaus(muisti, tap('KOODIPALVELU, INC.', '-6.14'))?.tili).toBe(7570);
  });

  it('ehdotus kantaa lähdetositteen kumppanin', () => {
    const historia = [
      {
        ...tosite(7, '2026-06-16', 'Github developer plan', [
          v(7661, '6.12', '0'),
          v(1910, '0', '6.12'),
        ]),
        kumppani: 3,
      },
    ];
    const m = opiKirjaushistoriasta(historia, CHART, { kumppanit: new Map([[3, 'Github']]) });
    expect(ehdotaKirjaus(m, tap('GITHUB, INC.', '-6.12'))).toMatchObject({
      tili: 7661,
      kumppani: 3,
      lahdeTosite: 7,
    });
    expect(ehdotaKirjaus(muisti, tap('PILVIPALVELU PRO', '-18.00'))).not.toHaveProperty('kumppani');
  });

  it('myynti: tili ja alv-koodi/prosentti perusviennistä (ei alv-vientiä)', () => {
    expect(ehdotaKirjaus(muisti, tap('ASIAKAS OY', '2000.00'))).toMatchObject({
      tili: 3000,
      alvKoodi: AlvKoodi.MYYNNIT_NETTO,
      alvProsentti: 25.5,
    });
  });

  it('erottaa suunnan: omistajan nosto vs. sijoitus samalla pankkinimellä', () => {
    expect(ehdotaKirjaus(muisti, tap('MEIKÄLÄINEN MATTI', '-1000.00'))).toMatchObject({
      tili: 2365,
      peruste: 'pankkinimi',
    });
    expect(ehdotaKirjaus(muisti, tap('MEIKÄLÄINEN MATTI', '50.00'))?.tili).toBe(2361);
  });

  it('tarkka pankkinimi voittaa sanatäsmäyksen', () => {
    expect(ehdotaKirjaus(muisti, tap('VEROHALLINTO', '-923.18'))).toMatchObject({
      tili: 9900,
      peruste: 'pankkinimi',
    });
  });

  it('tasatilanteessa uusin tosite voittaa', () => {
    const m = opiKirjaushistoriasta(
      [
        tosite(10, '2026-01-01', 'Koodipalvelu', [v(4000, '5.00', '0'), v(1910, '0', '5.00')]),
        tosite(11, '2026-03-01', 'Koodipalvelu', [v(7570, '5.00', '0'), v(1910, '0', '5.00')]),
      ],
      CHART,
    );
    expect(ehdotaKirjaus(m, tap('KOODIPALVELU INC', '-5.00'))?.tili).toBe(7570);
  });

  it('kumppanin nimi kelpaa nimeksi', () => {
    const m = opiKirjaushistoriasta(
      [
        {
          ...tosite(20, '2026-01-01', undefined, [v(4000, '5.00', '0'), v(1910, '0', '5.00')]),
          kumppani: 7,
        },
      ],
      CHART,
      { kumppanit: new Map([[7, 'Tukku Oy']]) },
    );
    expect(ehdotaKirjaus(m, tap('TUKKU OY HELSINKI', '-9.00'))?.tili).toBe(4000);
  });

  it('ei ehdotusta tuntemattomalle; omistajan liikkeelle yksityistili ilman historiaa', () => {
    const tyhja = opiKirjaushistoriasta([], CHART);
    expect(ehdotaKirjaus(tyhja, tap('TUNTEMATON KAUPPA', '-1.00'))).toBeUndefined();
    const optiot = { omistajanNimet: ['Matti Meikäläinen'] };
    expect(ehdotaKirjaus(tyhja, tap('MEIKÄLÄINEN MATTI', '-10.00'), optiot)).toMatchObject({
      tili: 2365,
      peruste: 'omistaja',
    });
    expect(ehdotaKirjaus(tyhja, tap('MEIKÄLÄINEN MATTI', '10.00'), optiot)?.tili).toBe(2361);
  });
});

describe('ehdotaKirjaus: summa, varatili ja otsikko', () => {
  const VERO = (id: number, pvm: string, tili: number, maara: string, otsikko: string) =>
    tosite(id, pvm, otsikko, [
      v(tili, maara, '0'),
      v(1910, '0', maara, { selite: 'VEROHALLINTO' }),
    ]);
  // Sama pankkinimi, eri maksulajit: uusin tosite on viivästysseuraamus.
  const veromuisti = opiKirjaushistoriasta(
    [
      VERO(30, '2026-03-12', 2365, '2765.40', 'Jäännösvero'),
      VERO(31, '2026-04-12', 9900, '923.18', 'Ennakkovero'),
      VERO(32, '2026-05-12', 9540, '0.54', 'Viivästysseuraamus'),
    ],
    CHART,
  );

  it('samalla nimellä useita kirjauksia: lähin summa voittaa uusimman', () => {
    expect(ehdotaKirjaus(veromuisti, tap('VEROHALLINTO', '-923.18'))?.tili).toBe(9900);
    expect(ehdotaKirjaus(veromuisti, tap('VEROHALLINTO', '-2765.39'))?.tili).toBe(2365);
    expect(ehdotaKirjaus(veromuisti, tap('VEROHALLINTO', '-0.54'))?.tili).toBe(9540);
    // Ei tasasummaa: samaa suuruusluokkaa oleva kirjaus.
    expect(ehdotaKirjaus(veromuisti, tap('VEROHALLINTO', '-700.00'))?.tili).toBe(9900);
  });

  it('lähes sama summa: uusin voittaa (hinnanmuutos ei vaihda tiliä vanhaan)', () => {
    const m = opiKirjaushistoriasta(
      [
        tosite(40, '2026-01-01', 'Koodipalvelu', [v(4000, '20.00', '0'), v(1910, '0', '20.00')]),
        tosite(41, '2026-05-01', 'Koodipalvelu', [v(7570, '20.10', '0'), v(1910, '0', '20.10')]),
      ],
      CHART,
    );
    expect(ehdotaKirjaus(m, tap('KOODIPALVELU INC', '-20.00'))?.tili).toBe(7570);
  });

  it('omistajan liike ilman nimihistoriaa: historian käyttämä yksityistili, ei kartan ensimmäistä', () => {
    const kartta = lataaKartta([
      { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 2341, tyyppi: 'BY', nimi: { fi: 'Yksityisnostot yhtiömies A' } },
      { numero: 2351, tyyppi: 'BY', nimi: { fi: 'Yksityissijoitukset yhtiömies A' } },
      { numero: 2361, tyyppi: 'BY', nimi: { fi: 'Yksityissijoitukset' } },
      { numero: 2365, tyyppi: 'BY', nimi: { fi: 'Yksityisnostot' } },
    ]);
    const m = opiKirjaushistoriasta(
      [
        tosite(50, '2026-02-01', 'Yksityisnosto', [
          v(2365, '100.00', '0'),
          v(1910, '0', '100.00', { selite: 'TILISIIRTO OMALLE' }),
        ]),
        tosite(51, '2026-03-01', 'Yksityisnosto', [
          v(2365, '200.00', '0'),
          v(1910, '0', '200.00', { selite: 'TILISIIRTO OMALLE' }),
        ]),
        tosite(52, '2026-03-02', 'Yksityissijoitus', [
          v(1910, '50.00', '0', { selite: 'TALLETUS' }),
          v(2361, '0', '50.00'),
        ]),
      ],
      kartta,
    );
    const optiot = { omistajanNimet: ['Matti Meikäläinen'] };
    expect(ehdotaKirjaus(m, tap('MEIKÄLÄINEN MATTI', '-10.00'), optiot)).toMatchObject({
      tili: 2365,
      peruste: 'omistaja',
    });
    expect(ehdotaKirjaus(m, tap('MEIKÄLÄINEN MATTI', '10.00'), optiot)?.tili).toBe(2361);
    // Ilman historiaa: kartan ensimmäinen sopiva.
    const tyhja = opiKirjaushistoriasta([], kartta);
    expect(ehdotaKirjaus(tyhja, tap('MEIKÄLÄINEN MATTI', '-10.00'), optiot)?.tili).toBe(2341);
  });

  it('otsikon kuukausi vaihtuu tapahtuman kuukaudeksi ja laskunumero jää pois', () => {
    const m = opiKirjaushistoriasta(
      [
        tosite(60, '2026-08-20', 'Revontuli elokuu (lasku 412)', [
          v(1910, '500.00', '0', { selite: 'REVONTULI OY' }),
          v(3000, '0', '500.00'),
        ]),
      ],
      CHART,
    );
    expect(ehdotaKirjaus(m, tap('REVONTULI OY', '500.00', '2026-09-18'))?.otsikko).toBe(
      'Revontuli syyskuu',
    );
  });
});

describe('paivitaOtsikko', () => {
  it('vaihtaa kuukauden nimen taivutuksineen ja säilyttää kirjainkoon', () => {
    expect(paivitaOtsikko('Vuokra elokuun ajalta', '2026-09-01')).toBe('Vuokra syyskuun ajalta');
    expect(paivitaOtsikko('Joulukuu 2025 vuokra', '2026-01-05')).toBe('Tammikuu 2026 vuokra');
    expect(paivitaOtsikko('PALKKA HEINÄKUU', '2026-03-31')).toBe('PALKKA MAALISKUU');
    expect(paivitaOtsikko('Kesäkuussa ostettu', '2026-02-01')).toBe('Helmikuussa ostettu');
  });

  it('poistaa lopun laskunumeron mutta ei muuta muuta otsikkoa', () => {
    expect(paivitaOtsikko('Asiakas Oy (lasku 12)', '2026-05-01')).toBe('Asiakas Oy');
    expect(paivitaOtsikko('Asiakas Oy lasku nro 1234', '2026-05-01')).toBe('Asiakas Oy');
    expect(paivitaOtsikko('Pilvipalvelu Pro', '2026-05-01')).toBe('Pilvipalvelu Pro');
    expect(paivitaOtsikko('Kuukausimaksu', '2026-05-01')).toBe('Kuukausimaksu');
  });
});

describe('onkoOmistajanLiike', () => {
  it('kaikki nimen osat sanoina, järjestyksestä riippumatta', () => {
    expect(onkoOmistajanLiike('MEIKÄLÄINEN MATTI', ['Matti Meikäläinen'])).toBe(true);
    expect(onkoOmistajanLiike('MATTIS CAFE', ['Matti Meikäläinen'])).toBe(false);
    expect(onkoOmistajanLiike('MATTI', [''])).toBe(false);
  });
});

describe('luoTositeValinnasta', () => {
  const debet = (vs: TositeVienti[]): number => vs.reduce((s, x) => s + x.debet, 0);
  const kredit = (vs: TositeVienti[]): number => vs.reduce((s, x) => s + x.kredit, 0);

  it('veroton meno: kulu debet, pankki kredit, pankkiviennin selite = pankkinimi', () => {
    const t = luoTositeValinnasta(
      tap('PILVIPALVELU', '-18.00'),
      { tili: 7661, alvKoodi: 0, alvProsentti: 0 },
      CHART,
    );
    expect(t.tyyppi).toBe(TositeTyyppi.MENO);
    expect(t.viennit).toHaveLength(2);
    expect(t.viennit[0]).toMatchObject({ tili: 7661, debet: e('18.00'), kredit: Z });
    expect(t.viennit[1]).toMatchObject({ tili: 1910, kredit: e('18.00'), selite: 'PILVIPALVELU' });
  });

  it('myynti 25,5 % bruttona: netto + alv-velka kreditiin, pankki debet', () => {
    const t = luoTositeValinnasta(
      tap('ASIAKAS OY', '1255.00'),
      { tili: 3000, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 },
      CHART,
    );
    expect(t.tyyppi).toBe(TositeTyyppi.TULO);
    expect(debet(t.viennit)).toBe(kredit(t.viennit));
    expect(t.viennit.find((x) => x.tili === 3000)?.kredit).toBe(e('1000.00'));
    expect(t.viennit.find((x) => x.tili === 2939)?.kredit).toBe(e('255.00'));
    expect(t.viennit.find((x) => x.tili === 1910)?.debet).toBe(e('1255.00'));
  });

  it('käänteinen EU-palveluosto: pankin summa on veron peruste, alv molemmille puolille', () => {
    const t = luoTositeValinnasta(
      tap('PALVELU EU', '-100.00'),
      { tili: 7570, alvKoodi: AlvKoodi.YHTEISOHANKINNAT_PALVELUT, alvProsentti: 25.5 },
      CHART,
    );
    expect(debet(t.viennit)).toBe(kredit(t.viennit));
    expect(t.viennit.find((x) => x.tili === 7570)?.debet).toBe(e('100.00'));
    expect(t.viennit.find((x) => x.tili === 1910)?.kredit).toBe(e('100.00'));
  });
});
