import { describe, expect, it } from 'vitest';
import { laskeSha, sha256Lista, tarkistaArkisto } from './tarkiste';
import { pakkaa, pura } from './zip';

const enc = new TextEncoder();
const A = enc.encode('alpha');
const C = new Uint8Array([1, 2, 3, 4, 5]);

async function rakenna(
  muokkaa?: (t: Map<string, Uint8Array>) => void,
  lisaa: { polku: string; data: Uint8Array }[] = [],
) {
  const sisalto = new Map<string, Uint8Array>([
    ['a.txt', A],
    ['b/c.bin', C],
  ]);
  const lista = await sha256Lista([...sisalto].map(([polku, data]) => ({ polku, data })));
  const listaTavut = enc.encode(lista);
  const juuri = await laskeSha(listaTavut);
  const tiedostot = new Map(sisalto);
  tiedostot.set('arkisto.sha256', listaTavut);
  tiedostot.set('index.html', enc.encode(`<p>${juuri}</p>`));
  muokkaa?.(tiedostot);
  const zip = pakkaa([
    ...[...tiedostot].map(([polku, data]) => ({ polku: `kausi/${polku}`, data })),
    ...lisaa,
  ]);
  return { zip, juuri };
}

describe('sha256Lista', () => {
  it('kirjoittaa rivin muodossa <sha> *<polku>', async () => {
    expect(await sha256Lista([{ polku: 'a.txt', data: A }])).toBe(`${await laskeSha(A)} *a.txt\n`);
  });
  it('järjestää rivit polun mukaan', async () => {
    const lista = await sha256Lista([
      { polku: 'b/c.bin', data: C },
      { polku: 'a.txt', data: A },
    ]);
    expect(lista.split('\n').map((r) => r.slice(66))).toEqual(['a.txt', 'b/c.bin', '']);
  });
});

describe('tarkistaArkisto', () => {
  it('hyväksyy koskemattoman arkiston', async () => {
    const { zip, juuri } = await rakenna();
    const tulos = await tarkistaArkisto(zip);
    expect(tulos).toEqual({ ok: true, juuriTiiviste: juuri, virheet: [] });
  });
  it('havaitsee muuttuneen tiedoston', async () => {
    const { zip } = await rakenna((t) => t.set('b/c.bin', new Uint8Array([1, 2, 3, 4, 6])));
    const tulos = await tarkistaArkisto(zip);
    expect(tulos.ok).toBe(false);
    expect(tulos.virheet).toContain('muuttunut: b/c.bin');
  });
  it('havaitsee puuttuvan tiedoston', async () => {
    const { zip } = await rakenna((t) => t.delete('a.txt'));
    expect((await tarkistaArkisto(zip)).virheet).toContain('puuttuu: a.txt');
  });
  it('havaitsee listaamattoman tiedoston', async () => {
    const { zip } = await rakenna((t) => t.set('x.txt', A));
    expect((await tarkistaArkisto(zip)).virheet).toContain('listaamaton: x.txt');
  });
  it('havaitsee väärän juuritiivisteen index.html:ssä', async () => {
    const { zip } = await rakenna((t) => t.set('index.html', enc.encode('<p>ei</p>')));
    const tulos = await tarkistaArkisto(zip);
    expect(tulos.ok).toBe(false);
    expect(tulos.virheet).toContain('juuritiiviste ei täsmää index.html');
  });
  it('ei laske arkistovarmennetta listaamattomaksi', async () => {
    const { zip } = await rakenna((t) => t.set('arkistovarmenne.html', A));
    expect((await tarkistaArkisto(zip)).ok).toBe(true);
  });
  it('hylkää toisen juurikansion, jonka tiedosto korvaisi alkuperäisen', async () => {
    const { zip } = await rakenna(undefined, [
      { polku: 'toinen/b/c.bin', data: new Uint8Array([9, 9, 9]) },
    ]);
    const tulos = await tarkistaArkisto(zip);
    expect(tulos.ok).toBe(false);
    expect(tulos.virheet).toContain('useita juurikansioita: kausi, toinen');
  });
  it('hylkää juureen sijoitetun tiedoston', async () => {
    const { zip } = await rakenna(undefined, [{ polku: 'a.txt', data: A }]);
    const tulos = await tarkistaArkisto(zip);
    expect(tulos.ok).toBe(false);
    expect(tulos.virheet).toEqual(['tiedosto juuressa: a.txt']);
  });
  it('ilmoittaa puuttuvan tiivistelistan', async () => {
    const { zip } = await rakenna((t) => t.delete('arkisto.sha256'));
    const tulos = await tarkistaArkisto(zip);
    expect(tulos.ok).toBe(false);
    expect(tulos.virheet).toContain('puuttuu: arkisto.sha256');
  });
});

describe('zip', () => {
  it('pura(pakkaa(...)) palauttaa samat tavut', () => {
    const data = new Uint8Array(2000).map((_, i) => i % 7);
    const purettu = pura(
      pakkaa([
        { polku: 'x/a.bin', data },
        { polku: 'x/b.bin', data: C, pakkaa: false },
      ]),
    );
    expect([...purettu.keys()].sort()).toEqual(['x/a.bin', 'x/b.bin']);
    expect(purettu.get('x/a.bin')).toEqual(data);
    expect(purettu.get('x/b.bin')).toEqual(C);
  });
});
