import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStorage } from '@penni/storage-memory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kirjoitaKirja } from './kirjoitaKirja.js';
import { lueKitsas } from './lueKitsas.js';
import { tarkistaTuonti } from './tarkistaTuonti.js';
import { luoTestiKitsas } from './testi/luoTestiKitsas.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-koko-'));
const polku = join(hakemisto, 'testi.kitsas');
// Never open kitsas-source/ in place — it's a WAL-mode SQLite file, and even a readonly
// open can leave -shm/-wal side files next to the reference fixture. Copy it into the
// temp dir first, same as lueKitsas.test.ts does.
const OIKEA_LAHDE = new URL('../../../kitsas-source/unittest/data/oy.kitsas', import.meta.url)
  .pathname;
const oikeaPolku = join(hakemisto, 'oy.kitsas');
// kitsas-source on git-alimoduuli: ilman `git submodule update --init` fixtuuria ei ole ja
// sitä käyttävät testit ohitetaan.
const onOikeaLahde = existsSync(OIKEA_LAHDE);

beforeAll(() => {
  luoTestiKitsas(polku);
  if (onOikeaLahde) copyFileSync(OIKEA_LAHDE, oikeaPolku);
});
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

const AIKA = '2026-07-31T12:00:00.000Z';

describe('koko tuonti', () => {
  it.skipIf(!onOikeaLahde)('tuo oikean Kitsas-fixturen ja täsmäytys menee läpi', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(oikeaPolku);
    const raportti = await kirjoitaKirja(kirja, storage, { aika: AIKA });
    expect(raportti.tositteet).toBe(10);
    const taysmaytys = await tarkistaTuonti(kirja, storage);
    expect(taysmaytys.erot).toEqual([]);
    expect(taysmaytys.tasmaa).toBe(true);
  });

  it('numerointi jatkuu tuoduista tunnisteista eikä törmää', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    await kirjoitaKirja(kirja, storage, { aika: AIKA });
    // Viimeistellyt tositteet 2025:llä ovat tunnisteet 1, 2 ja 4 (tosite 5, 31.12.).
    // Poistettu tosite 3 kantaa tunnistetta 99, joten jos maxTunniste lakkaisi suodattamasta
    // tilan mukaan, se palauttaisi 99 eikä 4 — juuri siksi poistetun numero on korkein.
    const suurin = await storage.maxTunniste('2025-01-01', '2025-12-31', null);
    expect(suurin).toBe(4);
  });

  it('tuonti on idempotentti: sama kirja kahdesti ei kahdenna tositteita', async () => {
    const storage = createMemoryStorage();
    const kirja = lueKitsas(polku);
    await kirjoitaKirja(kirja, storage, { aika: AIKA });
    await kirjoitaKirja(kirja, storage, { aika: AIKA });
    const tositteet = await storage.listTositteet({ bucket: 'kirjanpidossa' });
    expect(tositteet).toHaveLength(3); // tositteet 1, 2 ja 5
    const taysmaytys = await tarkistaTuonti(kirja, storage);
    expect(taysmaytys.tasmaa).toBe(true);
  });
});
