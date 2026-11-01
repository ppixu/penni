import type { PalkkaHenkilo } from '@penni/engine';
import type { Tyontekija } from '@penni/palkat';
import { describe, expect, it } from 'vitest';
import {
  HETU,
  KORTTI,
  TYONANTAJA,
  TYONTEKIJA,
  VUODEN_ALUSTA,
  YKSILO_JA_TARKISTE,
  c,
  tapausA,
} from './fikstuuri.testapu.js';
import { palkkalaskelmaMalli, palkkalaskelmanNimi } from './palkkalaskelmaMalli.js';

function malli(osa: { henkilo?: PalkkaHenkilo; t?: Tyontekija } = {}) {
  const { henkilo, ajo } = tapausA(osa.t);
  return palkkalaskelmaMalli({
    henkilo: osa.henkilo ?? henkilo,
    ajo,
    maksupaiva: '2026-10-31',
    tyontekija: osa.t ?? TYONTEKIJA,
    tyonantaja: TYONANTAJA,
    vuodenAlusta: VUODEN_ALUSTA,
  });
}

const norm = (s: string) => s.replace(/[\u00a0\u202f\u2009]/g, ' ');

describe('palkkalaskelmaMalli: tapaus A', () => {
  it('ryhmittelee rivit: palkka, edut (ei makseta rahana), verovapaat, vähennykset', () => {
    const m = malli();
    const ryhmat = m.rivit.map((r) => [r.ryhma, norm(r.selite)]);
    expect(ryhmat).toEqual([
      ['palkka', 'Kuukausipalkka'],
      ['edut', 'Puhelinetu (ei makseta rahana)'],
      ['verovapaat', 'Helsinki–Espoo asiakaskäynti'],
      ['vahennykset', 'Ennakonpidätys'],
      ['vahennykset', 'Työntekijän TyEL-maksu 7,30 %'],
      ['vahennykset', 'Työntekijän työttömyysvakuutusmaksu 0,89 %'],
    ]);
  });

  it('muotoilee summat suomalaisittain, vähennykset miinusmerkkisinä', () => {
    const m = malli();
    expect(m.rivit.map((r) => norm(r.summa))).toEqual([
      '3 000,00 €',
      '20,00 €',
      '55,00 €',
      '−604,00 €',
      '−220,46 €',
      '−26,88 €',
    ]);
    expect(norm(m.nettopalkka)).toBe('2 203,66 €');
  });

  it('näyttää määrän ja a-hinnan km-riville', () => {
    const km = malli().rivit.find((r) => r.ryhma === 'verovapaat');
    expect(norm(km?.maara ?? '')).toBe('100 km');
    expect(norm(km?.ahinta ?? '')).toBe('0,55 €');
  });

  it('kuvaa pidätyksen prosentin, tulorajan ja kertymän', () => {
    expect(norm(malli().pidatys)).toBe('20,0 % (tuloraja 30 000,00 €, kertymä 3 020,00 €)');
  });

  it('antaa työnantajan, kauden, maksupäivän, vuoden alun ja työntekijän tiedot', () => {
    const m = malli();
    expect(m.tyonantaja).toEqual({ nimi: 'Demo Oy', ytunnus: '1234567-8' });
    expect(m.kausi).toBe('1.10.2026 – 31.10.2026');
    expect(m.maksupaiva).toBe('31.10.2026');
    expect(norm(m.vuodenAlusta.brutto)).toBe('30 200,00 €');
    expect(norm(m.vuodenAlusta.ennakonpidatys)).toBe('6 040,00 €');
    expect(norm(m.vuodenAlusta.netto)).toBe('22 036,60 €');
    expect(m.tyontekija).toEqual({
      nimi: 'Testi Työntekijä',
      syntymaaika: '01.01.1990',
      osoite: ['Testikatu 1 A 2', '00100 Helsinki'],
      iban: 'FI21 1234 5600 0007 85',
    });
  });

  it('ei sisällä henkilötunnuksen yksilönumeroa eikä tarkistemerkkiä', () => {
    const json = JSON.stringify(malli());
    expect(json).not.toContain(HETU);
    expect(json).not.toContain(YKSILO_JA_TARKISTE);
  });
});

describe('palkkalaskelmaMalli: pidätys', () => {
  it('kaksi osaa kun tuloraja ylittyy', () => {
    const t = { ...TYONTEKIJA, verokortit: [{ ...KORTTI, tuloraja: c(300_000) }] };
    const { henkilo } = tapausA(t);
    expect(henkilo.tulos.pidatysOsat.length).toBe(2);
    const p = norm(malli({ t, henkilo }).pidatys);
    expect(p).toContain('20,0 %');
    expect(p).toContain('40,0 %');
    expect(p).toContain('tuloraja 3 000,00 €');
    expect(p).toContain('kertymä 3 020,00 €');
  });

  it('tammikuun sääntö: edellisen vuoden verokortti -huomautus', () => {
    const { henkilo } = tapausA();
    const h = {
      ...henkilo,
      verokortti: henkilo.verokortti && { ...henkilo.verokortti, tammikuuSaanto: true },
    };
    expect(malli({ henkilo: h }).pidatys).toContain('edellisen vuoden verokortti (tammikuu)');
  });

  it('ei verokorttia', () => {
    const { henkilo } = tapausA();
    const h = {
      ...henkilo,
      verokortti: null,
      tulos: {
        ...henkilo.tulos,
        pidatysOsat: [{ bp: 6000, peruste: henkilo.tulos.pidatysperuste }],
      },
    };
    const p = norm(malli({ henkilo: h }).pidatys);
    expect(p).toBe('60,0 % (ei verokorttia)');
  });

  it('ei pidätystä kun osia ei ole', () => {
    const { henkilo } = tapausA();
    const h = {
      ...henkilo,
      tulos: { ...henkilo.tulos, pidatysOsat: [], ennakonpidatys: c(0) },
    };
    const m = malli({ henkilo: h });
    expect(m.pidatys).toMatch(/^Ei ennakonpidätystä/);
    expect(m.rivit.some((r) => r.selite === 'Ennakonpidätys')).toBe(false);
  });
});

describe('palkkalaskelmaMalli: rivityypit', () => {
  it('ravintoetu: yksikköarvo = summa / lukumäärä, jotta määrä × a-hinta = summa', () => {
    const { henkilo } = tapausA(TYONTEKIJA, [
      { laji: 'kuukausipalkka', selite: 'Kuukausipalkka', summa: c(300_000) },
      { laji: 'ravintoetu', selite: 'Lounasetu', maara: 300, ahinta: c(1000) },
    ]);
    const rivi = malli({ henkilo }).rivit.find((r) => r.ryhma === 'edut');
    const alkup = henkilo.rivit.find((r) => r.laji === 'ravintoetu');
    expect(alkup?.summa).toBeGreaterThan(0);
    const arvo = Math.round(((alkup?.summa ?? 0) * 100) / 300);
    expect(norm(rivi?.maara ?? '')).toBe('3 kpl');
    expect(norm(rivi?.ahinta ?? '')).toBe(
      norm(`${Math.trunc(arvo / 100)},${String(arvo % 100).padStart(2, '0')} €`),
    );
    expect(rivi?.selite).toContain('ei makseta rahana');
  });

  it('tuntipalkka: tunnit desimaaleina ja tuntihinta', () => {
    const { henkilo } = tapausA(TYONTEKIJA, [
      { laji: 'tuntipalkka', selite: 'Tuntipalkka', maara: 3750, ahinta: c(2000) },
    ]);
    const rivi = malli({ henkilo }).rivit[0];
    expect(norm(rivi?.maara ?? '')).toBe('37,5 h');
    expect(norm(rivi?.ahinta ?? '')).toBe('20,00 €');
    expect(norm(rivi?.summa ?? '')).toBe('750,00 €');
  });

  it('päiväraha: päivät ja päivämäärä', () => {
    const { henkilo } = tapausA(TYONTEKIJA, [
      { laji: 'kuukausipalkka', selite: 'Kuukausipalkka', summa: c(300_000) },
      { laji: 'kokopaivaraha', selite: 'Tampere', maara: 200, pvm: '2026-10-05' },
    ]);
    const rivi = malli({ henkilo }).rivit.find((r) => r.ryhma === 'verovapaat');
    expect(norm(rivi?.maara ?? '')).toBe('2 pv');
  });
});

describe('palkkalaskelmanNimi', () => {
  it('muodostaa ascii-pienaakkosisen sukunimen ja päivän', () => {
    expect(palkkalaskelmanNimi('Mäkelä-Öberg Maija', '2026-10-31')).toBe(
      'palkkalaskelma-makelaoberg-2026-10-31.pdf',
    );
    expect(palkkalaskelmanNimi('Åström Olli', '2026-10-31')).toBe(
      'palkkalaskelma-astrom-2026-10-31.pdf',
    );
  });
});
