import { laskeSha } from '@/liitteet/laskeSha';
import type { KpClient } from '@penni/asiakas';
import { type LiiteMeta, ResourceError, type UusiLiite } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { tallennaLaskuPdf } from './lataaLaskuPdf';

const NYT = '2026-06-10T10:00:00.000Z';
const A = new Uint8Array([1, 2, 3]);
const B = new Uint8Array([4, 5, 6]);

/** Muistinvarainen liitelista; `lisaaLiite` voi hylätä. */
function feikkiAsiakas(alku: LiiteMeta[] = [], hylkaa?: unknown) {
  const liitteet: LiiteMeta[] = [...alku];
  const client: Pick<KpClient, 'haeLiitteet' | 'lisaaLiite'> = {
    haeLiitteet: async () => [...liitteet],
    lisaaLiite: async (l: UusiLiite) => {
      if (hylkaa !== undefined) throw hylkaa;
      const { data: _data, ...meta } = l;
      const uusi: LiiteMeta = { ...meta, id: liitteet.length + 100 };
      liitteet.push(uusi);
      return uusi;
    },
  };
  return { client, liitteet };
}

const kutsu = (client: Pick<KpClient, 'haeLiitteet' | 'lisaaLiite'>, tavut: Uint8Array) =>
  tallennaLaskuPdf({ client, tositeId: 1, numero: '7', tavut, nyt: NYT });

describe('tallennaLaskuPdf', () => {
  it('tallentaa ensimmäisen PDF:n nimellä lasku-<numero>.pdf', async () => {
    const { client, liitteet } = feikkiAsiakas();
    expect(await kutsu(client, A)).toBe('tallennettu');
    expect(liitteet).toHaveLength(1);
    expect(liitteet[0]).toMatchObject({
      tosite: 1,
      nimi: 'lasku-7.pdf',
      tyyppi: 'application/pdf',
      sha: await laskeSha(A),
      luotu: NYT,
    });
  });

  it('samat tavut toisen kerran → oli-jo, ei uutta liitettä', async () => {
    const { client, liitteet } = feikkiAsiakas();
    await kutsu(client, A);
    expect(await kutsu(client, A)).toBe('oli-jo');
    expect(liitteet).toHaveLength(1);
  });

  it('eri tavut → toinen liite lasku-7-2.pdf, ensimmäinen koskematta', async () => {
    const { client, liitteet } = feikkiAsiakas();
    await kutsu(client, A);
    const ensimmainen = { ...liitteet[0] };
    expect(await kutsu(client, B)).toBe('tallennettu');
    expect(liitteet.map((l) => l.nimi)).toEqual(['lasku-7.pdf', 'lasku-7-2.pdf']);
    expect(liitteet[0]).toEqual(ensimmainen);
  });

  it('kolmas eri versio saa nimen lasku-7-3.pdf', async () => {
    const { client, liitteet } = feikkiAsiakas();
    await kutsu(client, A);
    await kutsu(client, B);
    await kutsu(client, new Uint8Array([9]));
    expect(liitteet.map((l) => l.nimi)).toEqual(['lasku-7.pdf', 'lasku-7-2.pdf', 'lasku-7-3.pdf']);
  });

  it('säilyttää Kitsas-tuonnin lasku7.pdf:n (eri sha) ja lisää uuden viereen', async () => {
    const kitsas: LiiteMeta = {
      id: 5,
      tosite: 1,
      nimi: 'lasku7.pdf',
      tyyppi: 'application/pdf',
      sha: 'ab'.repeat(32),
      luotu: '2026-06-01T00:00:00.000Z',
    };
    const { client, liitteet } = feikkiAsiakas([kitsas]);
    expect(await kutsu(client, A)).toBe('tallennettu');
    expect(liitteet.map((l) => l.nimi)).toEqual(['lasku7.pdf', 'lasku-7.pdf']);
    expect(liitteet[0]).toEqual(kitsas);
  });

  it('lisaaLiite hylkää PVMLUKITTU:lla → kausi-lukittu, ei heitä', async () => {
    const { client, liitteet } = feikkiAsiakas(
      [],
      new ResourceError('PVMLUKITTU', 'Tilikausi on lukittu'),
    );
    expect(await kutsu(client, A)).toBe('kausi-lukittu');
    expect(liitteet).toHaveLength(0);
  });

  it('lisaaLiite hylkää muusta syystä → ei-tallennettu, ei heitä', async () => {
    const { client, liitteet } = feikkiAsiakas([], new Error('levy täynnä'));
    expect(await kutsu(client, A)).toBe('ei-tallennettu');
    expect(liitteet).toHaveLength(0);
  });

  it('haeLiitteet-virhe → ei-tallennettu, ei heitä (lataus ei saa estyä)', async () => {
    let lisaaKutsuttu = false;
    const client: Pick<KpClient, 'haeLiitteet' | 'lisaaLiite'> = {
      haeLiitteet: async () => {
        throw new Error('verkko poikki');
      },
      lisaaLiite: async () => {
        lisaaKutsuttu = true;
        throw new Error('ei kutsuta');
      },
    };
    expect(await kutsu(client, A)).toBe('ei-tallennettu');
    expect(lisaaKutsuttu).toBe(false);
  });
});
