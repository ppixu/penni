import { describe, expect, it } from 'vitest';
import {
  type VerokausiHistoria,
  alvErapaiva,
  alvKausiKk,
  alvKausiPaivalle,
  erapaivanVari,
  historiaAsetuksiksi,
  kausiKkPaivalle,
  lisaaVerokausiMuutos,
  muutoksenAlku,
  onKaudenAlku,
  parsiIlmoitusOtsikko,
  peruTulevatMuutokset,
  seuraavaAlvKausi,
  siirraKautta,
  verokausiHistoria,
  viimeisinIlmoitettu,
} from './alvKaudet.js';

describe('alvKausiKk', () => {
  it("lukee legacy-asetuksen arvot '1', '3' ja '12'", () => {
    expect(alvKausiKk({ AlvKausi: '1' })).toBe(1);
    expect(alvKausiKk({ AlvKausi: '3' })).toBe(3);
    expect(alvKausiKk({ AlvKausi: '12' })).toBe(12);
  });

  it('puuttuva tai tuntematon arvo on kuukausi', () => {
    expect(alvKausiKk({})).toBe(1);
    expect(alvKausiKk({ AlvKausi: 'roska' })).toBe(1);
  });
});

describe('seuraavaAlvKausi', () => {
  const TILIKAUDET = [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }];

  it('raja + 1 pv → kalenterikuukauden loppuun', () => {
    expect(seuraavaAlvKausi('2026-02-28', 1, '2026-01-01', TILIKAUDET)).toEqual({
      alkupvm: '2026-03-01',
      loppupvm: '2026-03-31',
    });
  });

  it('vajaa ensimmäinen kausi: AlvAlkaa kesken kuukauden', () => {
    expect(seuraavaAlvKausi(undefined, 1, '2026-03-15', TILIKAUDET)).toEqual({
      alkupvm: '2026-03-15',
      loppupvm: '2026-03-31',
    });
  });

  it('neljännesvuosi ankkuroituu kalenterineljännekseen', () => {
    expect(seuraavaAlvKausi('2026-03-31', 3, undefined, TILIKAUDET)).toEqual({
      alkupvm: '2026-04-01',
      loppupvm: '2026-06-30',
    });
  });

  it('vuosikausi päättyy kalenterivuoden loppuun (vajaanakin)', () => {
    expect(seuraavaAlvKausi(undefined, 12, '2026-03-15', TILIKAUDET)).toEqual({
      alkupvm: '2026-03-15',
      loppupvm: '2026-12-31',
    });
  });

  it('tyhjä raja ohitetaan; ilman AlvAlkaata pohjana on ensimmäinen tilikausi', () => {
    expect(seuraavaAlvKausi('', 1, undefined, TILIKAUDET)).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-01-31',
    });
  });

  it('kaikkien lähteiden puuttuessa null (ei kirjanpitoa)', () => {
    expect(seuraavaAlvKausi(undefined, 1, undefined, [])).toBeNull();
  });

  it('vuodenvaihde: raja 31.12. → tammikuu', () => {
    expect(seuraavaAlvKausi('2026-12-31', 1, undefined, TILIKAUDET)).toEqual({
      alkupvm: '2027-01-01',
      loppupvm: '2027-01-31',
    });
  });
});

describe('siirraKautta', () => {
  it('kuukausi eteen ja taakse', () => {
    const maaliskuu = { alkupvm: '2026-03-01', loppupvm: '2026-03-31' };
    expect(siirraKautta(maaliskuu, 1, 1)).toEqual({
      alkupvm: '2026-04-01',
      loppupvm: '2026-04-30',
    });
    expect(siirraKautta(maaliskuu, -1, 1)).toEqual({
      alkupvm: '2026-02-01',
      loppupvm: '2026-02-28',
    });
  });

  it('neljännes ja vuosi eteen ja taakse', () => {
    const q2 = { alkupvm: '2026-04-01', loppupvm: '2026-06-30' };
    expect(siirraKautta(q2, 1, 3)).toEqual({ alkupvm: '2026-07-01', loppupvm: '2026-09-30' });
    expect(siirraKautta(q2, -1, 3)).toEqual({ alkupvm: '2026-01-01', loppupvm: '2026-03-31' });
    const vuosi = { alkupvm: '2026-01-01', loppupvm: '2026-12-31' };
    expect(siirraKautta(vuosi, 1, 12)).toEqual({ alkupvm: '2027-01-01', loppupvm: '2027-12-31' });
  });

  it('vajaasta kaudesta eteenpäin ankkuroidutaan kalenteriin', () => {
    expect(siirraKautta({ alkupvm: '2026-03-15', loppupvm: '2026-03-31' }, 1, 1)).toEqual({
      alkupvm: '2026-04-01',
      loppupvm: '2026-04-30',
    });
  });

  it('karkausvuoden helmikuu 2028', () => {
    expect(siirraKautta({ alkupvm: '2028-01-01', loppupvm: '2028-01-31' }, 1, 1)).toEqual({
      alkupvm: '2028-02-01',
      loppupvm: '2028-02-29',
    });
  });
});

describe('alvErapaiva', () => {
  it('kuukausikausi: toiseksi seuraavan kuun 12. päivä', () => {
    expect(alvErapaiva('2026-03-31', 1)).toBe('2026-05-12'); // tiistai
    expect(alvErapaiva('2026-01-31', 1)).toBe('2026-03-12'); // torstai
  });

  it('neljänneskausi: sama sääntö', () => {
    expect(alvErapaiva('2026-06-30', 3)).toBe('2026-08-12'); // keskiviikko
  });

  it('viikonloppu siirtyy eteenpäin arkipäivään', () => {
    expect(alvErapaiva('2026-05-31', 1)).toBe('2026-07-13'); // 12.7.2026 on sunnuntai → ma
    expect(alvErapaiva('2026-07-31', 1)).toBe('2026-09-14'); // 12.9.2026 on lauantai → ma
  });

  it('neljänneskausi Q3 → 12.11.', () => {
    expect(alvErapaiva('2026-09-30', 3)).toBe('2026-11-12'); // torstai
  });

  it('arkipäivälle osuva pyhä siirtää eteenpäin seuraavaan arkipäivään', () => {
    // 12.4.2047 on pitkäperjantai → la, su, 2. pääsiäispäivä (ma 15.4.) → ti 16.4.
    expect(alvErapaiva('2047-02-28', 1)).toBe('2047-04-16');
    // Kiinteät pyhät eivät osu 12. päivään eivätkä helmikuun loppuun; pääsiäisestä
    // riippuvat (pitkäperjantai, 2. pääsiäispäivä, helatorstai) voivat.
    expect(alvErapaiva('2058-02-28', 1)).toBe('2058-04-16'); // 12.4.2058 pitkäperjantai
  });

  it('vuosikausi: loppupvm + 2 kk, päivä clampattuna kuun pituuteen', () => {
    expect(alvErapaiva('2027-12-31', 12)).toBe('2028-02-29'); // karkausvuosi, keskiviikko
    expect(alvErapaiva('2026-12-31', 12)).toBe('2027-03-01'); // 28.2.2027 on sunnuntai → ma
  });
});

describe('erapaivanVari', () => {
  it('eräpäivä tänään tai ohi → danger', () => {
    expect(erapaivanVari('2026-06-10', '2026-06-10')).toBe('danger');
    expect(erapaivanVari('2026-06-10', '2026-06-11')).toBe('danger');
  });

  it('alle 6 pv → warn, muuten normal', () => {
    expect(erapaivanVari('2026-06-10', '2026-06-09')).toBe('warn');
    expect(erapaivanVari('2026-06-10', '2026-06-05')).toBe('warn');
    expect(erapaivanVari('2026-06-10', '2026-06-04')).toBe('normal');
  });
});

describe('viimeisinIlmoitettu', () => {
  const ilm = (otsikko: string) => ({ otsikko });
  it('suurin AlvIlmoitettu-rajasta ja ilmoitusten kausista', () => {
    expect(
      viimeisinIlmoitettu(undefined, [
        ilm('Arvonlisäveroilmoitus 01.01.2025 - 31.03.2025'),
        ilm('Arvonlisäveroilmoitus 01.04.2025 - 30.06.2025'),
      ]),
    ).toBe('2025-06-30');
    expect(viimeisinIlmoitettu('2025-09-30', [ilm('Arvonlisävero 2025-01-01 – 2025-03-31')])).toBe(
      '2025-09-30',
    );
    expect(viimeisinIlmoitettu('', [])).toBeUndefined();
  });
});

describe('parsiIlmoitusOtsikko', () => {
  it('parsii moottorin kirjoittaman otsikon', () => {
    expect(parsiIlmoitusOtsikko('Arvonlisävero 2026-03-01 – 2026-03-31')).toEqual({
      alkupvm: '2026-03-01',
      loppupvm: '2026-03-31',
    });
  });

  it('parsii Kitsaksen tuodun otsikon (d.m.vvvv)', () => {
    expect(parsiIlmoitusOtsikko('Arvonlisäveroilmoitus 01.01.2025 - 31.03.2025')).toEqual({
      alkupvm: '2025-01-01',
      loppupvm: '2025-03-31',
    });
    expect(parsiIlmoitusOtsikko('Arvonlisäveroilmoitus 1.4.2025 - 30.6.2025')).toEqual({
      alkupvm: '2025-04-01',
      loppupvm: '2025-06-30',
    });
  });

  it('roskasyöte, yksi päivä tai väärä järjestys → null', () => {
    expect(parsiIlmoitusOtsikko('Roskaa')).toBeNull();
    expect(parsiIlmoitusOtsikko('Arvonlisävero 2026-03-01')).toBeNull();
    expect(parsiIlmoitusOtsikko('Arvonlisävero 2026-03-31 – 2026-03-01')).toBeNull();
  });
});

describe('verokausihistoria', () => {
  // Kuukausi 2025 asti, neljännes 2026 alusta, kuukausi taas 1.11.2026 alkaen.
  const H: VerokausiHistoria = [
    { alkaa: '', kk: 1 },
    { alkaa: '2026-01-01', kk: 3 },
    { alkaa: '2026-11-01', kk: 1 },
  ];

  it('ilman historiaa koko kirja on legacy-AlvKausin pituinen', () => {
    expect(verokausiHistoria({ AlvKausi: '3' })).toEqual([{ alkaa: '', kk: 3 }]);
    expect(verokausiHistoria({ AlvKausiHistoria: 'roskaa', AlvKausi: '12' })).toEqual([
      { alkaa: '', kk: 12 },
    ]);
  });

  it('lukee historian järjestykseen ja ensimmäinen rivi kattaa alun', () => {
    const raaka = JSON.stringify([
      { alkaa: '2026-01-01', kk: 3 },
      { alkaa: '2024-01-01', kk: 1 },
      { alkaa: 'x', kk: 3 },
      { alkaa: '2027-01-01', kk: 7 },
    ]);
    expect(verokausiHistoria({ AlvKausiHistoria: raaka })).toEqual([
      { alkaa: '', kk: 1 },
      { alkaa: '2026-01-01', kk: 3 },
    ]);
  });

  it('pituus päivälle', () => {
    expect(kausiKkPaivalle(H, '2025-06-01')).toBe(1);
    expect(kausiKkPaivalle(H, '2026-01-01')).toBe(3);
    expect(kausiKkPaivalle(H, '2026-11-15')).toBe(1);
    expect(kausiKkPaivalle(12, '2026-11-15')).toBe(12);
  });

  it('menneet kaudet säilyttävät pituutensa', () => {
    expect(alvKausiPaivalle('2025-12-10', H)).toEqual({
      alkupvm: '2025-12-01',
      loppupvm: '2025-12-31',
    });
    expect(alvKausiPaivalle('2026-05-10', H)).toEqual({
      alkupvm: '2026-04-01',
      loppupvm: '2026-06-30',
    });
  });

  it('kesken neljänneksen alkava kuukausikausi katkaisee neljänneksen', () => {
    expect(alvKausiPaivalle('2026-10-10', H)).toEqual({
      alkupvm: '2026-10-01',
      loppupvm: '2026-10-31',
    });
    expect(alvKausiPaivalle('2026-11-10', H)).toEqual({
      alkupvm: '2026-11-01',
      loppupvm: '2026-11-30',
    });
  });

  it('selaus ylittää pituuden vaihdoksen', () => {
    expect(siirraKautta({ alkupvm: '2025-12-01', loppupvm: '2025-12-31' }, 1, H)).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-03-31',
    });
    expect(siirraKautta({ alkupvm: '2026-01-01', loppupvm: '2026-03-31' }, -1, H)).toEqual({
      alkupvm: '2025-12-01',
      loppupvm: '2025-12-31',
    });
    expect(seuraavaAlvKausi('2026-09-30', H, undefined, [])).toEqual({
      alkupvm: '2026-10-01',
      loppupvm: '2026-10-31',
    });
  });

  it('eräpäivä kauden omalla pituudella', () => {
    const vuosi: VerokausiHistoria = [
      { alkaa: '', kk: 3 },
      { alkaa: '2027-01-01', kk: 12 },
    ];
    expect(alvErapaiva('2026-12-31', vuosi)).toBe('2027-02-12');
    expect(alvErapaiva('2027-12-31', vuosi)).toBe('2028-02-29');
  });

  it('muutoksen alku: pidempi seuraavan vuoden alusta, lyhyempi seuraavan kauden alusta', () => {
    expect(muutoksenAlku(1, 3, '2026-10-25')).toBe('2027-01-01');
    expect(muutoksenAlku(3, 12, '2026-10-25')).toBe('2027-01-01');
    expect(muutoksenAlku(3, 1, '2026-10-25')).toBe('2026-11-01');
    expect(muutoksenAlku(12, 3, '2026-10-25')).toBe('2027-01-01');
    expect(muutoksenAlku(12, 3, '2026-05-25')).toBe('2026-07-01');
    expect(muutoksenAlku(3, 3, '2026-10-25')).toBeNull();
  });

  it('lisää muutoksen, korvaa myöhemmät ja jättää turhan rivin pois', () => {
    expect(lisaaVerokausiMuutos(H, '2027-01-01', 12)).toEqual([
      ...H,
      { alkaa: '2027-01-01', kk: 12 },
    ]);
    expect(lisaaVerokausiMuutos(H, '2026-11-01', 3)).toEqual([
      { alkaa: '', kk: 1 },
      { alkaa: '2026-01-01', kk: 3 },
    ]);
    expect(peruTulevatMuutokset(H, '2026-10-25')).toEqual([
      { alkaa: '', kk: 1 },
      { alkaa: '2026-01-01', kk: 3 },
    ]);
  });

  it('muutos voi alkaa vain uuden pituuden kauden alusta', () => {
    expect(onKaudenAlku('2026-07-01', 3)).toBe(true);
    expect(onKaudenAlku('2026-08-01', 3)).toBe(false);
    expect(onKaudenAlku('2027-01-01', 12)).toBe(true);
  });

  it('asetuksiksi: legacy-AlvKausi on tämänhetkinen pituus', () => {
    expect(historiaAsetuksiksi(H, '2026-10-25')).toEqual({
      AlvKausiHistoria: JSON.stringify(H),
      AlvKausi: '3',
    });
  });
});
