import type { PalkkaAjo, PalkkaHenkilo } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { Verokortti } from './tyontekija.js';
import { kertymaVerokortille, valitseVerokortti } from './verokortti.js';

const c = (n: number) => n as Cents;

function kortti(alkaa: string, paattyy: string, perusBp = 2000, aiemminMaksettu = 0): Verokortti {
  return {
    alkaa,
    paattyy,
    perusBp,
    lisaBp: 4000,
    tuloraja: c(3_000_000),
    aiemminMaksettu: c(aiemminMaksettu),
  };
}

/** Pelkkä tulos-osa merkitsee kertymälle; muut kentät nollia. */
function henkilo(tyontekijaId: string, pidatysperuste: number): PalkkaHenkilo {
  const nolla = c(0);
  return {
    tyontekijaId,
    nimi: 'Testi Henkilö',
    vakuutusperuste: 'tyontekija',
    verokortti: null,
    prosentit: {
      tyelTyontekijaBp: 0,
      tyelKokonaisBp: 0,
      tvrTyontekijaBp: 0,
      tvrTyonantajaBp: 0,
      savaBp: 0,
    },
    rivit: [],
    tulos: {
      rahapalkka: c(pidatysperuste),
      luontoisedut: nolla,
      verovapaat: nolla,
      pidatysperuste: c(pidatysperuste),
      pidatysOsat: [],
      ennakonpidatys: nolla,
      tyelTyontekija: nolla,
      tyelTyonantaja: nolla,
      tvrTyontekija: nolla,
      tvrTyonantaja: nolla,
      sava: nolla,
      nettopalkka: nolla,
      kertymaJalkeen: nolla,
      varoitukset: [],
    },
  };
}

function ajo(henkilot: PalkkaHenkilo[]): PalkkaAjo {
  return {
    versio: 1,
    kausiAlkaa: '2026-01-01',
    kausiLoppuu: '2026-01-31',
    laskettu: '2026-01-31T12:00:00.000Z',
    henkilot,
  };
}

describe('valitseVerokortti', () => {
  const k2025 = kortti('2025-01-01', '2025-12-31', 1500);
  const k2026 = kortti('2026-01-01', '2026-12-31', 2000);

  it('valitsee maksupäivänä voimassa olevan kortin', () => {
    expect(valitseVerokortti([k2025, k2026], '2026-03-15')).toEqual({
      kortti: k2026,
      tammikuuSaanto: false,
    });
    expect(valitseVerokortti([k2025, k2026], '2025-12-31')).toEqual({
      kortti: k2025,
      tammikuuSaanto: false,
    });
    // Voimassaolon alku- ja loppupäivä kuuluvat kortille.
    expect(valitseVerokortti([k2026], '2026-01-01')?.kortti).toBe(k2026);
    expect(valitseVerokortti([k2026], '2026-12-31')?.kortti).toBe(k2026);
  });

  it('muutosverokortti korvaa aiemman (VH/7526 §4.3.4): myöhemmin alkava voittaa', () => {
    const muutos = kortti('2026-06-01', '2026-12-31', 2500);
    expect(valitseVerokortti([k2026, muutos], '2026-07-15')?.kortti).toBe(muutos);
    expect(valitseVerokortti([muutos, k2026], '2026-07-15')?.kortti).toBe(muutos);
    expect(valitseVerokortti([k2026, muutos], '2026-05-31')?.kortti).toBe(k2026);
  });

  it('tammikuussa ilman uutta korttia käytetään edellisen vuoden korttia (VH/7526 §4.3.3)', () => {
    expect(valitseVerokortti([k2025], '2026-01-15')).toEqual({
      kortti: k2025,
      tammikuuSaanto: true,
    });
    expect(valitseVerokortti([k2025], '2026-01-31')?.tammikuuSaanto).toBe(true);
  });

  it('helmikuussa tammikuun sääntö ei enää päde', () => {
    expect(valitseVerokortti([k2025], '2026-02-01')).toBeNull();
  });

  it('palauttaa null, kun kortteja ei ole', () => {
    expect(valitseVerokortti([], '2026-03-15')).toBeNull();
  });
});

describe('kertymaVerokortille', () => {
  const k = kortti('2026-01-01', '2026-12-31', 2000, 120_000);

  it('laskee kortin voimassaoloajan maksut tälle työntekijälle sekä aiemmin maksetun', () => {
    const aiemmat = [
      { pvm: '2025-12-31', palkka: ajo([henkilo('t1', 290_000)]) }, // ennen kortin alkua
      { pvm: '2026-01-15', palkka: ajo([henkilo('t1', 300_000), henkilo('t2', 999_999)]) },
      { pvm: '2026-02-15', palkka: ajo([henkilo('t2', 250_000)]) }, // ei tätä työntekijää
      { pvm: '2026-12-31', palkka: ajo([henkilo('t1', 302_000)]) }, // viimeinen päivä mukaan
      { pvm: '2027-01-15', palkka: ajo([henkilo('t1', 310_000)]) }, // kortin jälkeen
    ];
    // 120 000 (aiemmin maksettu) + 300 000 + 302 000 = 722 000
    expect(kertymaVerokortille(k, 't1', aiemmat)).toBe(722_000);
  });

  it('ilman ajoja kertymä on aiemmin maksettu', () => {
    expect(kertymaVerokortille(k, 't1', [])).toBe(120_000);
  });
});
