import { describe, expect, it } from 'vitest';
import { type Ajo, type TilioteDiagnostiikka, muodostaRaportti } from './raportti.js';
import type { VertailuTulos } from './vertaa.js';

const tulos = (id: number, pvmOk: boolean, bruttoOk: boolean): VertailuTulos => ({
  tositeId: id,
  kentat: [
    { nimi: 'pvm', ok: pvmOk, odotettu: 'x', saatu: 'y' },
    { nimi: 'brutto', ok: bruttoOk, odotettu: '1', saatu: '1' },
  ],
  taysinTasmaa: pvmOk && bruttoOk,
});

describe('muodostaRaportti', () => {
  const ajot: Ajo[] = [
    { nimi: 'kylma', tulokset: [tulos(1, true, false), tulos(2, true, true)] },
    { nimi: 'lammin', tulokset: [tulos(1, true, true), tulos(2, true, true)] },
  ];
  const kattavuus = {
    tekstiPdf: 2,
    ocr: 0,
    eiKuitti: 1,
    monimutkainen: 3,
    visioBudjetti: 0,
    visioTyhja: 0,
    visioVirhe: 0,
    visioJasennys: 0,
    visioVajaa: 0,
  };

  it('laskee kenttäkohtaiset osuudet per ajo', () => {
    const r = muodostaRaportti(ajot, kattavuus) as {
      json: {
        ajot: {
          nimi: string;
          kentat: Record<string, { ok: number; yhteensa: number }>;
          taysin: number;
          luettu: number;
        }[];
      };
    };
    const kylma = r.json.ajot.find((a) => a.nimi === 'kylma');
    expect(kylma?.kentat.brutto).toEqual({ ok: 1, yhteensa: 2 });
    expect(kylma?.taysin).toBe(1);
    expect(kylma?.luettu).toBe(2);
    const lammin = r.json.ajot.find((a) => a.nimi === 'lammin');
    expect(lammin?.kentat.brutto).toEqual({ ok: 2, yhteensa: 2 });
    expect(lammin?.taysin).toBe(2);
  });

  it('tuottaa konsoli- ja md-tekstin jotka mainitsevat molemmat ajot ja kattavuuden', () => {
    const r = muodostaRaportti(ajot, kattavuus);
    expect(r.konsoli).toContain('kylma');
    expect(r.konsoli).toContain('lammin');
    expect(r.md).toContain('brutto');
    expect(r.md).toContain('monimutkainen'); // coverage surfaced
  });

  it('näyttää prosentin nimittäjän kanssa ja luettu-rivin, koska sarakkeilla on eri nimittäjä', () => {
    // kylma: brutto ok=1/yhteensä=2 -> 50% (1/2); pvm ok=2/yhteensä=2 -> 100% (2/2).
    // Molemmat tulokset lukivat molemmat kentät (kentat.length===2, ei 'luku'-virherivi),
    // joten luettu=2/2 kummallakin sarakkeella.
    const r = muodostaRaportti(ajot, kattavuus);
    expect(r.konsoli).toContain('50% (1/2)');
    expect(r.konsoli).toContain('100% (2/2)');
    expect(r.md).toContain('50% (1/2)');
    // luettu-rivi läsnä molemmissa esitysmuodoissa, molemmilla sarakkeilla 2/2.
    const luettuKonsoli = r.konsoli.split('\n').find((rivi) => rivi.startsWith('luettu\t'));
    expect(luettuKonsoli).toBe('luettu\t2/2\t2/2');
    expect(r.md).toContain('| luettu | 2/2 | 2/2 |');
  });

  it('erottaa lukuvirheen kenttien nimittäjästä (finding #1): epäonnistunut luku ei laske kenttäkohtaista yhteensä-lukua ylös', () => {
    const luentavirheAjot: Ajo[] = [
      {
        nimi: 'A',
        tulokset: [
          tulos(1, true, true),
          tulos(2, true, true),
          {
            tositeId: 3,
            kentat: [{ nimi: 'luku', ok: false, odotettu: 'kuitti', saatu: '—' }],
            taysinTasmaa: false,
          },
        ],
      },
      {
        nimi: 'V',
        tulokset: [
          tulos(1, true, true),
          {
            tositeId: 2,
            kentat: [{ nimi: 'luku', ok: false, odotettu: 'kuitti', saatu: '—' }],
            taysinTasmaa: false,
          },
          {
            tositeId: 3,
            kentat: [{ nimi: 'luku', ok: false, odotettu: 'kuitti', saatu: '—' }],
            taysinTasmaa: false,
          },
        ],
      },
    ];
    const r = muodostaRaportti(luentavirheAjot, kattavuus) as {
      json: {
        ajot: {
          nimi: string;
          kentat: Record<string, { ok: number; yhteensa: number }>;
          luettu: number;
          yhteensa: number;
        }[];
      };
    };
    const a = r.json.ajot.find((x) => x.nimi === 'A');
    const v = r.json.ajot.find((x) => x.nimi === 'V');
    // A luki 2/3, molemmat oikein -> pvm 100% (2/2). V luki vain 1/3, myös oikein -> pvm
    // 100% (1/1). Ilman lukuvirheestä irrotettua nimittäjää nämä olisivat epäsuorasti sama
    // luku vaikka V luki kolmasosan siitä mitä A — tästä on kyse findingissä #1.
    expect(a?.luettu).toBe(2);
    expect(a?.yhteensa).toBe(3);
    expect(a?.kentat.pvm).toEqual({ ok: 2, yhteensa: 2 });
    expect(v?.luettu).toBe(1);
    expect(v?.yhteensa).toBe(3);
    expect(v?.kentat.pvm).toEqual({ ok: 1, yhteensa: 1 });
    expect(r.konsoli).toContain('luettu\t2/3\t1/3');
    expect(r.konsoli).toContain('pvm\t100% (2/2)\t100% (1/1)');
  });
});

describe('muodostaRaportti diagnostiikalla', () => {
  const ajot: Ajo[] = [
    {
      nimi: 'A-kylmä',
      tulokset: [
        {
          tositeId: 1,
          kentat: [{ nimi: 'pvm', ok: false, odotettu: 'x', saatu: 'y' }],
          taysinTasmaa: false,
        },
      ],
    },
    {
      nimi: 'B-kylmä',
      tulokset: [
        {
          tositeId: 1,
          kentat: [{ nimi: 'pvm', ok: true, odotettu: 'x', saatu: 'x' }],
          taysinTasmaa: true,
        },
      ],
    },
  ];
  const kattavuus = {
    tekstiPdf: 1,
    ocr: 0,
    eiKuitti: 0,
    monimutkainen: 0,
    visioBudjetti: 0,
    visioTyhja: 0,
    visioVirhe: 0,
    visioJasennys: 0,
    visioVajaa: 0,
  };
  const diag: TilioteDiagnostiikka = {
    tasmays: 3,
    nimitasmays: 1,
    kuittiPuuttuu: 2,
    omaPaaoma: 4,
    tasmaysOikein: 3,
    tasmaysVaarin: 1,
    eiTasmatty: 2,
    eiKohdetta: 0,
  };

  it('näyttää A- ja B-sarakkeet ja täsmäytysdiagnostiikan', () => {
    const r = muodostaRaportti(ajot, kattavuus, diag);
    expect(r.konsoli).toContain('A-kylmä');
    expect(r.konsoli).toContain('B-kylmä');
    expect(r.md).toContain('Täsmäytys'); // diagnostics heading present
    expect(r.md).toContain('nimitasmays');
    const json = r.json as { diagnostiikka?: TilioteDiagnostiikka };
    expect(json.diagnostiikka).toEqual(diag);
  });

  it('jättää diagnostiikan pois kun sitä ei anneta (polku A yksin)', () => {
    const r = muodostaRaportti(ajot, kattavuus);
    const json = r.json as { diagnostiikka?: TilioteDiagnostiikka };
    expect(json.diagnostiikka).toBeUndefined();
    expect(r.md).not.toContain('Täsmäytys');
  });
});

describe('kattavuus visiolaskureilla', () => {
  it('näyttää visiovirheluokat konsolissa ja markdownissa', () => {
    const kattavuus = {
      tekstiPdf: 3,
      ocr: 1,
      eiKuitti: 0,
      monimutkainen: 0,
      visioBudjetti: 2,
      visioTyhja: 1,
      visioVirhe: 4,
      visioJasennys: 5,
      visioVajaa: 6,
    };
    const r = muodostaRaportti([{ nimi: 'A', tulokset: [] }], kattavuus);
    expect(r.konsoli).toContain('visio-budjetti 2');
    expect(r.konsoli).toContain('visio-jäsennys 5');
    expect(r.konsoli).toContain('visio-vajaa 6');
    expect(r.md).toContain('- visio-budjetti (malli katkesi ajatteluun): 2');
    expect(r.md).toContain('- visio-tyhjä: 1');
    expect(r.md).toContain(
      '- visio-jäsennys (vastaus ei jäsentynyt JSON:ksi korjausyrityksenkään jälkeen): 5',
    );
    expect(r.md).toContain(
      '- visio-vajaa (malli vastasi ja JSON jäsentyi, mutta summa puuttui): 6',
    );
    expect(r.md).toContain('- visio-virhe (kutsu epäonnistui): 4');
  });
});
