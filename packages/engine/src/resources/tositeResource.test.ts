import { ResourceError, TositeTila, TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import {
  haeTosite,
  lisaaLiite,
  listaaTositteet,
  listaaViennit,
  muutaTositteenTila,
  poistaTosite,
  tallennaTosite,
} from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };
const seed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { AlvVelvollinen: 'true' },
};

describe('voucher reads', () => {
  it('haeTosite returns null for a missing id', async () => {
    const s = createMemoryStorage(seed);
    expect(await haeTosite(s, 1)).toBeNull();
  });
  it('listaaTositteet returns finalized vouchers by default', async () => {
    const s = createMemoryStorage(seed);
    await s.saveTosite(
      { pvm: '2026-05-01', tyyppi: 0, tila: 100, tunniste: 1, sarja: '', viennit: [] },
      env,
    );
    const list = await listaaTositteet(s, {});
    expect(list).toHaveLength(1);
  });
});

function vientiPari(d: number): {
  viennit: {
    tili: number;
    debet: Cents;
    kredit: Cents;
    pvm: string;
    alvKoodi: number;
    alvProsentti: number;
  }[];
} {
  return {
    viennit: [
      { tili: 1900, debet: c(d), kredit: c(0), pvm: '2026-06-01', alvKoodi: 0, alvProsentti: 0 },
      { tili: 3000, debet: c(0), kredit: c(d), pvm: '2026-06-01', alvKoodi: 0, alvProsentti: 0 },
    ],
  };
}

describe('listaaTositteet — alkupera', () => {
  it('kertoo tositteen alueen alv-koodista tai kumppanin maasta', async () => {
    const s = createMemoryStorage(seed);
    const ruotsi = await s.saveKumppani({ nimi: 'AB', maa: 'se' });
    const pari = (alvKoodi: number) =>
      vientiPari(100).viennit.map((v, i) => (i === 0 ? { ...v, alvKoodi } : v));
    const tallenna = (otsikko: string, viennit: ReturnType<typeof pari>, kumppani?: number) =>
      s.saveTosite(
        {
          pvm: '2026-05-01',
          tyyppi: 0,
          tila: 100,
          tunniste: 0,
          sarja: '',
          otsikko,
          viennit,
          ...(kumppani !== undefined ? { kumppani } : {}),
        },
        env,
      );
    await tallenna('Kotimaa', pari(11));
    await tallenna('Tuonti', pari(29));
    await tallenna('Kumppani', pari(0), ruotsi.id);
    await tallenna('Muistio', pari(0));

    const lista = await listaaTositteet(s, {});
    expect(lista.map((t) => [t.otsikko, t.alkupera])).toEqual([
      ['Kotimaa', 'kotimaa'],
      ['Tuonti', 'muu'],
      ['Kumppani', 'eu'],
      ['Muistio', undefined],
    ]);
  });
});

describe('tallennaTosite', () => {
  it('assigns gapless tunniste per series at finalize', async () => {
    const s = createMemoryStorage(seed);
    const a = await tallennaTosite(
      s,
      { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...vientiPari(10000) },
      env,
    );
    const b = await tallennaTosite(
      s,
      { pvm: '2026-06-02', tyyppi: 0, sarja: '', ...vientiPari(10000) },
      env,
    );
    expect(a.tunniste).toBe(1);
    expect(b.tunniste).toBe(2);
  });

  it('kumppaniton tosite saa kumppanin otsikosta, annettu kumppani säilyy', async () => {
    const s = createMemoryStorage(seed);
    const github = await s.saveKumppani({ nimi: 'Github' });
    const muu = await s.saveKumppani({ nimi: 'Muu Oy' });
    const perus = { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...vientiPari(564) };
    const tunnistettu = await tallennaTosite(s, { ...perus, otsikko: 'GitHub' }, env);
    expect(tunnistettu.kumppani).toBe(github.id);
    const annettu = await tallennaTosite(s, { ...perus, otsikko: 'GitHub', kumppani: muu.id }, env);
    expect(annettu.kumppani).toBe(muu.id);
    const tuntematon = await tallennaTosite(s, { ...perus, otsikko: 'Kahvila' }, env);
    expect(tuntematon).not.toHaveProperty('kumppani');
  });

  it('drafts get tunniste 0', async () => {
    const s = createMemoryStorage(seed);
    const d = await tallennaTosite(
      s,
      { pvm: '2026-06-01', tyyppi: 0, tila: 50, sarja: '', ...vientiPari(10000) },
      env,
    );
    expect(d.tunniste).toBe(0);
  });

  it('rejects finalize when debet != kredit (EIVALMISTU)', async () => {
    const s = createMemoryStorage(seed);
    await expect(
      tallennaTosite(
        s,
        {
          pvm: '2026-06-01',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(10000),
              kredit: c(0),
              pvm: '2026-06-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIVALMISTU' });
  });

  it('allows an unbalanced TILINAVAUS', async () => {
    const s = createMemoryStorage(seed);
    const t = await tallennaTosite(
      s,
      {
        pvm: '2026-06-01',
        tyyppi: TositeTyyppi.TILINAVAUS,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(10000),
            kredit: c(0),
            pvm: '2026-06-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    expect(t.id).toBeGreaterThan(0);
  });

  it('rejects any save into a locked period (PVMLUKITTU)', async () => {
    const s = createMemoryStorage({
      ...seed,
      asetukset: { ...seed.asetukset, TilitPaatetty: '2026-06-30' },
    });
    await expect(
      tallennaTosite(
        s,
        { pvm: '2026-06-15', tyyppi: 0, tila: 50, sarja: '', ...vientiPari(10000) },
        env,
      ),
    ).rejects.toMatchObject({ code: 'PVMLUKITTU' });
  });

  it('renumbers when an update moves the voucher to a new series', async () => {
    const s = createMemoryStorage(seed);
    await tallennaTosite(
      s,
      { pvm: '2026-06-01', tyyppi: 0, sarja: 'OL', ...vientiPari(10000) },
      env,
    );
    const a = await tallennaTosite(
      s,
      { pvm: '2026-06-02', tyyppi: 0, sarja: 'OL', ...vientiPari(10000) },
      env,
    );
    expect(a.tunniste).toBe(2);
    const moved = await tallennaTosite(s, { ...a, sarja: '' }, env); // change series -> renumber in new bucket
    expect(moved.tunniste).toBe(1);
  });

  it('listan liitteita-kenttä ei tallennu, kun listattu tosite tallennetaan takaisin', async () => {
    const s = createMemoryStorage(seed);
    const t = await tallennaTosite(
      s,
      { pvm: '2026-05-01', tyyppi: 0, tila: TositeTila.LUONNOS, sarja: '', ...vientiPari(100) },
      env,
    );
    const [listattu] = await listaaTositteet(s, { bucket: 'luonnos' });
    expect(listattu?.liitteita).toBe(0);
    await tallennaTosite(s, { ...(listattu as NonNullable<typeof listattu>), otsikko: 'X' }, env);
    expect(await s.getTosite(t.id)).not.toHaveProperty('liitteita');
  });

  it('keeps the stored tunniste when an update omits it (no gap in numbering)', async () => {
    const s = createMemoryStorage(seed);
    const a = await tallennaTosite(
      s,
      { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...vientiPari(10000) },
      env,
    );
    await tallennaTosite(s, { pvm: '2026-06-02', tyyppi: 0, sarja: '', ...vientiPari(10000) }, env);
    const { tunniste: _pois, ...ilmanNumeroa } = a;
    const paivitetty = await tallennaTosite(
      s,
      { ...ilmanNumeroa, otsikko: 'Korjattu', ...vientiPari(20000) },
      env,
    );
    expect(paivitetty.tunniste).toBe(1);
  });
});

describe('muutaTositteenTila + poistaTosite', () => {
  it('finalizing a draft via PATCH assigns a tunniste', async () => {
    const s = createMemoryStorage(seed);
    const draft = await tallennaTosite(
      s,
      { pvm: '2026-06-01', tyyppi: 0, tila: 50, sarja: '', ...vientiPari(10000) },
      env,
    );
    expect(draft.tunniste).toBe(0);
    const fin = await muutaTositteenTila(s, draft.id, TositeTila.KIRJANPIDOSSA, env);
    expect(fin.tila).toBe(100);
    expect(fin.tunniste).toBe(1);
  });

  it('PATCH finalize is rejected when the voucher does not balance', async () => {
    const s = createMemoryStorage(seed);
    const draft = await s.saveTosite(
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        tila: 50,
        tunniste: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(10000),
            kredit: c(0),
            pvm: '2026-06-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    await expect(
      muutaTositteenTila(s, draft.id, TositeTila.KIRJANPIDOSSA, env),
    ).rejects.toMatchObject({ code: 'EIVALMISTU' });
  });

  it('poistaTosite soft-deletes (tila 0, excluded from default list, recoverable)', async () => {
    const s = createMemoryStorage(seed);
    const t = await tallennaTosite(
      s,
      { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...vientiPari(10000) },
      env,
    );
    await poistaTosite(s, t.id, env);
    expect(await listaaTositteet(s, {})).toHaveLength(0);
    expect(await listaaTositteet(s, { bucket: 'poistetut' })).toHaveLength(1);
    expect((await haeTosite(s, t.id))?.tila).toBe(0);
  });
});

describe('listaaViennit', () => {
  it('returns all entries of finalized vouchers and filters by tili', async () => {
    const s = createMemoryStorage(seed);
    await tallennaTosite(s, { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...vientiPari(10000) }, env);
    await tallennaTosite(s, { pvm: '2026-06-02', tyyppi: 0, sarja: '', ...vientiPari(20000) }, env);
    const kaikki = await listaaViennit(s, {});
    expect(kaikki).toHaveLength(4); // 2 vouchers x 2 entries each
    const pankki = await listaaViennit(s, { tili: 1900 });
    expect(pankki).toHaveLength(2);
    expect(pankki.every((v) => v.tili === 1900)).toBe(true);
  });
});

describe('lisaaLiite', () => {
  const liite = (tosite: number) => ({
    tosite,
    nimi: 'kuitti.pdf',
    tyyppi: 'application/pdf',
    sha: 'ab12',
    luotu: '2026-06-01T00:00:00.000Z',
    data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  });
  const tosite = (pvm: string, tila: number) => ({
    pvm,
    tyyppi: 0,
    sarja: '',
    tila,
    viennit: vientiPari(1000).viennit.map((v) => ({ ...v, pvm })),
  });

  it('attaches to a draft and logs the addition with lahde, leaving tila and tunniste alone', async () => {
    const s = createMemoryStorage(seed);
    const t = await tallennaTosite(s, tosite('2026-06-01', TositeTila.LUONNOS), env);
    const meta = await lisaaLiite(s, liite(t.id), { ...env, lahde: 'agentti:testi' });
    expect(meta).toMatchObject({ tosite: t.id, nimi: 'kuitti.pdf', tyyppi: 'application/pdf' });
    expect(await s.getLiitteet(t.id)).toHaveLength(1);
    const loki = await s.getLoki(t.id);
    expect(loki.at(-1)).toMatchObject({
      tila: TositeTila.LUONNOS,
      lahde: 'agentti:testi',
      data: { liite: { id: meta.id, nimi: 'kuitti.pdf', tyyppi: 'application/pdf', sha: 'ab12' } },
    });
    expect((await haeTosite(s, t.id))?.tila).toBe(TositeTila.LUONNOS);
  });

  it('attaches to a booked voucher in an open period without touching its number', async () => {
    const s = createMemoryStorage(seed);
    const t = await tallennaTosite(s, tosite('2026-06-01', TositeTila.KIRJANPIDOSSA), env);
    await lisaaLiite(s, liite(t.id), env);
    const jalkeen = await haeTosite(s, t.id);
    expect(jalkeen?.tunniste).toBe(t.tunniste);
    expect(jalkeen?.tila).toBe(TositeTila.KIRJANPIDOSSA);
    expect(await s.getLiitteet(t.id)).toHaveLength(1);
  });

  it('refuses a booked voucher in a locked period with PVMLUKITTU', async () => {
    const s = createMemoryStorage(seed);
    const t = await tallennaTosite(s, tosite('2026-03-01', TositeTila.KIRJANPIDOSSA), env);
    await s.patchAsetukset({ TilitPaatetty: '2026-03-31' });
    await expect(lisaaLiite(s, liite(t.id), env)).rejects.toMatchObject({ code: 'PVMLUKITTU' });
    expect(await s.getLiitteet(t.id)).toHaveLength(0);
  });

  it('refuses a deleted voucher and a missing one', async () => {
    const s = createMemoryStorage(seed);
    const t = await tallennaTosite(s, tosite('2026-06-01', TositeTila.LUONNOS), env);
    await poistaTosite(s, t.id, env);
    await expect(lisaaLiite(s, liite(t.id), env)).rejects.toMatchObject({
      code: 'LIITE_EI_SALLITTU',
    });
    await expect(lisaaLiite(s, liite(999), env)).rejects.toMatchObject({ code: 'EITOSITETTA' });
  });

  it('always inserts a new attachment, ignoring an id or roolinimi in the input', async () => {
    const s = createMemoryStorage(seed);
    const t = await tallennaTosite(s, tosite('2026-06-01', TositeTila.LUONNOS), env);
    const eka = await lisaaLiite(s, liite(t.id), env);
    const toka = await lisaaLiite(s, { ...liite(t.id), id: eka.id, roolinimi: 'lasku' }, env);
    expect(toka.id).not.toBe(eka.id);
    expect(toka.roolinimi).toBeUndefined();
    expect(await s.getLiitteet(t.id)).toHaveLength(2);
  });
});
