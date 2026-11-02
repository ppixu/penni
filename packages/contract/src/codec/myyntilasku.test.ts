import type {
  MaksumuistutusSyote,
  MyyntilaskuRivi,
  MyyntilaskuSyote,
  RyhmalaskuSyote,
  SuoritusSyote,
} from '@penni/engine';
import { type Cents, Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { decodeMaksumuistutusSyote, encodeMaksumuistutusSyote } from './maksumuistutus.js';
import {
  decodeMyyntilaskuRivi,
  decodeMyyntilaskuSyote,
  decodeRyhmalaskuSyote,
  decodeSuoritusSyote,
  encodeMyyntilaskuRivi,
  encodeMyyntilaskuSyote,
  encodeRyhmalaskuSyote,
  encodeSuoritusSyote,
} from './myyntilasku.js';
import { decodeRivi, encodeRivi } from './rivi.js';
import { decodeTosite, encodeTosite } from './tosite.js';

describe('rivi codec carries tili/kohdennus', () => {
  it('round-trips a row with tili and kohdennus', () => {
    const r = decodeRivi(
      encodeRivi({
        myyntiKpl: 2,
        aNetto: 50,
        alvKoodi: 11,
        alvProsentti: 25.5,
        tili: 3001,
        kohdennus: 7,
      }),
    );
    expect(r.tili).toBe(3001);
    expect(r.kohdennus).toBe(7);
  });
});

describe('tosite codec carries numero/maksutapa', () => {
  it('preserves numero and maksutapa (including LASKU=0)', () => {
    const t = decodeTosite(
      encodeTosite({
        pvm: '2026-06-01',
        tyyppi: 210,
        tila: 100,
        tunniste: 1,
        sarja: '',
        numero: '1',
        maksutapa: 0,
        viennit: [],
      }),
    );
    expect(t.numero).toBe('1');
    expect(t.maksutapa).toBe(0);
  });
});

describe('myyntilasku syote codec', () => {
  it('round-trips a syote (rivit + kumppani + maksutapa)', () => {
    const syote: MyyntilaskuSyote = {
      pvm: '2026-06-01',
      erapvm: '2026-07-01',
      kumppani: 42,
      maksutapa: 1,
      rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
    };
    const back = decodeMyyntilaskuSyote(encodeMyyntilaskuSyote(syote));
    expect(back.pvm).toBe('2026-06-01');
    expect(back.erapvm).toBe('2026-07-01');
    expect(back.kumppani).toBe(42);
    expect(back.maksutapa).toBe(1);
    expect(back.rivit).toHaveLength(1);
    expect(back.rivit[0]?.aNetto).toBe(100);
  });
});

describe('ryhmalasku syote codec', () => {
  it('round-trips the template, recipients and group id without kumppani', () => {
    const syote: RyhmalaskuSyote = {
      pvm: '2026-06-01',
      erapvm: '2026-06-15',
      otsikko: 'Jäsenmaksu',
      jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
      rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
      kumppanit: [3, 5],
      ryhma: 'r-1',
    };
    const wire = encodeRyhmalaskuSyote(syote);
    expect(wire.kumppani).toBeUndefined();
    expect(wire.kumppanit).toEqual([3, 5]);
    const back = decodeRyhmalaskuSyote(wire);
    expect(back).toMatchObject({
      pvm: '2026-06-01',
      erapvm: '2026-06-15',
      otsikko: 'Jäsenmaksu',
      kumppanit: [3, 5],
      ryhma: 'r-1',
      jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
    });
    expect(back.rivit).toHaveLength(1);
    expect(back).not.toHaveProperty('kumppani');
    expect(back).not.toHaveProperty('luonnos');
  });
});

describe('myyntilaskuRivi codec', () => {
  it('round-trips a row with money as canonical strings', () => {
    const rivi: MyyntilaskuRivi = {
      tosite: 7,
      pvm: '2026-06-01',
      viite: '1234',
      numero: '1',
      asiakas: 'Asiakas Oy',
      asiakasId: 3,
      summa: Euro.fromCents(12_550),
      avoin: Euro.fromCents(10_000),
      era: 1,
      tili: 1701,
      tyyppi: 210,
      tunniste: 4,
      sarja: '',
      tila: 100,
    };
    const w = encodeMyyntilaskuRivi(rivi);
    expect(w.summa).toBe('125.50');
    expect(w.avoin).toBe('100.00');
    const back = decodeMyyntilaskuRivi(w);
    expect(back.summa).toBe(Euro.fromCents(12_550));
    expect(back.avoin).toBe(Euro.fromCents(10_000));
    expect(back.asiakas).toBe('Asiakas Oy');
    expect(back.era).toBe(1);
  });

  it('round-trips avoin = 0 (fully paid)', () => {
    const w = encodeMyyntilaskuRivi({
      tosite: 1,
      summa: Euro.fromCents(5_000),
      avoin: Euro.fromCents(0),
      tyyppi: 210,
      tunniste: 1,
      sarja: '',
      tila: 100,
    });
    expect(w.avoin).toBe('0.00');
    expect(decodeMyyntilaskuRivi(w).avoin).toBe(Euro.fromCents(0));
  });
});

describe('suoritusSyote codec', () => {
  it('round-trips a payment body', () => {
    const s: SuoritusSyote = { tosite: 7, pvm: '2026-06-15', summa: Euro.fromCents(2_550) };
    const w = encodeSuoritusSyote(s);
    expect(w.summa).toBe('25.50');
    const back = decodeSuoritusSyote(w);
    expect(back.tosite).toBe(7);
    expect(back.summa).toBe(Euro.fromCents(2_550));
  });

  it('accepts a raw number amount on decode (legacy double)', () => {
    const back = decodeSuoritusSyote({ tosite: 1, pvm: '2026-06-15', summa: 25.5 });
    expect(back.summa).toBe(Euro.fromCents(2_550));
  });
});

describe('muistutus- ja muistutettu-kentät myyntilaskurivillä', () => {
  const pohja: MyyntilaskuRivi = {
    tosite: 5,
    summa: Euro.fromCents(500),
    avoin: Euro.fromCents(0),
    tyyppi: 216,
    tunniste: 3,
    sarja: '',
    tila: 100,
  };

  it('kuljettaa muistutus-lipun', () => {
    const rivi: MyyntilaskuRivi = { ...pohja, muistutus: true };
    const w = encodeMyyntilaskuRivi(rivi);
    expect(w.muistutus).toBe(true);
    expect(decodeMyyntilaskuRivi(w)).toEqual(rivi);
  });

  it('kuljettaa muistutettu-määrän', () => {
    const rivi: MyyntilaskuRivi = { ...pohja, tyyppi: 210, muistutettu: 2 };
    const w = encodeMyyntilaskuRivi(rivi);
    expect(w.muistutettu).toBe(2);
    expect(decodeMyyntilaskuRivi(w)).toEqual(rivi);
  });

  it('ei lisää kenttiä, joita ei ollut', () => {
    const w = encodeMyyntilaskuRivi(pohja);
    expect('muistutus' in w).toBe(false);
    expect('muistutettu' in w).toBe(false);
    expect(decodeMyyntilaskuRivi(w)).toEqual(pohja);
  });
});

describe('maksumuistutuksen syöte', () => {
  it('pyörii ympäri: maksu kanonisena rahana', () => {
    const syote: MaksumuistutusSyote = {
      tositteet: [3, 4],
      pvm: '2026-05-30',
      erapvm: '2026-06-15',
      maksu: 500 as Cents,
      korko: true,
      viivkorko: 11.5,
    };
    const w = encodeMaksumuistutusSyote(syote);
    expect(w.maksu).toBe('5.00');
    expect(decodeMaksumuistutusSyote(w)).toEqual(syote);
  });

  it('pelkät pakolliset kentät eivät saa lisäavaimia, ja maksu 0 säilyy', () => {
    const vahva: MaksumuistutusSyote = { tositteet: [1], pvm: '2026-05-30', korko: false };
    const w = encodeMaksumuistutusSyote(vahva);
    expect(Object.keys(w).sort()).toEqual(['korko', 'pvm', 'tositteet']);
    expect(decodeMaksumuistutusSyote(w)).toEqual(vahva);

    const nolla: MaksumuistutusSyote = { ...vahva, maksu: 0 as Cents };
    expect(decodeMaksumuistutusSyote(encodeMaksumuistutusSyote(nolla))).toEqual(nolla);
  });
});
