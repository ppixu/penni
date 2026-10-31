import type { StoredTosite, Tosite } from '@penni/engine';
import { Luonne } from '@penni/engine';
import { type ConformanceSeed, runResourceConformance } from '@penni/engine/conformance';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from './memory.js';

const c = (n: number): Cents => n as Cents;
const audit = { aika: '2026-06-01T10:00:00.000Z' };

function tosite(over: Partial<Tosite>): Tosite {
  return { pvm: '2026-06-01', tyyppi: 0, tila: 100, tunniste: 0, sarja: '', viennit: [], ...over };
}

describe('memory adapter — vouchers', () => {
  it('saveTosite assigns an id and getTosite round-trips', async () => {
    const s = createMemoryStorage();
    const saved = await s.saveTosite(tosite({ tunniste: 1 }), audit);
    expect(saved.id).toBeGreaterThan(0);
    expect((await s.getTosite(saved.id))?.tunniste).toBe(1);
    expect(await s.getTosite(999)).toBeNull();
  });

  it('saveTosite updates in place when id is given', async () => {
    const s = createMemoryStorage();
    const a = await s.saveTosite(tosite({ otsikko: 'A' }), audit);
    const b = await s.saveTosite({ ...a, otsikko: 'B' }, audit);
    expect(b.id).toBe(a.id);
    expect((await s.getTosite(a.id))?.otsikko).toBe('B');
  });

  it('appends an audit entry per write', async () => {
    const s = createMemoryStorage();
    const a = await s.saveTosite(tosite({}), audit);
    await s.saveTosite({ ...a, otsikko: 'X' }, { aika: '2026-06-02T00:00:00.000Z' });
    const loki = await s.getLoki(a.id);
    expect(loki).toHaveLength(2);
    expect(loki[0]?.data).not.toBeNull();
  });

  it('softDeleteTosite sets tila=0 and logs a null-data entry', async () => {
    const s = createMemoryStorage();
    const a = await s.saveTosite(tosite({}), audit);
    await s.softDeleteTosite(a.id, audit);
    expect((await s.getTosite(a.id))?.tila).toBe(0);
    expect((await s.getLoki(a.id)).at(-1)?.data).toBeNull();
  });

  it('maxTunniste buckets by fiscal year + series; null is its own bucket', async () => {
    const s = createMemoryStorage();
    await s.saveTosite(tosite({ tunniste: 4, sarja: '' }), audit);
    await s.saveTosite(tosite({ tunniste: 7, sarja: 'OL' }), audit);
    await s.saveTosite(tosite({ tunniste: 9, sarja: '', tila: 50 }), audit); // draft, excluded
    await s.saveTosite(tosite({ tunniste: 5, sarja: '', pvm: '2025-06-01' }), audit); // other year
    expect(await s.maxTunniste('2026-01-01', '2026-12-31', null)).toBe(4);
    expect(await s.maxTunniste('2026-01-01', '2026-12-31', 'OL')).toBe(7);
    expect(await s.maxTunniste('2026-01-01', '2026-12-31', 'ZZ')).toBe(0);
  });

  it('listTositteet defaults to finalized, supports buckets + filters', async () => {
    const s = createMemoryStorage();
    await s.saveTosite(tosite({ tunniste: 1, pvm: '2026-03-01', tyyppi: 100 }), audit);
    await s.saveTosite(tosite({ tila: 50, pvm: '2026-04-01' }), audit); // draft
    const finalized = await s.listTositteet({});
    expect(finalized).toHaveLength(1);
    expect(await s.listTositteet({ bucket: 'luonnos' })).toHaveLength(1);
    expect(await s.listTositteet({ tyyppi: 100 })).toHaveLength(1);
    expect(await s.listTositteet({ alkupvm: '2026-04-01' })).toHaveLength(0);
  });
});

describe('memory adapter — querySaldot', () => {
  function v(tili: number, debet: number, kredit: number, pvm: string, kohdennus?: number) {
    return {
      tili,
      debet: c(debet),
      kredit: c(kredit),
      pvm,
      alvKoodi: 0,
      alvProsentti: 0,
      ...(kohdennus !== undefined ? { kohdennus } : {}),
    };
  }
  async function seeded() {
    const s = createMemoryStorage();
    await s.saveTosite(
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [v(1900, 10000, 0, '2026-03-01'), v(3000, 0, 10000, '2026-03-01')],
      },
      audit,
    );
    await s.saveTosite(
      {
        pvm: '2026-04-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 2,
        sarja: '',
        viennit: [v(1900, 0, 4000, '2026-04-01'), v(4000, 4000, 0, '2026-04-01')],
      },
      audit,
    );
    await s.saveTosite(
      {
        pvm: '2026-05-01',
        tyyppi: 0,
        tila: 50,
        tunniste: 0,
        sarja: '',
        viennit: [v(1900, 9999, 0, '2026-05-01')],
      },
      audit,
    ); // draft excluded
    return s;
  }

  it('sums raw debet-kredit per account, posted only, cumulative', async () => {
    const s = await seeded();
    const m = await s.querySaldot({ loppupvm: '2026-12-31' });
    expect(m.get(1900)).toBe(6000); // 10000 - 4000
    expect(m.get(3000)).toBe(-10000); // 0 - 10000
    expect(m.get(4000)).toBe(4000);
  });

  it('respects the exclusive upper bound (opening balances)', async () => {
    const s = await seeded();
    const m = await s.querySaldot({ loppupvm: '2026-04-01', loppupvmExclusive: true });
    expect(m.get(1900)).toBe(10000); // only the 03-01 entry (< 04-01)
  });

  it('respects a period lower bound', async () => {
    const s = await seeded();
    const m = await s.querySaldot({ alkupvm: '2026-04-01', loppupvm: '2026-12-31' });
    expect(m.get(1900)).toBe(-4000); // only the 04-01 entry
    expect(m.has(3000)).toBe(false);
  });

  it('filters by lexicographic account range (string, not numeric)', async () => {
    const s = createMemoryStorage();
    await s.saveTosite(
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [
          v(1, 100, 0, '2026-03-01'),
          v(10, 200, 0, '2026-03-01'),
          v(100, 300, 0, '2026-03-01'),
          v(2, 0, 600, '2026-03-01'),
        ],
      },
      audit,
    );
    const lt2 = await s.querySaldot({ loppupvm: '2026-12-31', tiliAsti: '2' });
    expect([...lt2.keys()].sort((a, b) => a - b)).toEqual([1, 10, 100]); // '1','10','100' < '2'; '2' excluded
    const ge2 = await s.querySaldot({ loppupvm: '2026-12-31', tiliAlkaen: '2' });
    expect([...ge2.keys()]).toEqual([2]);
  });

  it('filters by exact account and by kohdennus', async () => {
    const s = createMemoryStorage();
    await s.saveTosite(
      {
        pvm: '2026-03-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [v(3000, 0, 5000, '2026-03-01', 7), v(3000, 0, 3000, '2026-03-01', 9)],
      },
      audit,
    );
    expect((await s.querySaldot({ loppupvm: '2026-12-31', tili: 3000 })).get(3000)).toBe(-8000);
    expect((await s.querySaldot({ loppupvm: '2026-12-31', kohdennus: 7 })).get(3000)).toBe(-5000);
  });
});

describe('memory adapter — master data', () => {
  const seed = {
    tilit: [
      { numero: 1, tyyppi: 'H1', nimi: { fi: 'Vastaavaa' } },
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { AlvVelvollinen: 'true' },
  };

  it('getChart resolves luonne; getTilikaudet/getAsetukset return the seed', async () => {
    const s = createMemoryStorage(seed);
    const chart = await s.getChart();
    expect(chart.find((t) => t.numero === 1900)?.luonne).toBe(Luonne.PANKKITILI);
    expect((await s.getTilikaudet())[0]?.alkaa).toBe('2026-01-01');
    expect((await s.getAsetukset()).AlvVelvollinen).toBe('true');
  });

  it('getInit bundles asetukset/tilit/tilikaudet/tositesarjat', async () => {
    const s = createMemoryStorage(seed);
    await s.saveTosite(
      { pvm: '2026-06-01', tyyppi: 0, tila: 100, tunniste: 1, sarja: 'OL', viennit: [] },
      audit,
    );
    const init = await s.getInit();
    expect(init.tilit).toHaveLength(2);
    expect(init.tilikaudet).toHaveLength(1);
    expect(init.tositesarjat).toContain('OL');
    expect(init.kohdennukset).toEqual([]);
  });

  it('putTili stamps muokattu; patchInit skips user-modified rows', async () => {
    const s = createMemoryStorage(seed);
    await s.putTili(1900, { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Oma pankkitili' } });
    // template merge tries to reset 1900 and add 3000
    await s.patchInit({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili (malli)' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      ],
    });
    const chart = await s.getChart();
    expect(chart.find((t) => t.numero === 1900)?.nimi.fi).toBe('Oma pankkitili'); // user edit survived
    expect(chart.find((t) => t.numero === 3000)?.nimi.fi).toBe('Myynti'); // new template row added
  });

  it('patchAsetukset stamps muokattu and null deletes; patchInit skips modified keys', async () => {
    const s = createMemoryStorage(seed);
    await s.patchAsetukset({ Nimi: 'Oy Esimerkki' });
    await s.patchInit({ asetukset: { Nimi: 'Malli', Maa: 'FI' } });
    const a = await s.getAsetukset();
    expect(a.Nimi).toBe('Oy Esimerkki'); // user edit survived template
    expect(a.Maa).toBe('FI'); // new template key applied
  });

  it('putTilikausi/deleteTilikausi work', async () => {
    const s = createMemoryStorage(seed);
    await s.putTilikausi('2027-01-01', { alkaa: '2027-01-01', loppuu: '2027-12-31' });
    expect(await s.getTilikaudet()).toHaveLength(2);
    await s.deleteTilikausi('2027-01-01');
    expect(await s.getTilikaudet()).toHaveLength(1);
  });

  it('getChart returns isolated copies; mutating the result does not corrupt the store', async () => {
    const s = createMemoryStorage(seed);
    const first = await s.getChart();
    const acct = first.find((t) => t.numero === 1900);
    if (acct) acct.nimi.fi = 'MUTATED';
    const second = await s.getChart();
    expect(second.find((t) => t.numero === 1900)?.nimi.fi).toBe('Pankkitili');
  });
});

runResourceConformance('@penni/storage-memory', (seed: ConformanceSeed) =>
  createMemoryStorage(seed),
);
