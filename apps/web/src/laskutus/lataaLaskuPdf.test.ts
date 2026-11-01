import { laskeSha } from '@/liitteet/laskeSha';
import type { KpClient } from '@penni/asiakas';
import {
  type LiiteMeta,
  ResourceError,
  type StoredTosite,
  TositeTyyppi,
  type UusiLiite,
} from '@penni/engine';
import type { LaskuMalli } from '@penni/lasku-pdf';
import { describe, expect, it } from 'vitest';
import { haeAiemmat, lataaLaskuPdf, tallennaLaskuPdf } from './lataaLaskuPdf';

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

const tosite = (osa: Partial<StoredTosite>): StoredTosite => ({
  id: 1,
  pvm: '2026-04-01',
  tyyppi: TositeTyyppi.MYYNTILASKU,
  tila: 100,
  tunniste: 1,
  sarja: 'M',
  viennit: [],
  ...osa,
});
const MUISTUTUS = tosite({
  id: 9,
  tyyppi: TositeTyyppi.MAKSUMUISTUTUS,
  muistutus: {
    maksu: 500 as never,
    korko: 0 as never,
    viivkorko: 0,
    korkoalkaa: '2026-05-01',
    korkoloppuu: '2026-05-30',
    aiempiSaldo: 100000 as never,
    aiemmat: [2, 5],
  },
});

/** Asiakas, jonka haeTosite palauttaa annetut tositteet id:n mukaan ja kirjaa haut. */
function tositeAsiakas(tositteet: StoredTosite[]) {
  const haut: number[] = [];
  const client: Pick<KpClient, 'haeLiitteet' | 'lisaaLiite' | 'haeTosite'> = {
    ...feikkiAsiakas().client,
    haeTosite: async (id) => {
      haut.push(id);
      return tositteet.find((t) => t.id === id) ?? null;
    },
  };
  return { client, haut };
}

describe('haeAiemmat', () => {
  it('hakee muistutuksen aiemmat tositteet järjestyksessä', async () => {
    const a = tosite({ id: 2, numero: '1' });
    const b = tosite({ id: 5, tyyppi: TositeTyyppi.MAKSUMUISTUTUS, numero: '4' });
    const { client } = tositeAsiakas([b, a]);
    expect(await haeAiemmat(client, MUISTUTUS)).toEqual([a, b]);
  });

  it('muulle tositteelle tyhjä lista eikä hakuja', async () => {
    const { client, haut } = tositeAsiakas([]);
    expect(await haeAiemmat(client, tosite({ id: 3 }))).toEqual([]);
    expect(haut).toEqual([]);
  });

  it('puuttuva aiempi tosite heittää', async () => {
    const { client } = tositeAsiakas([tosite({ id: 2 })]);
    await expect(haeAiemmat(client, MUISTUTUS)).rejects.toThrow(/5/);
  });
});

describe('lataaLaskuPdf', () => {
  const estettyMalli = { pdfEste: 'testieste', numero: '4' } as unknown as LaskuMalli;
  const nyt = NYT;

  it('välittää maksumuistutuksen aiemmat tositteet mallin muodostajalle', async () => {
    const a = tosite({ id: 2 });
    const b = tosite({ id: 5 });
    const { client } = tositeAsiakas([a, b]);
    let saatu: readonly StoredTosite[] = [];
    const huomio = await lataaLaskuPdf({
      tosite: MUISTUTUS,
      muodosta: (aiemmat) => {
        saatu = aiemmat;
        return estettyMalli;
      },
      client,
      nyt,
    });
    expect(saatu).toEqual([a, b]);
    expect(huomio).toBe('PDF:ää ei ladattu: testieste');
  });

  it('tavallisella laskulla aiemmat on tyhjä eikä tositteita haeta', async () => {
    const { client, haut } = tositeAsiakas([]);
    let saatu: readonly StoredTosite[] | undefined;
    await lataaLaskuPdf({
      tosite: tosite({ id: 3 }),
      muodosta: (aiemmat) => {
        saatu = aiemmat;
        return estettyMalli;
      },
      client,
      nyt,
    });
    expect(saatu).toEqual([]);
    expect(haut).toEqual([]);
  });

  it('aiempaa asiakirjaa ei löydy → huomautus, ei mallia eikä latausta', async () => {
    const { client } = tositeAsiakas([tosite({ id: 2 })]);
    let muodostettu = false;
    const huomio = await lataaLaskuPdf({
      tosite: MUISTUTUS,
      muodosta: () => {
        muodostettu = true;
        return estettyMalli;
      },
      client,
      nyt,
    });
    expect(huomio).toMatch(/^PDF:ää ei ladattu: aiempia asiakirjoja ei voitu hakea/);
    expect(muodostettu).toBe(false);
  });
});
