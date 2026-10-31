import { Luonne } from '@penni/engine';
import type { Tosite } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createSqliteStorage } from './sqlite.js';

const c = (n: number): Cents => n as Cents;
const audit = { aika: '2026-06-01T10:00:00.000Z' };

function tosite(over: Partial<Tosite>): Tosite {
  return { pvm: '2026-06-01', tyyppi: 0, tila: 100, tunniste: 0, sarja: '', viennit: [], ...over };
}
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

describe('sqlite adapter — vouchers', () => {
  it('saveTosite assigns an id, getTosite round-trips, missing id -> null', async () => {
    const s = createSqliteStorage();
    const saved = await s.saveTosite(tosite({ tunniste: 1, otsikko: 'A' }), audit);
    expect(saved.id).toBeGreaterThan(0);
    const back = await s.getTosite(saved.id);
    expect(back?.tunniste).toBe(1);
    expect(back?.otsikko).toBe('A');
    expect(await s.getTosite(999)).toBeNull();
  });

  it('saveTosite updates in place when id is given (and rewrites viennit)', async () => {
    const s = createSqliteStorage();
    const a = await s.saveTosite(
      tosite({
        otsikko: 'A',
        viennit: [v(1900, 100, 0, '2026-06-01'), v(3000, 0, 100, '2026-06-01')],
      }),
      audit,
    );
    const b = await s.saveTosite({ ...a, otsikko: 'B' }, audit);
    expect(b.id).toBe(a.id);
    expect((await s.getTosite(a.id))?.otsikko).toBe('B');
    // saldo still correct after the in-place update (vienti index rewritten, not duplicated)
    expect((await s.querySaldot({ loppupvm: '2026-12-31' })).get(1900)).toBe(100);
  });

  it('appends an audit entry per write; soft delete logs null data', async () => {
    const s = createSqliteStorage();
    const a = await s.saveTosite(tosite({}), audit);
    await s.saveTosite({ ...a, otsikko: 'X' }, { aika: '2026-06-02T00:00:00.000Z' });
    expect(await s.getLoki(a.id)).toHaveLength(2);
    await s.softDeleteTosite(a.id, audit);
    expect((await s.getTosite(a.id))?.tila).toBe(0);
    expect((await s.getLoki(a.id)).at(-1)?.data).toBeNull();
  });

  it('patchTositeTila updates tila+tunniste, logs the snapshot, throws on missing', async () => {
    const s = createSqliteStorage();
    const a = await s.saveTosite(tosite({ tila: 50, tunniste: 0 }), audit);
    const upd = await s.patchTositeTila(a.id, 100, 7, audit, { tila: 100 });
    expect(upd.tila).toBe(100);
    expect(upd.tunniste).toBe(7);
    expect((await s.getTosite(a.id))?.tunniste).toBe(7);
    await expect(s.patchTositeTila(99999, 100, 1, audit, null)).rejects.toMatchObject({
      code: 'EITOSITETTA',
    });
  });

  it('maxTunniste buckets by fiscal year + series; null is its own bucket; drafts excluded', async () => {
    const s = createSqliteStorage();
    await s.saveTosite(tosite({ tunniste: 4, sarja: '' }), audit);
    await s.saveTosite(tosite({ tunniste: 7, sarja: 'OL' }), audit);
    await s.saveTosite(tosite({ tunniste: 9, sarja: '', tila: 50 }), audit); // draft, excluded
    await s.saveTosite(tosite({ tunniste: 5, sarja: '', pvm: '2025-06-01' }), audit); // other year
    expect(await s.maxTunniste('2026-01-01', '2026-12-31', null)).toBe(4);
    expect(await s.maxTunniste('2026-01-01', '2026-12-31', 'OL')).toBe(7);
    expect(await s.maxTunniste('2026-01-01', '2026-12-31', 'ZZ')).toBe(0);
  });

  it('listTositteet defaults to finalized, supports buckets + filters + ordering', async () => {
    const s = createSqliteStorage();
    await s.saveTosite(tosite({ tunniste: 2, pvm: '2026-05-01', tyyppi: 100 }), audit);
    await s.saveTosite(tosite({ tunniste: 1, pvm: '2026-03-01', tyyppi: 100 }), audit);
    await s.saveTosite(tosite({ tila: 50, pvm: '2026-04-01' }), audit); // draft
    const finalized = await s.listTositteet({});
    expect(finalized.map((t) => t.pvm)).toEqual(['2026-03-01', '2026-05-01']); // ORDER BY pvm
    expect(await s.listTositteet({ bucket: 'luonnos' })).toHaveLength(1);
    expect(await s.listTositteet({ tyyppi: 100 })).toHaveLength(2);
    expect(await s.listTositteet({ alkupvm: '2026-04-01' })).toHaveLength(1);
  });

  it('listViennit returns posted entries as full engine objects, filtered', async () => {
    const s = createSqliteStorage();
    await s.saveTosite(
      tosite({
        tunniste: 1,
        viennit: [v(1900, 500, 0, '2026-03-01'), v(3000, 0, 500, '2026-04-01')],
      }),
      audit,
    );
    await s.saveTosite(tosite({ tila: 50, viennit: [v(1900, 999, 0, '2026-03-01')] }), audit); // draft
    expect(await s.listViennit({})).toHaveLength(2);
    expect(await s.listViennit({ tili: 1900 })).toHaveLength(1);
    expect(await s.listViennit({ alkupvm: '2026-04-01' })).toHaveLength(1);
    const one = (await s.listViennit({ tili: 3000 }))[0];
    expect(one?.kredit).toBe(500); // integer cents preserved
  });
});

describe('sqlite adapter — querySaldot', () => {
  async function seeded() {
    const s = createSqliteStorage();
    await s.saveTosite(
      tosite({
        pvm: '2026-03-01',
        tunniste: 1,
        viennit: [v(1900, 10000, 0, '2026-03-01'), v(3000, 0, 10000, '2026-03-01')],
      }),
      audit,
    );
    await s.saveTosite(
      tosite({
        pvm: '2026-04-01',
        tunniste: 2,
        viennit: [v(1900, 0, 4000, '2026-04-01'), v(4000, 4000, 0, '2026-04-01')],
      }),
      audit,
    );
    await s.saveTosite(
      tosite({ pvm: '2026-05-01', tila: 50, viennit: [v(1900, 9999, 0, '2026-05-01')] }),
      audit,
    ); // draft excluded
    return s;
  }

  it('sums raw debet-kredit per account, posted only, cumulative', async () => {
    const m = await (await seeded()).querySaldot({ loppupvm: '2026-12-31' });
    expect(m.get(1900)).toBe(6000);
    expect(m.get(3000)).toBe(-10000);
    expect(m.get(4000)).toBe(4000);
  });

  it('respects the exclusive upper bound (opening balances)', async () => {
    const m = await (await seeded()).querySaldot({
      loppupvm: '2026-04-01',
      loppupvmExclusive: true,
    });
    expect(m.get(1900)).toBe(10000);
  });

  it('respects a period lower bound', async () => {
    const m = await (await seeded()).querySaldot({ alkupvm: '2026-04-01', loppupvm: '2026-12-31' });
    expect(m.get(1900)).toBe(-4000);
    expect(m.has(3000)).toBe(false);
  });

  it('filters by lexicographic account range (string, not numeric)', async () => {
    const s = createSqliteStorage();
    await s.saveTosite(
      tosite({
        tunniste: 1,
        viennit: [
          v(1, 100, 0, '2026-03-01'),
          v(10, 200, 0, '2026-03-01'),
          v(100, 300, 0, '2026-03-01'),
          v(2, 0, 600, '2026-03-01'),
        ],
      }),
      audit,
    );
    const lt2 = await s.querySaldot({ loppupvm: '2026-12-31', tiliAsti: '2' });
    expect([...lt2.keys()].sort((a, b) => a - b)).toEqual([1, 10, 100]);
    const ge2 = await s.querySaldot({ loppupvm: '2026-12-31', tiliAlkaen: '2' });
    expect([...ge2.keys()]).toEqual([2]);
  });

  it('filters by exact account and by kohdennus', async () => {
    const s = createSqliteStorage();
    await s.saveTosite(
      tosite({
        tunniste: 1,
        viennit: [v(3000, 0, 5000, '2026-03-01', 7), v(3000, 0, 3000, '2026-03-01', 9)],
      }),
      audit,
    );
    expect((await s.querySaldot({ loppupvm: '2026-12-31', tili: 3000 })).get(3000)).toBe(-8000);
    expect((await s.querySaldot({ loppupvm: '2026-12-31', kohdennus: 7 })).get(3000)).toBe(-5000);
  });
});

describe('sqlite adapter — master data', () => {
  const seed = {
    tilit: [
      { numero: 1, tyyppi: 'H1', nimi: { fi: 'Vastaavaa' } },
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { AlvVelvollinen: 'true' },
  };

  it('getChart resolves luonne; getTilikaudet/getAsetukset return the seed', async () => {
    const s = createSqliteStorage(seed);
    expect((await s.getChart()).find((t) => t.numero === 1900)?.luonne).toBe(Luonne.PANKKITILI);
    expect((await s.getTilikaudet())[0]?.alkaa).toBe('2026-01-01');
    expect((await s.getAsetukset()).AlvVelvollinen).toBe('true');
  });

  it('getInit bundles asetukset/tilit/tilikaudet/tositesarjat', async () => {
    const s = createSqliteStorage(seed);
    await s.saveTosite(tosite({ tunniste: 1, sarja: 'OL' }), audit);
    const init = await s.getInit();
    expect(init.tilit).toHaveLength(2);
    expect(init.tilikaudet).toHaveLength(1);
    expect(init.tositesarjat).toContain('OL');
    expect(init.kohdennukset).toEqual([]);
  });

  it('putTili stamps muokattu; patchInit skips user-modified rows but adds new', async () => {
    const s = createSqliteStorage(seed);
    await s.putTili(1900, { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Oma pankkitili' } });
    await s.patchInit({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili (malli)' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      ],
    });
    const chart = await s.getChart();
    expect(chart.find((t) => t.numero === 1900)?.nimi.fi).toBe('Oma pankkitili');
    expect(chart.find((t) => t.numero === 3000)?.nimi.fi).toBe('Myynti');
  });

  it('patchAsetukset stamps muokattu and null deletes; patchInit skips modified keys', async () => {
    const s = createSqliteStorage(seed);
    await s.patchAsetukset({ Nimi: 'Oy Esimerkki' });
    await s.patchInit({ asetukset: { Nimi: 'Malli', Maa: 'FI' } });
    const a = await s.getAsetukset();
    expect(a.Nimi).toBe('Oy Esimerkki');
    expect(a.Maa).toBe('FI');
    await s.patchAsetukset({ Nimi: null });
    expect((await s.getAsetukset()).Nimi).toBeUndefined();
  });

  it('putTilikausi upserts and deleteTilikausi removes', async () => {
    const s = createSqliteStorage(seed);
    await s.putTilikausi('2027-01-01', { alkaa: '2027-01-01', loppuu: '2027-12-31' });
    expect(await s.getTilikaudet()).toHaveLength(2);
    await s.deleteTilikausi('2027-01-01');
    expect(await s.getTilikaudet()).toHaveLength(1);
  });

  it('getChart returns isolated copies; mutating the result does not corrupt the store', async () => {
    const s = createSqliteStorage(seed);
    const first = await s.getChart();
    const acct = first.find((t) => t.numero === 1900);
    if (acct) acct.nimi.fi = 'MUTATED';
    expect((await s.getChart()).find((t) => t.numero === 1900)?.nimi.fi).toBe('Pankkitili');
  });
});
