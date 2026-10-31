import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InProcessClient } from '@penni/asiakas';
import { createSqliteStorage } from '@penni/storage-sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { suorita } from './suorita.js';
import { io } from './testi/io.js';
import { luoTestikirja, siemennaTositteet } from './testi/kirja.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-cli-liite-'));
function tiedosto(nimi: string, sisalto: Uint8Array | string): string {
  const polku = join(hakemisto, nimi);
  writeFileSync(polku, sisalto);
  return polku;
}
const PDF = '%PDF-1.4\n% testikuitti\n%%EOF\n';

async function tositteet(polku: string, bucket: string): Promise<{ id: number }[]> {
  const haku = io();
  await suorita(['--kirja', polku, 'tositteet', '--bucket', bucket, '--json'], haku.io);
  return JSON.parse(haku.out.join('')).tositteet;
}

describe('liite + liitteet', () => {
  let polku: string;
  let luonnos: number;

  beforeAll(async () => {
    polku = luoTestikirja();
    await siemennaTositteet(polku);
    luonnos = (await tositteet(polku, 'luonnos'))[0]?.id as number;
  });

  it('attaches a PDF read from disk and records --agentti in the voucher log', async () => {
    const kuitti = tiedosto('kuitti-2026-03.pdf', PDF);
    const { out, io: streams } = io();
    const koodi = await suorita(
      ['--kirja', polku, '--agentti', 'claude-code', 'liite', String(luonnos), kuitti, '--json'],
      streams,
    );
    expect(koodi).toBe(0);
    const tulos = JSON.parse(out.join(''));
    expect(tulos).toMatchObject({
      tosite: luonnos,
      nimi: 'kuitti-2026-03.pdf',
      tyyppi: 'application/pdf',
      koko: PDF.length,
    });

    const storage = createSqliteStorage({}, { tiedosto: polku });
    try {
      const loki = await storage.getLoki(luonnos);
      expect(loki.at(-1)).toMatchObject({
        lahde: 'claude-code',
        data: { liite: { id: tulos.id } },
      });
    } finally {
      storage.close();
    }

    const lista = io();
    expect(await suorita(['--kirja', polku, 'liitteet', String(luonnos), '--json'], lista.io)).toBe(
      0,
    );
    expect(JSON.parse(lista.out.join('')).liitteet).toContainEqual(
      expect.objectContaining({ id: tulos.id, nimi: 'kuitti-2026-03.pdf', koko: PDF.length }),
    );
  });

  it('--nimi overrides the stored file name; text mode prints avain: arvo lines', async () => {
    const kuitti = tiedosto('scan0001.pdf', PDF);
    const { out, io: streams } = io();
    const koodi = await suorita(
      ['--kirja', polku, 'liite', String(luonnos), kuitti, '--nimi', 'Puhelinlasku 3-2026.pdf'],
      streams,
    );
    expect(koodi).toBe(0);
    expect(out.join('')).toContain('nimi: Puhelinlasku 3-2026.pdf');
  });

  it('reports a missing file with koodi TIEDOSTO', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(
      ['--kirja', polku, 'liite', String(luonnos), join(hakemisto, 'eiole.pdf'), '--json'],
      streams,
    );
    expect(koodi).toBe(1);
    expect(JSON.parse(err.join('')).koodi).toBe('TIEDOSTO');
  });

  it('refuses an unsupported extension and content that does not match it', async () => {
    const teksti = io();
    expect(
      await suorita(
        ['--kirja', polku, 'liite', String(luonnos), tiedosto('muistio.txt', 'hei'), '--json'],
        teksti.io,
      ),
    ).toBe(1);
    expect(JSON.parse(teksti.err.join('')).koodi).toBe('TIEDOSTOTYYPPI');

    const valepdf = io();
    expect(
      await suorita(
        ['--kirja', polku, 'liite', String(luonnos), tiedosto('vale.pdf', 'ei pdf'), '--json'],
        valepdf.io,
      ),
    ).toBe(1);
    expect(JSON.parse(valepdf.err.join('')).koodi).toBe('TIEDOSTOTYYPPI');
  });

  it('refuses a booked voucher in a locked period with koodi PVMLUKITTU', async () => {
    const lukittu = luoTestikirja();
    await siemennaTositteet(lukittu);
    const storage = createSqliteStorage({}, { tiedosto: lukittu });
    try {
      await new InProcessClient(storage).paivitaAsetukset({ TilitPaatetty: '2026-06-30' });
    } finally {
      storage.close();
    }
    const kirjattu = (await tositteet(lukittu, 'kirjanpidossa'))[0]?.id as number;
    const { err, io: streams } = io();
    const koodi = await suorita(
      ['--kirja', lukittu, 'liite', String(kirjattu), tiedosto('lukittu.pdf', PDF), '--json'],
      streams,
    );
    expect(koodi).toBe(1);
    expect(JSON.parse(err.join('')).koodi).toBe('PVMLUKITTU');
  });
});
