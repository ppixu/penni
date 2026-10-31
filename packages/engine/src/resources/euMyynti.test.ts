import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi } from '../alv/koodit.js';
import { haeEuMyyntiYhteenveto } from './euMyynti.js';
import { tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { AlvVelvollinen: 'true' },
  });

/** EU-myynti (nollalaji, ei alv-jalkaa): pankki debet, myynti kredit koodilla. kumppani tositteella. */
const euMyynti = (pvm: string, summa: number, koodi: number, kumppani: number) => ({
  pvm,
  tyyppi: 0,
  sarja: '',
  kumppani,
  viennit: [
    { tili: 1900, debet: c(summa), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
    { tili: 3000, debet: c(0), kredit: c(summa), pvm, alvKoodi: koodi, alvProsentti: 0 },
  ],
});

const KAUSI = { alkupvm: '2026-06-01', loppupvm: '2026-06-30' };

describe('haeEuMyyntiYhteenveto', () => {
  it('erittelee tavara- ja palvelumyynnin asiakkaittain ja merkitsee puuttuvat tunnukset', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Alfa GmbH', alvtunnus: 'DE111111111', maa: 'de' });
    const b = await s.saveKumppani({ nimi: 'Beeta AB', maa: 'se' }); // ei alvtunnusta
    await tallennaTosite(
      s,
      euMyynti('2026-06-05', 10000, AlvKoodi.YHTEISOMYYNTI_TAVARAT, a.id),
      env,
    );
    await tallennaTosite(
      s,
      euMyynti('2026-06-06', 5000, AlvKoodi.YHTEISOMYYNTI_PALVELUT, b.id),
      env,
    );

    const y = await haeEuMyyntiYhteenveto(s, KAUSI);
    expect(y.rivit).toHaveLength(2);
    const riviA = y.rivit.find((r) => r.kumppani === a.id);
    const riviB = y.rivit.find((r) => r.kumppani === b.id);
    expect(riviA?.tavara).toBe(10000);
    expect(riviA?.palvelu).toBe(0);
    expect(riviA?.alvtunnus).toBe('DE111111111');
    expect(riviB?.palvelu).toBe(5000);
    expect(riviB?.alvtunnus).toBeUndefined();
    expect(y.puuttuviaTunnuksia).toBe(true); // Beeta AB:lta puuttuu alv-tunnus
  });

  it('summaa saman asiakkaan useat myynnit ja lajittelee nimellä', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Zeta Oy', alvtunnus: 'EE100000000' });
    const b = await s.saveKumppani({ nimi: 'Alfa Oy', alvtunnus: 'DE200000000' });
    await tallennaTosite(
      s,
      euMyynti('2026-06-05', 3000, AlvKoodi.YHTEISOMYYNTI_TAVARAT, a.id),
      env,
    );
    await tallennaTosite(
      s,
      euMyynti('2026-06-07', 2000, AlvKoodi.YHTEISOMYYNTI_TAVARAT, a.id),
      env,
    );
    // Beeta-asiakkaalle (Alfa Oy) oma myynti, jotta lajittelu nimellä on ylipäätään testattavissa
    // (nollasummainen kumppani pudotetaan pois, ks. seuraava testi).
    await tallennaTosite(
      s,
      euMyynti('2026-06-08', 4000, AlvKoodi.YHTEISOMYYNTI_PALVELUT, b.id),
      env,
    );
    const y = await haeEuMyyntiYhteenveto(s, KAUSI);
    expect(y.rivit.map((r) => r.nimi)).toEqual(['Alfa Oy', 'Zeta Oy']); // lajiteltu nimellä
    expect(y.rivit.find((r) => r.kumppani === a.id)?.tavara).toBe(5000);
    expect(y.puuttuviaTunnuksia).toBe(false);
  });

  it('ei sisällytä kotimaan myyntiä eikä nollasummaisia kumppaneita', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Koti Oy', alvtunnus: 'FI12345678' });
    // Kotimaan myynti (koodi 11), ei EU-koodia -> ei mukana.
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-05',
        tyyppi: 0,
        sarja: '',
        kumppani: a.id,
        viennit: [
          {
            tili: 1900,
            debet: c(1000),
            kredit: c(0),
            pvm: '2026-06-05',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(1000),
            pvm: '2026-06-05',
            alvKoodi: 11,
            alvProsentti: 25.5,
          },
        ],
      },
      env,
    );
    const y = await haeEuMyyntiYhteenveto(s, KAUSI);
    expect(y.rivit).toHaveLength(0);
    expect(y.puuttuviaTunnuksia).toBe(false);
  });

  it('rajaa kauden vientipäivän mukaan (ei tositepäivän) — täsmää alv-laskelmaan', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Alfa GmbH', alvtunnus: 'DE111111111' });
    // Tosite touko-pvm, mutta viennit kesäkuulle päivätty -> vienti kuuluu kesäkuun kaudelle.
    await tallennaTosite(
      s,
      {
        pvm: '2026-05-31',
        tyyppi: 0,
        sarja: '',
        kumppani: a.id,
        viennit: [
          {
            tili: 1900,
            debet: c(8000),
            kredit: c(0),
            pvm: '2026-06-05',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(8000),
            pvm: '2026-06-05',
            alvKoodi: AlvKoodi.YHTEISOMYYNTI_TAVARAT,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    // Tosite kesä-pvm, mutta viennit toukokuulle päivätty -> vienti EI kuulu kesäkuun kaudelle.
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        kumppani: a.id,
        viennit: [
          {
            tili: 1900,
            debet: c(9000),
            kredit: c(0),
            pvm: '2026-05-20',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(9000),
            pvm: '2026-05-20',
            alvKoodi: AlvKoodi.YHTEISOMYYNTI_TAVARAT,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const y = await haeEuMyyntiYhteenveto(s, KAUSI);
    expect(y.rivit).toHaveLength(1);
    expect(y.rivit[0]?.tavara).toBe(8000); // vain kesäkuulle päivätty vienti mukana
    expect(y.puuttuviaTunnuksia).toBe(false);
  });

  it('pudottaa kumppanin jonka yhteisömyynti nettoutuu nollaan (esim. hyvityslasku)', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Alfa GmbH', alvtunnus: 'DE111111111' });
    await tallennaTosite(
      s,
      euMyynti('2026-06-05', 10000, AlvKoodi.YHTEISOMYYNTI_TAVARAT, a.id),
      env,
    );
    // Hyvityslasku: koodi 14 debetissä -> luottopainotteinen summa −10000.
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-08',
        tyyppi: 0,
        sarja: '',
        kumppani: a.id,
        viennit: [
          {
            tili: 1900,
            debet: c(0),
            kredit: c(10000),
            pvm: '2026-06-08',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(10000),
            kredit: c(0),
            pvm: '2026-06-08',
            alvKoodi: AlvKoodi.YHTEISOMYYNTI_TAVARAT,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const y = await haeEuMyyntiYhteenveto(s, KAUSI);
    expect(y.rivit).toHaveLength(0);
    expect(y.puuttuviaTunnuksia).toBe(false);
  });

  it('laskee tyhjän alv-tunnuksen puuttuvaksi', async () => {
    const s = seed();
    const a = await s.saveKumppani({ nimi: 'Alfa GmbH', alvtunnus: '' }); // tyhjennetty lomakekenttä
    await tallennaTosite(
      s,
      euMyynti('2026-06-05', 5000, AlvKoodi.YHTEISOMYYNTI_TAVARAT, a.id),
      env,
    );
    const y = await haeEuMyyntiYhteenveto(s, KAUSI);
    expect(y.rivit).toHaveLength(1);
    expect(y.rivit[0]?.alvtunnus).toBeUndefined(); // tyhjä ei kopioidu riville
    expect(y.puuttuviaTunnuksia).toBe(true);
  });
});
