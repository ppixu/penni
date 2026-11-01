import { describe, expect, it } from 'vitest';
import { syntymapaiva, tarkistaHetu, velvollisuudet } from './henkilo.js';

// Kaikki testitunnukset ovat keinotekoisia (yksilönumero 900-999), ei oikeita henkilöitä.
describe('tarkistaHetu', () => {
  it.each(['150300A9015', '010170-9505', '200558-9994', '100657-9001'])('hyväksyy %s', (h) => {
    expect(tarkistaHetu(h)).toBe(true);
  });

  it('hylkää väärän tarkisteen', () => {
    expect(tarkistaHetu('150300A9016')).toBe(false);
    expect(tarkistaHetu('010170-9506')).toBe(false);
  });

  it('hylkää väärän muodon', () => {
    expect(tarkistaHetu('')).toBe(false);
    expect(tarkistaHetu('150300A901')).toBe(false); // liian lyhyt
    expect(tarkistaHetu('150300A90155')).toBe(false); // liian pitkä
    expect(tarkistaHetu('150300Z9015')).toBe(false); // tuntematon vuosisatamerkki
    expect(tarkistaHetu('15O300A9015')).toBe(false); // kirjain O numeron tilalla
  });

  it('hylkää mahdottomat päivämäärät', () => {
    expect(tarkistaHetu('300200-9011')).toBe(false); // 30.2.
    expect(tarkistaHetu('290200A901C')).toBe(true); // 2000 on karkausvuosi
    expect(tarkistaHetu('290201A901M')).toBe(false); // 2001 ei ole
    expect(tarkistaHetu('320170-900J')).toBe(false);
  });

  it('hyväksyy kaikki vuosisatamerkit', () => {
    expect(tarkistaHetu('010199+950M')).toBe(true);
    for (const m of ['-', 'Y', 'X', 'W', 'V', 'U', 'A', 'B', 'C', 'D', 'E', 'F']) {
      const rungon = '010190';
      const merkit = '0123456789ABCDEFHJKLMNPRSTUVWXY';
      const tarkiste = merkit[Number(`${rungon}900`) % 31];
      expect(tarkistaHetu(`${rungon}${m}900${tarkiste}`), m).toBe(true);
    }
  });

  it('sallii pienet kirjaimet ja ympäröivän tyhjän', () => {
    expect(tarkistaHetu(' 150300a9015 ')).toBe(true);
  });
});

describe('syntymapaiva', () => {
  it('A-vuosisatamerkki: 2000-luku', () => {
    expect(syntymapaiva('150300A9015')).toBe('2000-03-15');
  });
  it('-merkki: 1900-luku', () => {
    expect(syntymapaiva('010170-9505')).toBe('1970-01-01');
  });
  it('+-merkki: 1800-luku', () => {
    expect(syntymapaiva('010199+950M')).toBe('1899-01-01');
  });
  it('virheellinen tunnus: null', () => {
    expect(syntymapaiva('150300A9016')).toBeNull();
    expect(syntymapaiva('roskaa')).toBeNull();
  });
});

/*
 * Ikärajat. Lähteet (kuukausiraja = ikävuoden täyttämiskuukausi):
 *  - TyEL: Tulorekisteri, soveltamisohje 2026, PDF s. 32 (painettu 31) "Earnings-related pension
 *    insurance information": ikävälit 17-68, yläraja 68/69/70 syntymävuoden mukaan (1957-/1958-61/1962+).
 *    Kuukausiraja Elon työnantajan TyEL-oppaasta (2026): vakuuttaminen alkaa 17 vuoden täyttämistä
 *    seuraavan kuukauden alusta ja jatkuu sen kuukauden loppuun, jolloin yläikäraja täyttyy.
 *  - TyEL 53-62 (vain 2025): Ilmarisen TyEL lyhyesti: korotettu maksu 53 vuoden täyttämistä
 *    seuraavan kuukauden alusta sen kuukauden loppuun, jona täyttää 63.
 *  - Työttömyysvakuutus: Työllisyysrahasto, työttömyysvakuutusmaksuvelvollisuus: alkaa 18 vuoden
 *    syntymäpäivää seuraavan kuukauden alusta; päättyy 65 vuoden syntymäpäivää seuraavan kuukauden alkuun.
 *  - Sava: Verohallinto VH/7272/00.01.00/2025 luku 4.2: alkaa sen kalenterikuukauden jälkeen, jona
 *    täyttää 16; ei tarvitse maksaa sen kalenterikuukauden jälkeen, jona täyttää 68.
 */
describe('velvollisuudet: TyEL alaraja (17 v)', () => {
  const syntynyt = '2000-03-15'; // täyttää 17 vuotta 2017-03-15
  it('päivää ennen 17-vuotispäivää: ei', () => {
    expect(velvollisuudet(syntynyt, '2017-03-14').tyel).toBe(false);
  });
  it('17-vuotispäivänä: ei (vasta seuraavan kuukauden alusta)', () => {
    expect(velvollisuudet(syntynyt, '2017-03-15').tyel).toBe(false);
    expect(velvollisuudet(syntynyt, '2017-03-31').tyel).toBe(false);
  });
  it('seuraavan kuukauden 1. päivänä: kyllä', () => {
    expect(velvollisuudet(syntynyt, '2017-04-01').tyel).toBe(true);
  });
});

describe('velvollisuudet: TyEL yläraja (68/69/70 syntymävuoden mukaan)', () => {
  it('1957 tai aiemmin: 68 v, kuukauden loppuun', () => {
    const s = '1957-06-10'; // 68 v 2025-06-10
    expect(velvollisuudet(s, '2025-06-09').tyel).toBe(true);
    expect(velvollisuudet(s, '2025-06-10').tyel).toBe(true);
    expect(velvollisuudet(s, '2025-06-30').tyel).toBe(true);
    expect(velvollisuudet(s, '2025-07-01').tyel).toBe(false);
  });
  it('1957-12-31 on vielä 68-vuotiaiden ryhmää', () => {
    const s = '1957-12-31';
    expect(velvollisuudet(s, '2025-12-31').tyel).toBe(true);
    expect(velvollisuudet(s, '2026-01-01').tyel).toBe(false);
  });
  it('1958-1961: 69 v', () => {
    const s = '1958-01-01'; // 69 v 2027-01-01
    expect(velvollisuudet(s, '2026-02-01').tyel).toBe(true); // 68 v täynnä, yhä vakuutettu
    expect(velvollisuudet(s, '2027-01-31').tyel).toBe(true);
    expect(velvollisuudet(s, '2027-02-01').tyel).toBe(false);
    const s2 = '1961-12-31'; // 69 v 2030-12-31
    expect(velvollisuudet(s2, '2030-12-31').tyel).toBe(true);
    expect(velvollisuudet(s2, '2031-01-01').tyel).toBe(false);
  });
  it('1962 tai myöhemmin: 70 v', () => {
    const s = '1962-06-10'; // 70 v 2032-06-10
    expect(velvollisuudet(s, '2032-06-30').tyel).toBe(true);
    expect(velvollisuudet(s, '2032-07-01').tyel).toBe(false);
  });
});

describe('velvollisuudet: TyEL 53-62-vuotiaiden korotettu osuus (2025)', () => {
  const s = '1970-05-20'; // 53 v 2023-05-20, 63 v 2033-05-20
  it('alkaa 53 vuoden täyttämistä seuraavan kuukauden alusta', () => {
    expect(velvollisuudet(s, '2023-05-19').tyel53_62).toBe(false);
    expect(velvollisuudet(s, '2023-05-31').tyel53_62).toBe(false);
    expect(velvollisuudet(s, '2023-06-01').tyel53_62).toBe(true);
  });
  it('päättyy sen kuukauden loppuun, jona täyttää 63', () => {
    expect(velvollisuudet(s, '2033-05-31').tyel53_62).toBe(true);
    expect(velvollisuudet(s, '2033-06-01').tyel53_62).toBe(false);
  });
});

describe('velvollisuudet: työttömyysvakuutus (18 v ... 65 v)', () => {
  const alku = '2000-03-15'; // 18 v 2018-03-15
  it('alaraja: päivää ennen, syntymäpäivänä ja kuukautta myöhemmin', () => {
    expect(velvollisuudet(alku, '2018-03-14').tvr).toBe(false);
    expect(velvollisuudet(alku, '2018-03-15').tvr).toBe(false);
    expect(velvollisuudet(alku, '2018-03-31').tvr).toBe(false);
    expect(velvollisuudet(alku, '2018-04-01').tvr).toBe(true);
  });
  const loppu = '1960-03-15'; // 65 v 2025-03-15
  it('yläraja: päättyy 65-vuotispäivää seuraavan kuukauden alkuun', () => {
    expect(velvollisuudet(loppu, '2025-03-14').tvr).toBe(true);
    expect(velvollisuudet(loppu, '2025-03-15').tvr).toBe(true);
    expect(velvollisuudet(loppu, '2025-03-31').tvr).toBe(true);
    expect(velvollisuudet(loppu, '2025-04-01').tvr).toBe(false);
  });
});

describe('velvollisuudet: työnantajan sairausvakuutusmaksu (16 v ... 68 v)', () => {
  const alku = '2000-03-15'; // 16 v 2016-03-15
  it('alaraja: alkaa sen kalenterikuukauden jälkeen, jona täyttää 16', () => {
    expect(velvollisuudet(alku, '2016-03-14').sava).toBe(false);
    expect(velvollisuudet(alku, '2016-03-15').sava).toBe(false);
    expect(velvollisuudet(alku, '2016-03-31').sava).toBe(false);
    expect(velvollisuudet(alku, '2016-04-01').sava).toBe(true);
  });
  const loppu = '1960-03-15'; // 68 v 2028-03-15
  it('yläraja: maksu kuuluu vielä 68-vuotiskuukaudelta, ei sen jälkeen', () => {
    expect(velvollisuudet(loppu, '2028-03-14').sava).toBe(true);
    expect(velvollisuudet(loppu, '2028-03-15').sava).toBe(true);
    expect(velvollisuudet(loppu, '2028-03-31').sava).toBe(true);
    expect(velvollisuudet(loppu, '2028-04-01').sava).toBe(false);
  });
});

describe('velvollisuudet: syötteen tarkistus', () => {
  it('virheellinen päivämäärä aiheuttaa PalkatVirhe SYOTE', () => {
    expect(() => velvollisuudet('2000-13-01', '2020-01-01')).toThrowError(/pvm/i);
  });
});
