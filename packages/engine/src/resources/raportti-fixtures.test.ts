import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import type { TiliData } from '../accounts/tili.js';
import { type RaporttiMaaritys, tulkitseRaportti } from './raportti.js';
import { haeSaldot } from './saldot.js';

const chartUrl = new URL('../../../../charts/yritys/tilit.json', import.meta.url);
const raportitUrl = new URL('../../../../charts/yritys/raportit.json', import.meta.url);
const tilit = JSON.parse(readFileSync(fileURLToPath(chartUrl), 'utf8')) as TiliData[];
const raportit = JSON.parse(readFileSync(fileURLToPath(raportitUrl), 'utf8')) as Record<
  string,
  RaporttiMaaritys
>;

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };

function v(tili: number, debet: number, kredit: number, pvm: string) {
  return { tili, debet: c(debet), kredit: c(kredit), pvm, alvKoodi: 0, alvProsentti: 0 };
}

async function book() {
  const s = createMemoryStorage({
    tilit,
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {},
  });
  // A balanced little year: sales 30000 to bank; buy goods 12000 from bank; pay wages 8000 from bank.
  await s.saveTosite(
    {
      pvm: '2026-03-01',
      tyyppi: 0,
      tila: 100,
      tunniste: 1,
      sarja: '',
      viennit: [v(1910, 30000, 0, '2026-03-01'), v(3000, 0, 30000, '2026-03-01')],
    },
    env,
  );
  await s.saveTosite(
    {
      pvm: '2026-04-01',
      tyyppi: 0,
      tila: 100,
      tunniste: 2,
      sarja: '',
      viennit: [v(4000, 12000, 0, '2026-04-01'), v(1910, 0, 12000, '2026-04-01')],
    },
    env,
  );
  await s.saveTosite(
    {
      pvm: '2026-05-01',
      tyyppi: 0,
      tila: 100,
      tunniste: 3,
      sarja: '',
      viennit: [v(5000, 8000, 0, '2026-05-01'), v(1910, 0, 8000, '2026-05-01')],
    },
    env,
  );
  return s;
}

const find = (rows: { teksti: string; arvo: Cents | null }[], t: string) =>
  rows.find((r) => r.teksti === t);

describe('real yritys layouts render coherently', () => {
  it('income statement: result = 30000 - 12000 - 8000 = 10000', async () => {
    const s = await book();
    const chart = await s.getChart();
    const saldot = await haeSaldot(s, env, {
      pvm: '2026-12-31',
      alkupvm: '2026-01-01',
      tuloslaskelma: true,
    });
    const tulos = raportit['tulos/yleinen'];
    expect(tulos).toBeDefined();
    const rows = tulkitseRaportti(tulos as RaporttiMaaritys, saldot, chart, 'fi');
    expect(find(rows, 'Tilikauden voitto/tappio')?.arvo).toBe(10000);
  });

  it('balance sheet BALANCES: total assets === total liabilities+equity', async () => {
    const s = await book();
    const chart = await s.getChart();
    const saldot = await haeSaldot(s, env, { pvm: '2026-12-31', tase: true });
    const tase = raportit['tase/PMA'];
    expect(tase).toBeDefined();
    const rows = tulkitseRaportti(tase as RaporttiMaaritys, saldot, chart, 'fi');
    const vastaavaa = find(rows, 'Vastaavaa yhteensä')?.arvo;
    const vastattavaa = find(rows, 'Vastattavaa yhteensä')?.arvo;
    expect(vastaavaa).toBe(10000); // bank: 30000 - 12000 - 8000
    expect(vastattavaa).toBe(vastaavaa); // the computed result row makes it balance
  });
});
