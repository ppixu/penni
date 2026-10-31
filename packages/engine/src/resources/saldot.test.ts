import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { haeSaldot } from './saldot.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };
const seed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 2000, tyyppi: 'BS', nimi: { fi: 'Velka' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {},
};
function vienti(tili: number, debet: number, kredit: number, pvm = '2026-06-01') {
  return { tili, debet: c(debet), kredit: c(kredit), pvm, alvKoodi: 0, alvProsentti: 0 };
}

describe('haeSaldot — sign normalization', () => {
  it('assets are debit-positive; liabilities/income are credit-positive', async () => {
    const s = createMemoryStorage(seed);
    // buy on credit 10000, sell 6000 cash
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [vienti(1900, 10000, 0), vienti(2000, 0, 10000)],
      },
      env,
    );
    await s.saveTosite(
      {
        pvm: '2026-06-02',
        tyyppi: 0,
        tila: 100,
        tunniste: 2,
        sarja: '',
        viennit: [vienti(1900, 6000, 0, '2026-06-02'), vienti(3000, 0, 6000, '2026-06-02')],
      },
      env,
    );
    const saldot = await haeSaldot(s, env, { pvm: '2026-06-30' });
    expect(saldot.get(1900)).toBe(16000); // asset: debet-kredit
    expect(saldot.get(2000)).toBe(10000); // liability: kredit-debet (credit-positive)
    expect(saldot.get(3000)).toBe(6000); // income: kredit-debet
  });

  it('single-account query returns just that account, sign-normalized', async () => {
    const s = createMemoryStorage(seed);
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [vienti(1900, 10000, 0), vienti(3000, 0, 10000)],
      },
      env,
    );
    const saldot = await haeSaldot(s, env, { pvm: '2026-06-30', tili: 3000 });
    expect([...saldot.keys()]).toEqual([3000]);
    expect(saldot.get(3000)).toBe(10000);
  });
});

const seedEquity = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } }, // EDELLISTENTULOS
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden tulos' } }, // KAUDENTULOS
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: {},
};

describe('haeSaldot — computed equity', () => {
  async function book() {
    const s = createMemoryStorage(seedEquity);
    // 2025: profit 3000 (sell 3000), cash in
    await s.saveTosite(
      {
        pvm: '2025-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [vienti(1900, 3000, 0, '2025-06-01'), vienti(3000, 0, 3000, '2025-06-01')],
      },
      env,
    );
    // 2026: sell 10000, expense 4000
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [vienti(1900, 10000, 0), vienti(3000, 0, 10000)],
      },
      env,
    );
    await s.saveTosite(
      {
        pvm: '2026-07-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 2,
        sarja: '',
        viennit: [vienti(4000, 4000, 0, '2026-07-01'), vienti(1900, 0, 4000, '2026-07-01')],
      },
      env,
    );
    return s;
  }

  it('KAUDENTULOS = current-period class>=3 net (credit-positive)', async () => {
    const s = await book();
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31' });
    // 2026 income 10000 (kredit) - expense 4000 (debet) = 6000 profit
    expect(saldot.get(2371)).toBe(6000);
  });

  it('EDELLISTENTULOS = own posted balance + prior-years class>=3 net', async () => {
    const s = await book();
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31' });
    // 2025 profit 3000, never posted to 2251 -> shows as retained earnings
    expect(saldot.get(2251)).toBe(3000);
  });

  it('alkusaldot omits KAUDENTULOS', async () => {
    const s = await book();
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31', alkusaldot: true });
    expect(saldot.has(2371)).toBe(false);
    expect(saldot.get(2251)).toBe(3000); // EDELLISTENTULOS still present
  });

  it('tuloslaskelma flag excludes balance-sheet accounts and equity rows', async () => {
    const s = await book();
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31', tuloslaskelma: true });
    expect(saldot.has(1900)).toBe(false);
    expect(saldot.has(2371)).toBe(false);
    expect(saldot.get(3000)).toBe(10000); // P&L accounts present
  });

  it('tase flag excludes the P&L result accounts but keeps balance sheet + equity', async () => {
    const s = await book();
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31', tase: true });
    expect(saldot.has(3000)).toBe(false);
    expect(saldot.get(2371)).toBe(6000); // equity rows still injected
  });

  it('alkusaldot applies the exclusive upper bound to the P&L block', async () => {
    // Regression for the alkusaldot exclusive bound on the result block:
    // an income entry dated exactly on pvm must be EXCLUDED from the opening figure.
    const s = createMemoryStorage(seedEquity);
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [vienti(1900, 7000, 0), vienti(3000, 0, 7000)],
      },
      env,
    );
    // exactly on pvm -> must be excluded under alkusaldot
    await s.saveTosite(
      {
        pvm: '2026-12-31',
        tyyppi: 0,
        tila: 100,
        tunniste: 2,
        sarja: '',
        viennit: [vienti(1900, 2000, 0, '2026-12-31'), vienti(3000, 0, 2000, '2026-12-31')],
      },
      env,
    );
    const saldot = await haeSaldot(s, env, {
      pvm: '2026-12-31',
      tuloslaskelma: true,
      alkusaldot: true,
    });
    // only the 06-01 entry (< 12-31); the 12-31 entry excluded
    expect(saldot.get(3000)).toBe(7000);
  });

  it('KAUDENTULOS is negative for a loss (expenses exceed income)', async () => {
    const s = createMemoryStorage(seedEquity);
    // income 3000, expense 5000 -> loss 2000
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [vienti(1900, 3000, 0), vienti(3000, 0, 3000)],
      },
      env,
    );
    await s.saveTosite(
      {
        pvm: '2026-07-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 2,
        sarja: '',
        viennit: [vienti(4000, 5000, 0, '2026-07-01'), vienti(1900, 0, 5000, '2026-07-01')],
      },
      env,
    );
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31' });
    expect(saldot.get(2371)).toBe(-2000);
  });

  it('EDELLISTENTULOS composes own posted balance + prior-years class>=3 net', async () => {
    const s = createMemoryStorage(seedEquity);
    // opening balance posted directly to EDELLISTENTULOS (2251): credit 1000 -> credit-positive 1000
    await s.saveTosite(
      {
        pvm: '2025-01-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [vienti(1900, 1000, 0, '2025-01-01'), vienti(2251, 0, 1000, '2025-01-01')],
      },
      env,
    );
    // prior-year (2025) profit 2000
    await s.saveTosite(
      {
        pvm: '2025-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 2,
        sarja: '',
        viennit: [vienti(1900, 2000, 0, '2025-06-01'), vienti(3000, 0, 2000, '2025-06-01')],
      },
      env,
    );
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31' });
    // own posted 1000 + prior class>=3 net 2000 = 3000 (NOT just prior 2000)
    expect(saldot.get(2251)).toBe(3000);
  });

  it('omits equity rows (no crash) when the chart has no BE/T account', async () => {
    const seedNoEquity = {
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
        { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: {},
    };
    const s = createMemoryStorage(seedNoEquity);
    await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 100,
        tunniste: 1,
        sarja: '',
        viennit: [vienti(1900, 5000, 0), vienti(3000, 0, 5000)],
      },
      env,
    );
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31' });
    expect(saldot.has(2251)).toBe(false);
    expect(saldot.has(2371)).toBe(false);
    expect(saldot.get(1900)).toBe(5000); // real balances still computed
    expect(saldot.get(3000)).toBe(5000);
  });
});
