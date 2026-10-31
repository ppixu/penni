import { yritysTilit } from '@penni/charts';
import { type TiliData, type TositeVienti, lataaKartta } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  alaryhmanOtsikko,
  alkunakyma,
  etuliitteenNumero,
  kayttovali,
  kokoaTilienKaytto,
  lueTiliHaku,
  ryhmanOtsikko,
  ryhmienEtuliitteet,
  ryhmitteleTilit,
  tasmaaTiliHakuun,
  tiliRajauksessa,
  tilinEtuliite,
  tilinRyhmat,
  tilitNakymassa,
  vertaaTilinumeroita,
} from './tilinakyma.js';

function vienti(tili: number, pvm: string): TositeVienti {
  return {
    tili,
    debet: Euro.fromCents(100),
    kredit: Euro.fromCents(0),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
  };
}

describe('kokoaTilienKaytto', () => {
  it('laskee tilikohtaisen viimeisimmän päivän ja kirjausmäärän', () => {
    const kaytto = kokoaTilienKaytto([
      vienti(3000, '2026-02-01'),
      vienti(1910, '2026-03-15'),
      vienti(3000, '2026-04-10'),
      vienti(3000, '2026-01-05'),
    ]);
    expect(kaytto.get(3000)).toEqual({ viimeksi: '2026-04-10', maara: 3 });
    expect(kaytto.get(1910)).toEqual({ viimeksi: '2026-03-15', maara: 1 });
    expect(kaytto.has(4000)).toBe(false);
  });

  it('tyhjästä tulee tyhjä', () => {
    expect(kokoaTilienKaytto([]).size).toBe(0);
  });
});

describe('kayttovali', () => {
  it('kattaa kaksi viimeisintä tilikautta alkamisjärjestyksessä', () => {
    expect(
      kayttovali([
        { alkaa: '2026-01-01', loppuu: '2026-12-31' },
        { alkaa: '2024-01-01', loppuu: '2024-12-31' },
        { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      ]),
    ).toEqual({ alkupvm: '2025-01-01', loppupvm: '2026-12-31' });
  });

  it('yksi tilikausi riittää; ilman tilikausia ei väliä', () => {
    expect(kayttovali([{ alkaa: '2026-01-01', loppuu: '2026-12-31' }])).toEqual({
      alkupvm: '2026-01-01',
      loppupvm: '2026-12-31',
    });
    expect(kayttovali([])).toBeNull();
  });

  it('seuraa valittua tilikautta: valittu ja sitä edeltävä', () => {
    const kaudet = [
      { alkaa: '2024-01-01', loppuu: '2024-12-31' },
      { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      { alkaa: '2026-01-01', loppuu: '2026-12-31' },
    ];
    expect(kayttovali(kaudet, '2025-01-01')).toEqual({
      alkupvm: '2024-01-01',
      loppupvm: '2025-12-31',
    });
    expect(kayttovali(kaudet, '2024-01-01')).toEqual({
      alkupvm: '2024-01-01',
      loppupvm: '2024-12-31',
    });
  });
});

describe('alkunakyma', () => {
  it('suosikit ensin, sitten käytetyt, muuten kaikki', () => {
    expect(alkunakyma(2, 5)).toBe('suosikit');
    expect(alkunakyma(0, 5)).toBe('viimeksi');
    expect(alkunakyma(0, 0)).toBe('kaikki');
  });
});

describe('tasmaaTiliHakuun', () => {
  const tili = { numero: 3000, nimi: 'Myynti' };
  it('numerohaku on etuliite, tekstihaku osajono ilman kirjainkokoa', () => {
    expect(tasmaaTiliHakuun(tili.numero, tili.nimi, '30')).toBe(true);
    expect(tasmaaTiliHakuun(tili.numero, tili.nimi, '00')).toBe(false);
    expect(tasmaaTiliHakuun(tili.numero, tili.nimi, 'YYN')).toBe(true);
    expect(tasmaaTiliHakuun(tili.numero, tili.nimi, 'osto')).toBe(false);
    expect(tasmaaTiliHakuun(tili.numero, tili.nimi, '  ')).toBe(true);
  });
});

describe('lueTiliHaku', () => {
  it('hyväksyy positiivisen kokonaisluvun numerona tai merkkijonona', () => {
    expect(lueTiliHaku(4000)).toBe(4000);
    expect(lueTiliHaku('4000')).toBe(4000);
  });

  it('hylkää puuttuvan, nollan, desimaalin ja tekstin', () => {
    for (const arvo of [undefined, null, 0, -1, 40.5, '', 'abc', '40a', {}]) {
      expect(lueTiliHaku(arvo)).toBeUndefined();
    }
  });
});

describe('tilitNakymassa', () => {
  const lehdet = lataaKartta([
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 7690, tyyppi: 'D', nimi: { fi: 'Atk' } },
  ]);
  const kaytto = new Map([
    [4000, { viimeksi: '2026-06-01', maara: 2 }],
    [7690, { viimeksi: '2026-09-01', maara: 1 }],
  ]);
  const numerot = (t: readonly { numero: number }[]) => t.map((x) => x.numero);

  it('suosikit numerojärjestyksessä', () => {
    const tilit = tilitNakymassa(lehdet, 'suosikit', {
      suosikit: new Set([7690, 1910]),
      piilotetut: new Set(),
      kaytto,
    });
    expect(numerot(tilit)).toEqual([1910, 7690]);
  });

  it('viimeksi käytetyt uusin ensin, piilotetut pois', () => {
    expect(
      numerot(
        tilitNakymassa(lehdet, 'viimeksi', { suosikit: new Set(), piilotetut: new Set(), kaytto }),
      ),
    ).toEqual([7690, 4000]);
    expect(
      numerot(
        tilitNakymassa(lehdet, 'viimeksi', {
          suosikit: new Set(),
          piilotetut: new Set([7690]),
          kaytto,
        }),
      ),
    ).toEqual([4000]);
  });

  it('kaikki numerojärjestyksessä ilman piilotettuja, ellei niitä pyydetä', () => {
    const asetukset = { suosikit: new Set<number>(), piilotetut: new Set([4000]), kaytto };
    expect(numerot(tilitNakymassa(lehdet, 'kaikki', asetukset))).toEqual([1910, 7690]);
    expect(
      numerot(tilitNakymassa(lehdet, 'kaikki', { ...asetukset, naytaPiilotetut: true })),
    ).toEqual([1910, 4000, 7690]);
  });
});

describe('ryhmanOtsikko ja ryhmitteleTilit', () => {
  // Ote Kitsaksen yritystilikartan otsikoista.
  const kartta = lataaKartta([
    { numero: 1, tyyppi: 'H1', nimi: { fi: 'Vastaavaa' } },
    { numero: 10, tyyppi: 'H2', nimi: { fi: 'Pysyvät vastaavat' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 2, tyyppi: 'H1', nimi: { fi: 'Vastattavaa' } },
    { numero: 239, tyyppi: 'H2', nimi: { fi: 'Vähemmistöosuudet' } },
    { numero: 24, tyyppi: 'H2', nimi: { fi: 'Tilinpäätössiirtojen kertymä' } },
    { numero: 3, tyyppi: 'H1', nimi: { fi: 'Tuloslaskelma' } },
    { numero: 3, tyyppi: 'H2', nimi: { fi: 'Myyntituotot' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 5, tyyppi: 'H2', nimi: { fi: 'Henkilöstökulut' } },
    { numero: 5, tyyppi: 'H3', nimi: { fi: 'Palkat ja palkkiot' } },
    { numero: 6100, tyyppi: 'D', nimi: { fi: 'Eläkevakuutukset' } },
    { numero: 68, tyyppi: 'H2', nimi: { fi: 'Poistot ja arvonalentumiset' } },
  ]);

  it('valitsee ryhmän alkuun osuvan otsikon, H2 ennen H1:tä, ei H3:a', () => {
    expect(ryhmanOtsikko(kartta, 1)).toBe('Vastaavaa');
    expect(ryhmanOtsikko(kartta, 2)).toBe('Vastattavaa');
    expect(ryhmanOtsikko(kartta, 3)).toBe('Myyntituotot');
    expect(ryhmanOtsikko(kartta, 5)).toBe('Henkilöstökulut');
  });

  it('perii edellisen otsikon, kun ryhmän alussa ei ole omaa (68 alkaa vasta 6800:sta)', () => {
    expect(ryhmanOtsikko(kartta, 6)).toBe('Henkilöstökulut');
  });

  it('on tyhjä, kun ennen ryhmää ei ole otsikkoa', () => {
    expect(ryhmanOtsikko(lataaKartta([{ numero: 1900, tyyppi: 'ARP' }]), 1)).toBe('');
  });

  it('ryhmittelee tilit kahdelle tasolle: ensimmäinen numero ja kaksi ensimmäistä', () => {
    const lehdet = kartta.filter((t) => t.otsikkotaso === 0);
    expect(
      ryhmitteleTilit(lehdet, kartta).map((r) => [
        r.etuliite,
        r.nimi,
        r.tilit.map((t) => t.numero),
        r.alaryhmat.map((a) => [a.etuliite, a.tilit.map((t) => t.numero)]),
      ]),
    ).toEqual([
      ['1', 'Vastaavaa', [1900], [['19', [1900]]]],
      ['3', 'Myyntituotot', [3000], [['30', [3000]]]],
      ['6', 'Henkilöstökulut', [6100], [['61', [6100]]]],
    ]);
  });

  it('viisinumeroinen tili ei toista ryhmää: 29391 kuuluu 2939:n perään (Kitsaksen järjestys)', () => {
    const tilit = lataaKartta([
      { numero: 3000, tyyppi: 'CL' },
      { numero: 29391, tyyppi: 'BL' },
      { numero: 2939, tyyppi: 'BL' },
      { numero: 2940, tyyppi: 'BL' },
      { numero: 10001, tyyppi: 'A' },
      { numero: 1910, tyyppi: 'ARP' },
    ]);
    const ryhmat = ryhmitteleTilit(tilit, []);
    expect(ryhmat.map((r) => r.etuliite)).toEqual(['1', '2', '3']);
    expect(ryhmat[0]?.alaryhmat.map((a) => a.etuliite)).toEqual(['10', '19']);
    expect(ryhmat[1]?.tilit.map((t) => t.numero)).toEqual([2939, 29391, 2940]);
    expect(ryhmienEtuliitteet(ryhmat)).toEqual(['1', '10', '19', '2', '29', '3', '30']);
  });
});

describe('alaryhmanOtsikko vakiotilikartalla', () => {
  const kartta = lataaKartta(yritysTilit as TiliData[]);

  it('syvin H2–H4-otsikko, joka kattaa koko ryhmän', () => {
    expect(alaryhmanOtsikko(kartta, '11')).toBe('Aineelliset hyödykkeet');
    expect(alaryhmanOtsikko(kartta, '15')).toBe('Vaihto-omaisuus');
    expect(alaryhmanOtsikko(kartta, '19')).toBe('Rahat ja pankkisaamiset');
    expect(alaryhmanOtsikko(kartta, '29')).toBe('Lyhytaikainen vieras pääoma');
    expect(alaryhmanOtsikko(kartta, '78')).toBe('Matkakulut');
  });

  it('ei yläotsikkoa vaativaa H5-otsikkoa ("Muilta")', () => {
    expect(alaryhmanOtsikko(kartta, '92')).toBe('Muut korko- ja rahoitustuotot');
  });

  it('ilman kattavaa H2–H4-otsikkoa ylin otsikko, jonka alueelle ryhmän alku osuu', () => {
    expect(alaryhmanOtsikko(kartta, '23')).toBe('Oma pääoma');
    expect(alaryhmanOtsikko(kartta, '99')).toBe('Tuloverot');
  });
});

describe('tilinEtuliite, tilinRyhmat ja tiliRajauksessa', () => {
  it('etuliitteet ja näytettävä numero', () => {
    expect(tilinEtuliite(29391, 2)).toBe('29');
    expect(tilinEtuliite(5, 2)).toBe('50');
    expect(tilinRyhmat(1910)).toEqual(['1', '19']);
    expect(etuliitteenNumero('1')).toBe('1000');
    expect(etuliitteenNumero('11')).toBe('1100');
  });

  it('järjestää ysilukuina', () => {
    expect([2940, 29391, 2939].sort(vertaaTilinumeroita)).toEqual([2939, 29391, 2940]);
  });

  it('tarkka tili tai etuliite; ilman rajausta kaikki', () => {
    expect(tiliRajauksessa(1910, { tili: 1910 })).toBe(true);
    expect(tiliRajauksessa(19100, { tili: 1910 })).toBe(false);
    expect(tiliRajauksessa(19100, { tiliryhma: '19' })).toBe(true);
    expect(tiliRajauksessa(2000, { tiliryhma: '19' })).toBe(false);
    expect(tiliRajauksessa(2000, {})).toBe(true);
  });
});

describe('ryhmitteleTilit: toistuvien nimien tarkenteet vakiotilikartalla', () => {
  const kartta = lataaKartta(yritysTilit as TiliData[]);
  const lehdet = kartta.filter((t) => t.otsikkotaso === 0);
  const ryhmat = ryhmitteleTilit(lehdet, kartta);
  const paa = (e: string) => ryhmat.find((r) => r.etuliite === e);
  const ala = (e: string) => paa(e[0] ?? '')?.alaryhmat.find((a) => a.etuliite === e);
  const otsikko = (r: { nimi: string; tarkenne: string } | undefined) =>
    r && (r.tarkenne ? `${r.nimi} (${r.tarkenne})` : r.nimi);

  it('pääryhmät erottuvat sisältönsä otsikoista', () => {
    expect(otsikko(paa('5'))).toBe('Henkilöstökulut (palkat ja palkkiot)');
    expect(otsikko(paa('6'))).toBe(
      'Henkilöstökulut (henkilösivukulut; poistot ja arvonalentumiset)',
    );
    expect(otsikko(paa('8'))).toBe('Liiketoiminnan muut kulut (myyntikulut; markkinointikulut…)');
  });

  it('alaryhmät erottuvat H5-otsikoista, ja pääryhmän nimen toistava saa tarkenteen', () => {
    expect(otsikko(ala('41'))).toBe(
      'Ostot tilikauden aikana (tavaratuonti; ostot, käytetyt tavarat ja taide- keräily- ja antiikkiesineet)',
    );
    expect(otsikko(ala('43'))).toBe('Ostot tilikauden aikana (ostojen oikaisuerät)');
    expect(otsikko(ala('44'))).toBe(
      'Materiaalit ja palvelut (aineet, tarvikkeet ja tavarat; ulkopuoliset palvelut)',
    );
  });

  it('pelkkä "Muille"-otsikko ei kelpaa: tarkenne ensimmäisestä ja viimeisestä tilistä', () => {
    expect(otsikko(ala('95'))).toBe(
      'Korkokulut ja muut rahoituskulut (korkokulut rahoitusvekseleistä … luottovakuutukset)',
    );
    expect(otsikko(ala('96'))).toBe(
      'Korkokulut ja muut rahoituskulut (kiinnityskulut … muut rahoituskulut)',
    );
  });

  it('ainutkertainen nimi ei saa tarkennetta, mutta sisältö on vihjettä varten', () => {
    expect(paa('1')?.tarkenne).toBe('');
    expect(paa('1')?.sisalto).toEqual(['Pysyvät vastaavat', 'Vaihtuvat vastaavat']);
  });

  it('nimi ei vaihdu, vaikka haku jättäisi toistuvan ryhmän pois', () => {
    const vainVitoset = ryhmitteleTilit(
      lehdet.filter((t) => String(t.numero).startsWith('5')),
      kartta,
    );
    expect(vainVitoset[0]?.tarkenne).toBe('palkat ja palkkiot');
  });
});
