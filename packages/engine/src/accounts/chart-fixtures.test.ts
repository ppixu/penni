import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Luonne } from './luonne.js';
import { type TiliData, lataaKartta } from './tili.js';

// charts/ is at the repo root: packages/engine/src/accounts -> ../../../../charts
const chartUrl = new URL('../../../../charts/yritys/tilit.json', import.meta.url);
const raw = JSON.parse(readFileSync(fileURLToPath(chartUrl), 'utf8')) as TiliData[];

describe('real yritys chart loads cleanly', () => {
  const chart = lataaKartta(raw);

  it('has many accounts', () => {
    expect(chart.length).toBeGreaterThan(50);
  });

  it('every account resolves to a known nature (no TUNTEMATON)', () => {
    const unknown = chart.filter((t) => t.luonne === Luonne.TUNTEMATON);
    expect(unknown.map((t) => `${t.numero}:${t.tyyppiKoodi}`)).toEqual([]);
  });

  it('headings carry OTSIKKO and a positive level', () => {
    const headings = chart.filter((t) => t.luonne === Luonne.OTSIKKO);
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) expect(h.otsikkotaso).toBeGreaterThan(0);
  });
});
