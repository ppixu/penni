import { describe, expect, it } from 'vitest';
import { suorita } from './suorita.js';
import { io } from './testi/io.js';

describe('suorita', () => {
  it('ohje --json prints the registry schema dump, enriched with the invocable komento', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['ohje', '--json'], streams);
    expect(koodi).toBe(0);
    const dump = JSON.parse(out.join(''));
    expect(dump.versio).toBe(1);
    expect(dump.tyokalut).toHaveLength(13);
    for (const tyokalu of dump.tyokalut) expect(typeof tyokalu.komento).toBe('string');
    const tilitHaku = dump.tyokalut.find((t: { nimi: string }) => t.nimi === 'tilit_haku');
    expect(tilitHaku.komento).toBe('tilit');
    const liite = dump.tyokalut.find((t: { nimi: string }) => t.nimi === 'liite_lisays');
    expect(liite).toMatchObject({ komento: 'liite', kirjoittava: true });
    expect(liite.kaytto).toContain('penni liite <tositeId> <tiedosto');
    const tiliote = dump.tyokalut.find((t: { nimi: string }) => t.nimi === 'tiliote');
    expect(tiliote.kaytto).toContain('--luonnokset');
    for (const tyokalu of dump.tyokalut) expect(tyokalu.kaytto).toMatch(/^penni /);
  });

  it('ohje (human) lists invocable command names, not raw registry tool names', async () => {
    const { out, io: streams } = io();
    const koodi = await suorita(['ohje'], streams);
    expect(koodi).toBe(0);
    const teksti = out.join('');
    expect(teksti).toContain('tilit —');
    expect(teksti).not.toContain('tilit_haku');
    expect(teksti).toContain('käyttö: penni tiliote <tiliote.pdf>');
    expect(teksti).toContain('liitteet —');
  });

  it('fails with usage when the command is unknown', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(['hölynpöly'], streams);
    expect(koodi).toBe(1);
    expect(err.join('')).toContain('Käyttö');
  });

  it('fails clearly when --kirja is missing for a book command', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(['perustiedot'], streams);
    expect(koodi).toBe(1);
    expect(err.join('')).toContain('--kirja');
  });

  it('fails clearly when the book file does not exist', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(['--kirja', '/ei/ole/olemassa.penni', 'perustiedot'], streams);
    expect(koodi).toBe(1);
    expect(err.join('')).toContain('olemassa');
  });

  it('reports an unknown command as JSON when --json is set', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(['hölynpöly', '--json'], streams);
    expect(koodi).toBe(1);
    const virhe = JSON.parse(err.join(''));
    expect(virhe.koodi).toBe('KOMENTO');
    expect(virhe.virhe).toContain('Tuntematon komento');
  });

  it('reports a missing --kirja as JSON when --json is set', async () => {
    const { err, io: streams } = io();
    const koodi = await suorita(['perustiedot', '--json'], streams);
    expect(koodi).toBe(1);
    const virhe = JSON.parse(err.join(''));
    expect(virhe.koodi).toBe('KIRJA');
    expect(virhe.virhe).toContain('--kirja');
  });
});
