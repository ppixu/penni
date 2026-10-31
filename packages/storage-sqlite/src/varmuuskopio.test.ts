import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cents } from '@penni/euro';
import { afterAll, describe, expect, it } from 'vitest';
import { createSqliteStorage } from './sqlite.js';

const c = (n: number): Cents => n as Cents;
const dir = mkdtempSync(join(tmpdir(), 'penni-varmuuskopio-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function kirjaTositteella(polku: string) {
  const s = createSqliteStorage(
    { tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } }] },
    { tiedosto: polku },
  );
  await s.saveTosite(
    {
      pvm: '2026-03-01',
      tyyppi: 0,
      tila: 100,
      tunniste: 1,
      sarja: '',
      viennit: [
        {
          tili: 1900,
          debet: c(5000),
          kredit: c(0),
          pvm: '2026-03-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 3000,
          debet: c(0),
          kredit: c(5000),
          pvm: '2026-03-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    },
    { aika: '2026-03-01T10:00:00.000Z' },
  );
  return s;
}

describe('varmuuskopioi', () => {
  it('kirjoittaa avoimesta kirjasta yhtenäisen kopion, joka avautuu samalla sisällöllä', async () => {
    const lahde = join(dir, 'kirja.penni');
    const kohde = join(dir, 'kopio.penni');
    const s = await kirjaTositteella(lahde);
    s.varmuuskopioi(kohde);
    s.close();

    const kopio = createSqliteStorage({}, { tiedosto: kohde });
    const tositteet = await kopio.listTositteet({});
    kopio.close();
    expect(tositteet).toHaveLength(1);
    // Väliaikaistiedosto ei jää lojumaan kohdekansioon.
    expect(readdirSync(dir).filter((n) => n.includes('osittainen'))).toEqual([]);
  });

  it('ei koskaan ylikirjoita olemassa olevaa tiedostoa', async () => {
    const lahde = join(dir, 'kirja2.penni');
    const kohde = join(dir, 'olemassa.penni');
    writeFileSync(kohde, 'älä koske');
    const s = await kirjaTositteella(lahde);
    expect(() => s.varmuuskopioi(kohde)).toThrow(/on jo olemassa/);
    s.close();
    expect(existsSync(kohde)).toBe(true);
  });
});
