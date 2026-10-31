import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { luoTestiPdf } from '@penni/luku/testi';
import { createSqliteStorage } from '@penni/storage-sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { suorita } from './suorita.js';
import { io } from './testi/io.js';
import { luoTestikirja, siemennaTositteet } from './testi/kirja.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-cli-tiliote-'));

/** Kuvitteellinen kuukausitiliote helmikuulta; kirjassa myynti 100,00 € on kirjattu 1.2. */
function tiliotePdf(nimi: string, rivit: readonly string[]): string {
  const polku = join(hakemisto, nimi);
  writeFileSync(polku, luoTestiPdf(rivit));
  return polku;
}
const HELMIKUU = [
  'Tiliote',
  'TESTI OY',
  'Kausi: 01.02.2026 - 28.02.2026',
  'Kirjauspäivä Arvopäivä Saaja/Maksaja Määrä Saldo',
  '31.01.2026 Saldo 0,00',
  '02.02 02.02 ASIAKAS OY 100,00 100,00',
  'Viite 1232',
  '16.02 16.02 PILVIPALVELU -20,00 80,00',
  'Korttiosto',
  '28.02.2026 Saldo 80,00',
];

describe('tiliote', () => {
  let kirja: string;
  let pdf: string;

  beforeEach(async () => {
    kirja = luoTestikirja();
    await siemennaTositteet(kirja);
    pdf = tiliotePdf('helmikuu.pdf', HELMIKUU);
  });

  it('reads the PDF and reports period, balance checks and per-row booking state', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['--kirja', kirja, 'tiliote', pdf, '--json'], streams);
    expect(koodi).toBe(0);
    const tulos = JSON.parse(out.join(''));
    expect(tulos.pankkitili).toEqual({ numero: 1910, nimi: 'Pankkitili 1' });
    expect(tulos.muoto).toBe('kuukausitiliote');
    expect(tulos.kausi).toEqual({ alkaa: '2026-02-01', loppuu: '2026-02-28' });
    expect(tulos.saldot).toMatchObject({
      alkusaldo: { sentit: 0 },
      loppusaldo: { sentit: 8000 },
      tapahtumienSumma: { sentit: 8000 },
      tasmaa: true,
    });
    expect(tulos.kirjanpito).toMatchObject({
      pvm: '2026-01-31',
      saldo: { sentit: 0 },
      tasmaa: true,
    });
    expect(tulos.rivit).toHaveLength(2);
    expect(tulos.rivit[0]).toMatchObject({
      nimi: 'ASIAKAS OY',
      viite: '1232',
      maara: { sentit: 10000 },
      tila: 'joKirjattu',
      kirjattu: true,
    });
    expect(tulos.rivit[1]).toMatchObject({ nimi: 'PILVIPALVELU', kirjattu: false, luonnos: null });
    expect(tulos.luonnokset).toBeNull();
  });

  it('--luonnokset creates drafts for unbooked rows and tags them with --agentti', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(
      ['--kirja', kirja, '--agentti', 'claude-code', 'tiliote', pdf, '--luonnokset', '--json'],
      streams,
    );
    expect(koodi).toBe(0);
    const tulos = JSON.parse(out.join(''));
    expect(tulos.luonnokset).toHaveLength(1);
    const id = tulos.rivit[1].luonnos;
    expect(tulos.luonnokset).toEqual([id]);

    const tosite = io();
    await suorita(['--kirja', kirja, 'tosite', String(id), '--json'], tosite.io);
    const luonnos = JSON.parse(tosite.out.join(''));
    expect(luonnos).toMatchObject({ tila: 50, tunniste: 0, pvm: '2026-02-16' });
    expect(luonnos.viennit).toContainEqual(
      expect.objectContaining({ tili: 1910, kredit: expect.objectContaining({ sentit: 2000 }) }),
    );
    const storage = createSqliteStorage({}, { tiedosto: kirja });
    try {
      expect((await storage.getLoki(id)).at(-1)?.lahde).toBe('claude-code');
    } finally {
      storage.close();
    }
  });

  it('--tili overrides the bank account; text mode prints the rows as a table', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['--kirja', kirja, 'tiliote', pdf, '--tili', '1920'], streams);
    expect(koodi).toBe(0);
    const teksti = out.join('');
    expect(teksti).toMatch(/^nro\s+pvm\s+nimi/m);
    expect(teksti).toContain('PILVIPALVELU');
    expect(teksti).toContain('pankkitili: numero=1920, nimi=Pankkitili 2');
    expect(teksti).toContain('tasmaa=true');
    expect(teksti).not.toContain('{"');
  });

  it('reports a PDF without the expected content and a missing file', async () => {
    const vaara = tiliotePdf('muistio.pdf', ['Muistio', 'Tässä ei ole yhtään tilitapahtumaa.']);
    const vaaraMuoto = io();
    expect(await suorita(['--kirja', kirja, 'tiliote', vaara, '--json'], vaaraMuoto.io)).toBe(1);
    expect(JSON.parse(vaaraMuoto.err.join('')).koodi).toBe('VAARA_MUOTO');

    const puuttuu = io();
    expect(
      await suorita(
        ['--kirja', kirja, 'tiliote', join(hakemisto, 'eiole.pdf'), '--json'],
        puuttuu.io,
      ),
    ).toBe(1);
    expect(JSON.parse(puuttuu.err.join('')).koodi).toBe('TIEDOSTO');
  });
});
