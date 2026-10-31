import { beforeAll, describe, expect, it } from 'vitest';
import { suorita } from './suorita.js';
import { io } from './testi/io.js';
import { luoTestikirja, siemennaTositteet } from './testi/kirja.js';

describe('komennot', () => {
  let polku: string;

  beforeAll(async () => {
    polku = luoTestikirja();
    await siemennaTositteet(polku);
  });

  it('saldot --json returns bank balance from the fixture', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(
      ['--kirja', polku, 'saldot', '--pvm', '2026-12-31', '--json'],
      streams,
    );
    expect(koodi).toBe(0);
    const tulos = JSON.parse(out.join(''));
    const pankki = tulos.saldot.find((s: { tili: number }) => s.tili === 1910);
    expect(pankki.sentit).toBe(10000); // finalized sale only — the draft must not affect balances
  });

  it('raportti tulos/yleinen renders rows', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(
      [
        '--kirja',
        polku,
        'raportti',
        'tulos/yleinen',
        '--pvm',
        '2026-12-31',
        '--alkupvm',
        '2026-01-01',
        '--json',
      ],
      streams,
    );
    expect(koodi).toBe(0);
    expect(JSON.parse(out.join('')).rivit.length).toBeGreaterThan(0);
  });

  it('tositteet --teksti finds the draft', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(
      ['--kirja', polku, 'tositteet', '--bucket', 'luonnos', '--teksti', 'puhelin', '--json'],
      streams,
    );
    expect(koodi).toBe(0);
    const tulos = JSON.parse(out.join(''));
    expect(tulos.tositteet).toHaveLength(1);
    expect(tulos.tositteet[0].otsikko).toBe('Puhelinlasku');
  });

  it('tosite <id> returns viennit with eur strings', async () => {
    const haku = io(); // find the finalized sale's id first
    await suorita(['--kirja', polku, 'tositteet', '--json'], haku.io);
    const id = JSON.parse(haku.out.join('')).tositteet[0].id;
    const { out, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'tosite', String(id), '--json'], streams);
    expect(koodi).toBe(0);
    const tulos = JSON.parse(out.join(''));
    expect(tulos.viennit).toHaveLength(2);
    expect(tulos.viennit[0].debet.eur).toContain('€');
    expect(tulos.viennit[0]).toMatchObject({ alvKoodi: 0, alvProsentti: 0 });
    expect(tulos.kumppani).toBeNull();
    expect(tulos.liitteet).toEqual([]);
  });

  it('viennit --tili 1910 lists entries', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'viennit', '--tili', '1910', '--json'], streams);
    expect(koodi).toBe(0);
    expect(JSON.parse(out.join('')).viennit.length).toBeGreaterThan(0);
  });

  it('alv returns maksettava', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'alv', '--json'], streams);
    expect(koodi).toBe(0);
    expect(typeof JSON.parse(out.join('')).maksettava.sentit).toBe('number');
  });

  it('human output (no --json) prints a table, not JSON', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'saldot', '--pvm', '2026-12-31'], streams);
    expect(koodi).toBe(0);
    const teksti = out.join('');
    expect(teksti.length).toBeGreaterThan(0);
    expect(teksti.trimStart().startsWith('{')).toBe(false);
  });

  it('saldot text output omits the empty alkupvm line when no start date is given', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'saldot', '--pvm', '2026-12-31'], streams);
    expect(koodi).toBe(0);
    const teksti = out.join('');
    expect(teksti).toContain('pvm: 2026-12-31');
    expect(teksti).not.toMatch(/^alkupvm:/m);
  });

  it('unknown report muoto exits 1 with koodi EIRAPORTTIA', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(
      ['--kirja', polku, 'raportti', 'hölö/yleinen', '--pvm', '2026-12-31', '--json'],
      streams,
    );
    expect(koodi).toBe(1);
    expect(JSON.parse(err.join('')).koodi).toBe('EIRAPORTTIA');
  });

  const luonnosSyote = JSON.stringify({
    pvm: '2026-05-01',
    tyyppi: 100,
    otsikko: 'CLI-luonnos',
    viennit: [
      { tili: 4000, debet: 990, kredit: 0 },
      { tili: 1910, debet: 0, kredit: 990 },
    ],
  });

  it('luonnos creates a draft from stdin JSON', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'luonnos', '--json'], {
      ...streams,
      stdin: luonnosSyote,
    });
    expect(koodi).toBe(0);
    const tulos = JSON.parse(out.join(''));
    expect(tulos.tila).toBe(50);
    // and the draft is visible afterwards:
    const haku = io();
    await suorita(
      ['--kirja', polku, 'tositteet', '--bucket', 'luonnos', '--teksti', 'CLI-luonnos', '--json'],
      haku.io,
    );
    expect(JSON.parse(haku.out.join('')).tositteet).toHaveLength(1);
  });

  it('luonnos rejects tila >= 100 with koodi LUONNOSVAIN', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'luonnos', '--json'], {
      ...streams,
      stdin: JSON.stringify({ ...JSON.parse(luonnosSyote), tila: 100 }),
    });
    expect(koodi).toBe(1);
    expect(JSON.parse(err.join('')).koodi).toBe('LUONNOSVAIN');
  });

  it('luonnos fails on malformed stdin JSON', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'luonnos', '--json'], {
      ...streams,
      stdin: 'ei jsonia',
    });
    expect(koodi).toBe(1);
    expect(JSON.parse(err.join('')).koodi).toBe('SYOTE');
  });

  it('luonnos reports an unbalanced draft as varoitukset in JSON and text mode', async () => {
    const epatasainen = JSON.stringify({
      pvm: '2026-05-02',
      tyyppi: 100,
      otsikko: 'Epätasainen',
      viennit: [
        { tili: 4000, debet: 1000, kredit: 0 },
        { tili: 1910, debet: 0, kredit: 900 },
      ],
    });
    const json = io();
    expect(
      await suorita(['--kirja', polku, 'luonnos', '--json'], { ...json.io, stdin: epatasainen }),
    ).toBe(0);
    const tulos = JSON.parse(json.out.join(''));
    expect(tulos.tila).toBe(50);
    expect(tulos.varoitukset).toContainEqual(
      expect.objectContaining({ koodi: 'EITASMAA', estaaKirjauksen: true }),
    );

    const teksti = io();
    expect(await suorita(['--kirja', polku, 'luonnos'], { ...teksti.io, stdin: epatasainen })).toBe(
      0,
    );
    const rivit = teksti.out.join('');
    expect(rivit).toContain('EITASMAA');
    expect(rivit).toContain('Debet');
    expect(rivit).toMatch(/^id: \d+$/m);
  });

  it('luonnos refuses an account missing from the chart with koodi TILIPUUTTUU', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(['--kirja', polku, 'luonnos', '--json'], {
      ...streams,
      stdin: JSON.stringify({
        pvm: '2026-05-03',
        tyyppi: 100,
        viennit: [
          { tili: 4999, debet: 1000, kredit: 0 },
          { tili: 1910, debet: 0, kredit: 1000 },
        ],
      }),
    });
    expect(koodi).toBe(1);
    const virhe = JSON.parse(err.join(''));
    expect(virhe.koodi).toBe('TILIPUUTTUU');
    expect(virhe.virhe).toContain('4999');
  });
});
