import {
  type StoredTosite,
  TositeTyyppi,
  type TositeVienti,
  VientiTyyppi,
  lataaKartta,
} from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { johdaViennit } from './johdaViennit.js';
import { alustaTila } from './reducer.js';
import { tositeEditorille } from './tositeEditorille.js';
import type { VientiRivi } from './types.js';

const CHART = lataaKartta([
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);
const PVM = '2026-05-04';
const snt = (n: number) => Euro.fromCents(n);

function rivi(tili: number, debet: number, kredit: number, alv: [number, number] = [0, 0]) {
  const r: VientiRivi = {
    avain: `r${tili}-${debet}-${kredit}`,
    tili,
    debetSnt: snt(debet),
    kreditSnt: snt(kredit),
    alvKoodi: alv[0],
    alvProsentti: alv[1],
    bruttoSyotto: alv[0] < 24 || alv[0] > 29,
  };
  return r;
}

function tallennettu(viennit: TositeVienti[], extra: Partial<StoredTosite> = {}): StoredTosite {
  return {
    id: 7,
    pvm: PVM,
    tyyppi: TositeTyyppi.MENO,
    tila: 100,
    tunniste: 79,
    sarja: '',
    otsikko: 'Toimistotarvikkeet',
    viennit,
    ...extra,
  };
}

/** Editorin rivit → viennit → takaisin editoriin → samat viennit. */
function edestakaisin(rivit: VientiRivi[]) {
  const viennit = johdaViennit(rivit, CHART, PVM);
  const tila = tositeEditorille(tallennettu(viennit), CHART);
  if (!tila?.rows) throw new Error('ei palautunut');
  return { viennit, tila, uudet: johdaViennit(tila.rows, CHART, PVM) };
}

describe('tositeEditorille', () => {
  it('veroton tosite: viennit sellaisenaan, otsikko, päivä, tyyppi ja sarja mukaan', () => {
    const { tila, viennit, uudet } = edestakaisin([rivi(4000, 1000, 0), rivi(1900, 0, 1000)]);
    expect(uudet).toEqual(viennit);
    expect(tila).toMatchObject({
      paiva: PVM,
      tyyppi: TositeTyyppi.MENO,
      sarja: '',
      selite: 'Toimistotarvikkeet',
    });
    expect(tila.rows?.map((r) => r.tili)).toEqual([4000, 1900]);
  });

  it('verollinen osto palautuu bruttosummaksi yhdelle riville (alv-vienti pois)', () => {
    const { tila, viennit, uudet } = edestakaisin([
      rivi(4000, 12550, 0, [21, 25.5]),
      rivi(1900, 0, 12550),
    ]);
    expect(tila.rows).toHaveLength(2);
    expect(tila.rows?.[0]).toMatchObject({
      tili: 4000,
      debetSnt: 12550,
      alvKoodi: 21,
      alvProsentti: 25.5,
      bruttoSyotto: true,
    });
    expect(uudet).toEqual(viennit);
  });

  it('käänteinen alv (24) palautuu verottomana syöttönä', () => {
    const { tila, viennit, uudet } = edestakaisin([
      rivi(4000, 10000, 0, [24, 25.5]),
      rivi(1900, 0, 10000),
    ]);
    expect(tila.rows?.[0]).toMatchObject({ debetSnt: 10000, alvKoodi: 24, bruttoSyotto: false });
    expect(uudet).toEqual(viennit);
  });

  it('verollinen myynti (11, myyntivienti 201 + alv 203) palautuu bruttosummaksi', () => {
    const { tila, viennit, uudet } = edestakaisin([
      rivi(1900, 12550, 0),
      rivi(3000, 0, 12550, [11, 25.5]),
    ]);
    expect(viennit.map((v) => v.tyyppi)).toContain(VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS);
    expect(viennit.map((v) => v.tyyppi)).toContain(VientiTyyppi.MYYNTI + VientiTyyppi.ALVKIRJAUS);
    expect(tila.rows).toHaveLength(2);
    expect(tila.rows?.[1]).toMatchObject({
      tili: 3000,
      kreditSnt: 12550,
      alvKoodi: 11,
      bruttoSyotto: true,
    });
    expect(uudet).toEqual(viennit);
  });

  it('viennitön tosite (esim. tiliotteen muistio) avautuu tyhjään ruudukkoon', () => {
    const tila = tositeEditorille(
      tallennettu([], { tyyppi: TositeTyyppi.MUISTIO, sarja: 'B', otsikko: '09/26 Tiliote' }),
      CHART,
    );
    expect(tila).toEqual({
      paiva: PVM,
      tyyppi: TositeTyyppi.MUISTIO,
      sarja: 'B',
      selite: '09/26 Tiliote',
      rows: [],
    });
  });

  it('palauttaa null, jos alv-erittely ei palaudu ruudukkoon', () => {
    const outo = tallennettu([
      { tili: 4000, debet: snt(1000), kredit: snt(0), pvm: PVM, alvKoodi: 0, alvProsentti: 0 },
      // Irrallinen alv-vienti ilman perusvientiä.
      { tili: 1763, debet: snt(255), kredit: snt(0), pvm: PVM, alvKoodi: 221, alvProsentti: 25.5 },
      { tili: 1900, debet: snt(0), kredit: snt(1255), pvm: PVM, alvKoodi: 0, alvProsentti: 0 },
    ]);
    expect(tositeEditorille(outo, CHART)).toBeNull();
  });

  it('pelkät alv-viennit eivät ole tyhjä tosite: null', () => {
    const vainAlv = tallennettu([
      { tili: 1763, debet: snt(255), kredit: snt(0), pvm: PVM, alvKoodi: 221, alvProsentti: 25.5 },
      { tili: 2939, debet: snt(0), kredit: snt(255), pvm: PVM, alvKoodi: 121, alvProsentti: 25.5 },
    ]);
    expect(tositeEditorille(vainAlv, CHART)).toBeNull();
  });

  it('rivit saavat yksilölliset avaimet ja kelpaavat editorin alkutilaksi', () => {
    const { tila } = edestakaisin([rivi(4000, 1000, 0), rivi(1900, 0, 1000)]);
    const avaimet = new Set(tila.rows?.map((r) => r.avain));
    expect(avaimet.size).toBe(2);
    expect(alustaTila(tila).rows).toHaveLength(2);
  });
});

describe('tositeEditorille — kentät, joita ruudukko ei kanna', () => {
  const perus = () => johdaViennit([rivi(4000, 1000, 0), rivi(1900, 0, 1000)], CHART, PVM);
  const muutettu = (muutos: Partial<TositeVienti>) => {
    const [eka, ...muut] = perus();
    return tositeEditorille(tallennettu([{ ...(eka as TositeVienti), ...muutos }, ...muut]), CHART);
  };

  it.each<[string, Partial<TositeVienti>]>([
    ['era', { era: 12 }],
    ['jakson alku', { jaksoalkaa: '2026-01-01' }],
    ['jakson loppu', { jaksoloppuu: '2026-12-31' }],
    ['jaksotustili', { jaksotustili: 1800 }],
    ['maksuperusteinen tosite', { maksuperusteinenTosite: 4 }],
    ['rivin kumppani', { kumppani: 7 }],
    ['arkistotunnus', { arkistotunnus: 'ARK123' }],
    ['rivin viite', { viite: 'RF471234' }],
    ['tasaeräpoisto', { tasaerapoisto: 36 }],
    ['vientityyppi', { tyyppi: 300 }],
    ['poikkeava vientipäivä', { pvm: '2026-05-05' }],
  ])('%s → ei ruudukkoon (tallennus pudottaisi kentän)', (_nimi, muutos) => {
    expect(muutettu(muutos)).toBeNull();
  });

  it('tyhjät oletusarvot (tyyppi 0, kohdennus 0, tyhjä selite) eivät estä', () => {
    expect(muutettu({ tyyppi: 0, kohdennus: 0, selite: '' })).not.toBeNull();
  });
});

describe('tositeEditorille — tiukka: false (tositetta ei ole tallennettu)', () => {
  const perus = () => johdaViennit([rivi(4000, 1000, 0), rivi(1900, 0, 1000)], CHART, PVM);
  const kentalla = (muutos: Partial<TositeVienti>) => {
    const [eka, ...muut] = perus();
    return tallennettu([{ ...(eka as TositeVienti), ...muutos }, ...muut]);
  };

  // Kuitin täyttö ja tiliotteen käsinkirjaus kokoavat tositteen itse (luoTositeMatchista antaa
  // vienneille mm. vientityypin 101), eikä tuloksella ylikirjoiteta tallennettua tositetta.
  it.each<[string, Partial<TositeVienti>]>([
    ['vientityyppi', { tyyppi: 101 }],
    ['era', { era: 12 }],
    ['kohdennus', { kohdennus: 3 }],
    ['poikkeava vientipäivä', { pvm: '2026-05-05' }],
  ])('%s ei estä esitäyttöä', (_nimi, muutos) => {
    const tila = tositeEditorille(kentalla(muutos), CHART, { tiukka: false });
    expect(tila?.rows).toHaveLength(2);
  });

  // Erä on kenttä, jota ruudukko ei kirjoita takaisin, joten se erottaa tilat yhä:
  // vientityyppi 101 ei enää erota, koska ruudukko kirjoittaa sen itse (ks. RUUDUKON_TYYPIT).
  it('sama tosite jää tiukassa tilassa ja oletuksena null', () => {
    const tosite = kentalla({ era: 12 });
    expect(tositeEditorille(tosite, CHART, { tiukka: true })).toBeNull();
    expect(tositeEditorille(tosite, CHART, {})).toBeNull();
    expect(tositeEditorille(tosite, CHART)).toBeNull();
  });

  it('ei hyväksy mitä tahansa: summien pitää edelleen palautua riveistä', () => {
    const outo = tallennettu([
      { tili: 4000, debet: snt(1000), kredit: snt(0), pvm: PVM, alvKoodi: 0, alvProsentti: 0 },
      // Irrallinen alv-vienti ilman perusvientiä.
      { tili: 1763, debet: snt(255), kredit: snt(0), pvm: PVM, alvKoodi: 221, alvProsentti: 25.5 },
      { tili: 1900, debet: snt(0), kredit: snt(1255), pvm: PVM, alvKoodi: 0, alvProsentti: 0 },
    ]);
    expect(tositeEditorille(outo, CHART, { tiukka: false })).toBeNull();
  });
});

describe('tositeEditorille — kentät, joita ruudukko ei kirjoita takaisin', () => {
  const vienti = (
    tili: number,
    debet: number,
    kredit: number,
    lisa: Partial<TositeVienti> = {},
  ): TositeVienti => ({
    tili,
    debet: snt(debet),
    kredit: snt(kredit),
    pvm: PVM,
    alvKoodi: 0,
    alvProsentti: 0,
    ...lisa,
  });
  const OSTOVELKA = VientiTyyppi.OSTO + VientiTyyppi.VASTAKIRJAUS; // 102

  it('ostolasku (erä + ostovelkavienti 102) jää vain luku -näkymään', () => {
    const t = tallennettu([
      vienti(4000, 5000, 0, { tyyppi: VientiTyyppi.OSTO + VientiTyyppi.KIRJAUS }),
      vienti(1900, 0, 5000, { tyyppi: OSTOVELKA, era: 1 }),
    ]);
    expect(tositeEditorille(t, CHART)).toBeNull();
  });

  it('pelkkä erä, jaksotus tai maksuperusteisen alv:n linkki estää', () => {
    for (const lisa of [
      { era: 7 },
      { jaksoalkaa: '2026-01-01' },
      { jaksoloppuu: '2026-12-31' },
      { jaksotustili: 1900 },
      { maksuperusteinenTosite: 5 },
    ] satisfies Partial<TositeVienti>[]) {
      const t = tallennettu([vienti(4000, 5000, 0), vienti(1900, 0, 5000, lisa)]);
      expect(tositeEditorille(t, CHART), JSON.stringify(lisa)).toBeNull();
    }
  });

  it('ruudukon rakentamaton vientityyppi (102, bruttooikaisu) estää ilman erääkin', () => {
    for (const tyyppi of [OSTOVELKA, VientiTyyppi.BRUTTOOIKAISU]) {
      const t = tallennettu([vienti(4000, 5000, 0), vienti(1900, 0, 5000, { tyyppi })]);
      expect(tositeEditorille(t, CHART)).toBeNull();
    }
  });

  it('kirjausmerkintä (101/201) ja nollaerä/-kohdennus eivät estä', () => {
    const t = tallennettu([
      vienti(4000, 5000, 0, { tyyppi: VientiTyyppi.OSTO + VientiTyyppi.KIRJAUS, era: 0 }),
      vienti(1900, 0, 5000, { tyyppi: VientiTyyppi.MYYNTI + VientiTyyppi.KIRJAUS, kohdennus: 0 }),
    ]);
    expect(tositeEditorille(t, CHART)?.rows?.map((r) => r.tili)).toEqual([4000, 1900]);
  });

  it('viennin oma päivä, joka poikkeaa tositteen päivästä, estää', () => {
    const t = tallennettu([vienti(4000, 5000, 0), vienti(1900, 0, 5000, { pvm: '2026-06-01' })]);
    expect(tositeEditorille(t, CHART)).toBeNull();
  });

  it('alv-viennin selite, jota ruudukko ei toistaisi, estää', () => {
    const viennit = johdaViennit(
      [rivi(4000, 12550, 0, [21, 25.5]), rivi(1900, 0, 12550)],
      CHART,
      PVM,
    );
    expect(tositeEditorille(tallennettu(viennit), CHART)).not.toBeNull();
    const muutettu = viennit.map((v) => (v.alvKoodi >= 100 ? { ...v, selite: 'Eri selite' } : v));
    expect(tositeEditorille(tallennettu(muutettu), CHART)).toBeNull();
  });

  it('tyhjä ja puuttuva selite rinnastetaan', () => {
    const t = tallennettu([vienti(4000, 5000, 0, { selite: '' }), vienti(1900, 0, 5000)]);
    expect(tositeEditorille(t, CHART)?.rows).toHaveLength(2);
  });
});

describe('tositeEditorille — kohdennus ja merkkaukset', () => {
  const kohdennettu = (r: VientiRivi): VientiRivi => ({ ...r, kohdennus: 1, merkkaukset: [3] });

  it('kohdennus 1 + merkkaus 3 avautuu ruudukkoon ja tallentuu takaisin muuttumattomana', () => {
    const { tila, viennit, uudet } = edestakaisin([
      kohdennettu(rivi(4000, 1000, 0)),
      rivi(1900, 0, 1000),
    ]);
    expect(viennit[0]).toMatchObject({ kohdennus: 1, merkkaukset: [3] });
    expect(tila.rows?.[0]).toMatchObject({ tili: 4000, kohdennus: 1, merkkaukset: [3] });
    expect(tila.rows?.[1]).not.toHaveProperty('kohdennus');
    expect(tila.rows?.[1]).not.toHaveProperty('merkkaukset');
    expect(uudet).toEqual(viennit);
  });

  it('verollinen kohdennettu rivi: alv-viennit kantavat kohdennuksen, ja tosite palautuu', () => {
    const { tila, viennit, uudet } = edestakaisin([
      kohdennettu(rivi(4000, 12550, 0, [21, 25.5])),
      rivi(1900, 0, 12550),
    ]);
    expect(viennit.filter((v) => v.kohdennus === 1)).toHaveLength(2);
    expect(tila.rows).toHaveLength(2);
    expect(uudet).toEqual(viennit);
  });

  it('kohdennus vain perusviennillä (Kitsas-tapa, alv-vienti ilman) ei avaudu: tallennus muuttaisi alv-vientiä', () => {
    const viennit = johdaViennit(
      [kohdennettu(rivi(4000, 12550, 0, [21, 25.5])), rivi(1900, 0, 12550)],
      CHART,
      PVM,
    ).map((v) => {
      if (v.alvKoodi < 100) return v;
      const { kohdennus: _k, merkkaukset: _m, ...ilman } = v;
      return ilman;
    });
    expect(tositeEditorille(tallennettu(viennit), CHART)).toBeNull();
  });

  it('eri merkkaukset samalla tilillä ja summalla erottuvat vertailussa', () => {
    const viennit = johdaViennit(
      [kohdennettu(rivi(4000, 1000, 0)), rivi(1900, 0, 1000)],
      CHART,
      PVM,
    );
    const muutettu = viennit.map((v, i) => (i === 0 ? { ...v, merkkaukset: [3, 4] } : v));
    const tila = tositeEditorille(tallennettu(muutettu), CHART);
    expect(tila?.rows?.[0]?.merkkaukset).toEqual([3, 4]);
  });
});
