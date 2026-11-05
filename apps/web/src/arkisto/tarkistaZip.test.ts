import { describe, expect, it } from 'vitest';
import { tarkistaZip } from './tarkistaZip';
import { laskeSha, sha256Lista } from './tarkiste';
import { pakkaa } from './zip';

const enc = new TextEncoder();
const SIVU = enc.encode('<p>sivu</p>');
const MANIFEST = enc.encode(
  JSON.stringify({
    muoto: 'penni-arkisto',
    versio: 1,
    tilikausi: { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    luotu: '2026-01-15T10:00:00.000Z',
  }),
);

/** Arkisto- tai vientipaketti kuten Penni sen kirjoittaa: yksi juurikansio, tiivistelista ja
 *  arkistolla index.html, jossa juuritiiviste. */
async function paketti(
  laji: 'arkisto' | 'vienti',
  muokkaa?: (t: Map<string, Uint8Array>) => void,
): Promise<{ zip: Uint8Array; juuri: string }> {
  const sisalto = new Map<string, Uint8Array>(
    laji === 'arkisto'
      ? [
          ['raportit/paivakirja.html', SIVU],
          ['manifest.json', MANIFEST],
        ]
      : [
          ['viennit.csv', enc.encode('a;b\r\n')],
          ['kirjanpito.json', enc.encode('{}')],
        ],
  );
  const listanNimi = laji === 'arkisto' ? 'arkisto.sha256' : 'vienti.sha256';
  const lista = enc.encode(
    await sha256Lista([...sisalto].map(([polku, data]) => ({ polku, data }))),
  );
  const juuri = await laskeSha(lista);
  const tiedostot = new Map(sisalto);
  tiedostot.set(listanNimi, lista);
  if (laji === 'arkisto') tiedostot.set('index.html', enc.encode(`<code>${juuri}</code>`));
  muokkaa?.(tiedostot);
  const zip = pakkaa([...tiedostot].map(([polku, data]) => ({ polku: `2025/${polku}`, data })));
  return { zip, juuri };
}

const kirjaus = (tiiviste: string) => ({
  'Arkistoitu/2025-12-31': JSON.stringify({ aika: '2026-01-15T10:00:00.000Z', tiiviste }),
});

describe('tarkistaZip', () => {
  it('tunnistaa eheän arkiston ja lukee kauden manifestista', async () => {
    const { zip, juuri } = await paketti('arkisto');
    const tulos = await tarkistaZip(zip, kirjaus(juuri));
    expect(tulos).toEqual({
      laji: 'arkisto',
      ok: true,
      juuriTiiviste: juuri,
      virheet: [],
      tiedostoja: 2,
      tilikausi: { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      luotu: '2026-01-15T10:00:00.000Z',
      kirjanTiiviste: 'tasmaa',
    });
  });

  it('kertoo, kun kirjaan on tallennettu eri tiiviste', async () => {
    const { zip } = await paketti('arkisto');
    expect((await tarkistaZip(zip, kirjaus('f'.repeat(64)))).kirjanTiiviste).toBe('eri');
  });

  it('kertoo, kun kirjassa ei ole kauden arkistointia', async () => {
    const { zip } = await paketti('arkisto');
    expect((await tarkistaZip(zip, {})).kirjanTiiviste).toBe('ei-kirjausta');
  });

  it('havaitsee muutetun tiedoston arkistossa', async () => {
    const { zip } = await paketti('arkisto', (t) =>
      t.set('raportit/paivakirja.html', enc.encode('<p>muutettu</p>')),
    );
    const tulos = await tarkistaZip(zip, {});
    expect(tulos.ok).toBe(false);
    expect(tulos.virheet).toEqual(['muuttunut: raportit/paivakirja.html']);
  });

  it('tarkistaa kirjanpidon viennin vienti.sha256-listalla', async () => {
    const { zip, juuri } = await paketti('vienti');
    expect(await tarkistaZip(zip, {})).toEqual({
      laji: 'vienti',
      ok: true,
      juuriTiiviste: juuri,
      virheet: [],
      tiedostoja: 2,
      tilikausi: null,
      luotu: null,
      kirjanTiiviste: null,
    });
  });

  it('havaitsee muutetun tiedoston viennissä', async () => {
    const { zip } = await paketti('vienti', (t) => t.set('viennit.csv', enc.encode('x')));
    expect((await tarkistaZip(zip, {})).virheet).toEqual(['muuttunut: viennit.csv']);
  });

  it('hylkää zipin, joka ei ole Pennin arkisto eikä vienti', async () => {
    const zip = pakkaa([{ polku: 'kansio/muu.txt', data: SIVU }]);
    const tulos = await tarkistaZip(zip, {});
    expect(tulos.laji).toBeNull();
    expect(tulos.ok).toBe(false);
    expect(tulos.virheet).toEqual(['Tiedosto ei ole Pennin arkisto eikä kirjanpidon vienti.']);
  });

  it('hylkää tiedoston, joka ei ole zip', async () => {
    const tulos = await tarkistaZip(enc.encode('ei zip'), {});
    expect(tulos.ok).toBe(false);
    expect(tulos.virheet).toEqual(['Tiedosto ei ole zip-paketti.']);
  });
});
