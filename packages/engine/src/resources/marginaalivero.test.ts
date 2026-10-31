import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { TositeTyyppi } from '../vouchers/enums.js';
import { haeAlvLaskelma } from './alvLaskelma.js';
import { kirjaaMarginaalivero } from './marginaalivero.js';
import { tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-07-01T00:00:00.000Z' };
const KAUSI1 = { alkupvm: '2026-06-01', loppupvm: '2026-06-30' };
const KAUSI2 = { alkupvm: '2026-07-01', loppupvm: '2026-07-31' };
const KAUSI3 = { alkupvm: '2026-08-01', loppupvm: '2026-08-31' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
      { numero: 3010, tyyppi: 'CL', nimi: { fi: 'Marginaalimyynti 1' } },
      { numero: 3020, tyyppi: 'CL', nimi: { fi: 'Marginaalimyynti 2' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Marginaaliostot' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { AlvVelvollinen: 'true' },
  });

/** Marginaalimyynti: pankki debet, myyntitili kredit (alvKoodi 13, kanta 25,5 %). */
const myyntiMarginaali = (pvm: string, tili: number, summa: number) => ({
  pvm,
  tyyppi: 0,
  sarja: '',
  viennit: [
    { tili: 1900, debet: c(summa), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
    { tili, debet: c(0), kredit: c(summa), pvm, alvKoodi: 13, alvProsentti: 25.5 },
  ],
});

/** Marginaaliosto: ostotili debet (alvKoodi 23, kanta 25,5 %), pankki kredit. */
const ostoMarginaali = (pvm: string, tili: number, summa: number) => ({
  pvm,
  tyyppi: 0,
  sarja: '',
  viennit: [
    { tili, debet: c(summa), kredit: c(0), pvm, alvKoodi: 23, alvProsentti: 25.5 },
    { tili: 1900, debet: c(0), kredit: c(summa), pvm, alvKoodi: 0, alvProsentti: 0 },
  ],
});

describe('kirjaaMarginaalivero', () => {
  it('books VAT on a positive margin (inclusive rate) into ALVVELKA with code 113', async () => {
    const s = seed();
    await tallennaTosite(s, myyntiMarginaali('2026-06-05', 3010, 100_000), env);
    await tallennaTosite(s, ostoMarginaali('2026-06-10', 4000, 60_000), env);

    const tosite = await kirjaaMarginaalivero(s, KAUSI1, env);

    expect(tosite?.tyyppi).toBe(TositeTyyppi.MARGINAALILASKELMA); // 9105
    // margin 40000; vero = roundHalfAway(2550*40000/12550) = roundHalfAway(8127.4900...) = 8127
    expect(tosite?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 113)?.kredit).toBe(8127);
    expect(tosite?.viennit.find((v) => v.tili === 3010 && v.alvKoodi === 914)?.debet).toBe(8127);
    expect(tosite?.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
      tosite?.viennit.reduce((a, v) => a + v.kredit, 0),
    );

    const laskelma = await haeAlvLaskelma(s, KAUSI1);
    expect(laskelma.koodit.get(301)).toBe(8127);
  });

  it('splits VAT across two sales accounts proportionally, summing exactly to the bucket VAT', async () => {
    const s = seed();
    await tallennaTosite(s, myyntiMarginaali('2026-06-05', 3010, 70_000), env);
    await tallennaTosite(s, myyntiMarginaali('2026-06-06', 3020, 30_000), env);

    const tosite = await kirjaaMarginaalivero(s, KAUSI1, env);

    // margin 100000; vero = roundHalfAway(2550*100000/12550) = roundHalfAway(20318.7251) = 20319
    // 3010 share 0.7 -> floor(14223.3)=14223 (rem .3); 3020 share 0.3 -> floor(6095.7)=6095 (rem .7)
    // 1 leftover cent goes to the larger remainder (3020) -> 3010=14223, 3020=6096; sum 20319
    const a = tosite?.viennit.find((v) => v.tili === 3010 && v.alvKoodi === 914)?.debet ?? 0;
    const b = tosite?.viennit.find((v) => v.tili === 3020 && v.alvKoodi === 914)?.debet ?? 0;
    expect(a).toBe(14223);
    expect(b).toBe(6096);
    expect(a + b).toBe(20319);
    expect(tosite?.viennit.find((v) => v.tili === 2939)?.kredit).toBe(20319);
  });

  it('carries a negative margin forward as a rate-keyed deficit and books no VAT', async () => {
    const s = seed();
    await tallennaTosite(s, myyntiMarginaali('2026-06-05', 3010, 30_000), env);
    await tallennaTosite(s, ostoMarginaali('2026-06-10', 4000, 50_000), env);

    const tosite = await kirjaaMarginaalivero(s, KAUSI1, env);

    expect(tosite?.viennit.some((v) => v.alvKoodi === 113)).toBe(false); // no VAT booked
    expect(tosite?.marginaalialijaama?.['25.50']).toBe(20_000); // 50000 - 30000
  });

  it('reads the prior deficit and reduces the current margin', async () => {
    const s = seed();
    await tallennaTosite(s, myyntiMarginaali('2026-06-05', 3010, 30_000), env);
    await tallennaTosite(s, ostoMarginaali('2026-06-10', 4000, 50_000), env);
    await kirjaaMarginaalivero(s, KAUSI1, env); // deficit 20000 kaudelle 25,50 %

    await tallennaTosite(s, myyntiMarginaali('2026-07-05', 3010, 50_000), env);
    const p2 = await kirjaaMarginaalivero(s, KAUSI2, env);

    // margin = 50000 - 0 - 20000 = 30000; vero = roundHalfAway(2550*30000/12550) = roundHalfAway(6095.6175) = 6096
    expect(p2?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 113)?.kredit).toBe(6096);
  });

  it('is idempotent per period (JOMARGINAALILASKELMA)', async () => {
    const s = seed();
    await tallennaTosite(s, myyntiMarginaali('2026-06-05', 3010, 100_000), env);
    await tallennaTosite(s, ostoMarginaali('2026-06-10', 4000, 60_000), env);
    await kirjaaMarginaalivero(s, KAUSI1, env);
    await expect(kirjaaMarginaalivero(s, KAUSI1, env)).rejects.toMatchObject({
      code: 'JOMARGINAALILASKELMA',
    });
  });

  it('returns null for a period with no margin activity and no deficit', async () => {
    const s = seed();
    expect(await kirjaaMarginaalivero(s, KAUSI1, env)).toBeNull();
  });

  it('does not resurrect a stale deficit once a later period has cleared it (regression)', async () => {
    const s = seed();
    // Kausi 1: myynti 30000, osto 60000 -> alijäämä 30000 kannalla 25,50 %.
    await tallennaTosite(s, myyntiMarginaali('2026-06-05', 3010, 30_000), env);
    await tallennaTosite(s, ostoMarginaali('2026-06-10', 4000, 60_000), env);
    await kirjaaMarginaalivero(s, KAUSI1, env);

    // Kausi 2: myynti täsmälleen alijäämän verran -> marginaali nollautuu, ei veroa eikä uutta
    // alijäämää. Tositteen on silti tallennuttava, jotta alijäämän kuittautuminen näkyy myöhemmin.
    await tallennaTosite(s, myyntiMarginaali('2026-07-05', 3010, 30_000), env);
    const p2 = await kirjaaMarginaalivero(s, KAUSI2, env);
    expect(p2).not.toBeNull();
    expect(p2?.viennit.some((v) => v.alvKoodi === 113)).toBe(false);
    expect(p2?.marginaalialijaama?.['25.50']).toBeUndefined();

    // Kausi 3: täysi marginaalimyynti ilman ostoja. Jos kauden 1 alijäämä virheellisesti
    // "heräisi henkiin" (koska kausi 2 ei tallentanut tositetta), veroksi tulisi
    // roundHalfAway(2550*70000/12550) = 14223 (alijäämä 30000 vähennettynä). Oikea, kuitattu
    // alijäämä huomioiden vero on roundHalfAway(2550*100000/12550) = 20319.
    await tallennaTosite(s, myyntiMarginaali('2026-08-05', 3010, 100_000), env);
    const p3 = await kirjaaMarginaalivero(s, KAUSI3, env);
    expect(p3?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 113)?.kredit).toBe(20_319);
  });

  it('does not book VAT when the margin is positive but there is no margin sale to attribute it to', async () => {
    const s = seed();
    // Marginaaliostojen palautus (koodi 23 kredit-puolella) ilman myyntiä -> ostot negatiivinen,
    // marginaali positiivinen, mutta myyntiä ei ole. Ei verollista jälleenmyyntiä -> ei kirjausta.
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: c(0),
            kredit: c(60_000),
            pvm: '2026-06-10',
            alvKoodi: 23,
            alvProsentti: 25.5,
          },
          {
            tili: 1900,
            debet: c(60_000),
            kredit: c(0),
            pvm: '2026-06-10',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    // marginaali = 0 − (−60000) − 0 = 60000 > 0, mutta myynti = 0 -> ei veroa, ei tositetta.
    expect(await kirjaaMarginaalivero(s, KAUSI1, env)).toBeNull();
  });

  it('throws EIVEROVELVOLLINEN when the book is not VAT-liable', async () => {
    const s = createMemoryStorage({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
        { numero: 3010, tyyppi: 'CL', nimi: { fi: 'Marginaalimyynti 1' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { AlvVelvollinen: 'false' },
    });
    await expect(kirjaaMarginaalivero(s, KAUSI1, env)).rejects.toMatchObject({
      code: 'EIVEROVELVOLLINEN',
    });
  });
});
