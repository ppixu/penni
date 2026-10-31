import { TositeTila, TositeTyyppi } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { lueTyokalut } from '../rekisteri.js';
import { c, env, luoTestikirja } from '../testi/kirja.js';
import { tiliote } from './tiliote.js';

/** Testikirja + tammikuun kirjattu pilvipalvelulasku (historia ehdotuksille) ja omistajan nimi. */
async function kirja(lahde?: string) {
  const testikirja = await luoTestikirja(lahde);
  const { client } = testikirja;
  await client.paivitaAsetukset({ TasmaysOmistajanNimet: '["meikäläinen matti"]' });
  const t = await client.luoTosite({
    pvm: '2026-01-10',
    tyyppi: TositeTyyppi.MENO,
    sarja: '',
    otsikko: 'Pilvipalvelu tammikuu 2026',
    viennit: [
      { tili: 4000, debet: c(2000), kredit: c(0), pvm: '2026-01-10', alvKoodi: 0, alvProsentti: 0 },
      {
        tili: 1900,
        debet: c(0),
        kredit: c(2000),
        pvm: '2026-01-10',
        alvKoodi: 0,
        alvProsentti: 0,
        selite: 'PILVIPALVELU',
      },
    ],
  });
  expect(t.tila).toBe(TositeTila.KIRJANPIDOSSA);
  return testikirja;
}

// Kuvitteellinen helmikuun tiliote; testikirjassa myynti 100,00 € on kirjattu 1.2.
const TILIOTE = {
  muoto: 'kuukausitiliote' as const,
  kausi: { alkaa: '2026-02-01', loppuu: '2026-02-28' },
  alkusaldo: -2000,
  loppusaldo: -24000,
  tapahtumat: [
    { pvm: '2026-02-02', nimi: 'ASIAKAS OY', maara: 10000, viite: '1232' },
    { pvm: '2026-02-10', nimi: 'PILVIPALVELU', maara: -2000 },
    { pvm: '2026-02-20', nimi: 'MEIKÄLÄINEN MATTI', maara: -30000 },
  ],
};

interface Tulos {
  pankkitili: { numero: number; nimi: string | null };
  saldot: { tasmaa: boolean; erotus: { sentit: number } } | null;
  kirjanpito: { pvm: string; saldo: { sentit: number }; tasmaa: boolean } | null;
  lukumaarat: Record<string, number>;
  rivit: {
    nro: number;
    tila: string;
    kirjattu: boolean;
    kirjattuTunniste: string | null;
    ehdotus: { tili: number; otsikko: string | null; alvKoodi: number } | null;
    luonnos: number | null;
  }[];
  luonnokset: number[] | null;
}

describe('tiliote', () => {
  it('checks both balances and classifies every transaction without writing anything', async () => {
    const { client } = await kirja();
    const tulos = (await tiliote.suorita(client, { tiliote: TILIOTE }, env)) as Tulos;
    expect(tulos.pankkitili).toEqual({ numero: 1900, nimi: 'Pankkitili' });
    expect(tulos.saldot).toMatchObject({ tasmaa: true, erotus: { sentit: 0 } });
    expect(tulos.kirjanpito).toMatchObject({
      pvm: '2026-01-31',
      saldo: { sentit: -2000 },
      tasmaa: true,
    });
    const [asiakas, pilvi, omistaja] = tulos.rivit;
    expect(asiakas).toMatchObject({ nro: 1, tila: 'joKirjattu', kirjattu: true });
    expect(asiakas?.kirjattuTunniste).toMatch(/^2026-\d+$/);
    expect(pilvi).toMatchObject({ tila: 'kuittiPuuttuu', kirjattu: false, luonnos: null });
    expect(pilvi?.ehdotus).toMatchObject({ tili: 4000, otsikko: 'Pilvipalvelu helmikuu 2026' });
    expect(omistaja).toMatchObject({ tila: 'omaPaaoma', kirjattu: false });
    expect(tulos.lukumaarat).toMatchObject({ joKirjattu: 1, kuittiPuuttuu: 1, omaPaaoma: 1 });
    expect(tulos.luonnokset).toBeNull();
    const luonnokset = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(luonnokset.map((t) => t.otsikko)).toEqual(['Puhelinlasku']); // fixture draft only
  });

  it('reports a statement that does not add up and an opening balance that differs', async () => {
    const { client } = await kirja();
    const tulos = (await tiliote.suorita(
      client,
      { tiliote: { ...TILIOTE, alkusaldo: 0, loppusaldo: -20000 } },
      env,
    )) as Tulos;
    expect(tulos.saldot).toMatchObject({ tasmaa: false, erotus: { sentit: 2000 } });
    expect(tulos.kirjanpito).toMatchObject({ tasmaa: false });
  });

  it('--luonnokset drafts the unbooked rows like the desktop view and logs the agent', async () => {
    const { client, storage } = await kirja('agentti:testi');
    const tulos = (await tiliote.suorita(
      client,
      { tiliote: TILIOTE, luonnokset: true },
      env,
    )) as Tulos;
    // only the cloud bill: the booked sale is skipped, the owner's withdrawal is never auto-drafted
    expect(tulos.luonnokset).toHaveLength(1);
    const id = tulos.rivit[1]?.luonnos as number;
    expect(tulos.luonnokset).toEqual([id]);
    expect(tulos.rivit[0]?.luonnos).toBeNull();
    expect(tulos.rivit[2]?.luonnos).toBeNull();

    const luonnos = await client.haeTosite(id);
    expect(luonnos).toMatchObject({ tila: TositeTila.LUONNOS, tunniste: 0, pvm: '2026-02-10' });
    expect(luonnos?.otsikko).toBe('Pilvipalvelu helmikuu 2026');
    expect(luonnos?.viennit.find((v) => v.tili === 4000)?.debet).toBe(2000);
    expect(luonnos?.viennit.find((v) => v.tili === 1900)?.kredit).toBe(2000);
    expect((await storage.getLoki(id)).at(-1)?.lahde).toBe('agentti:testi');

    // a second run sees the draft as booked and creates nothing new
    const toinen = (await tiliote.suorita(
      client,
      { tiliote: TILIOTE, luonnokset: true },
      env,
    )) as Tulos;
    expect(toinen.rivit[1]?.tila).toBe('joKirjattu');
    expect(toinen.luonnokset).toEqual([]);
  });

  it('honours an explicit bank account and refuses one missing from the chart', async () => {
    const { client } = await kirja();
    const tulos = (await tiliote.suorita(client, { tiliote: TILIOTE, tili: 3000 }, env)) as Tulos;
    expect(tulos.pankkitili.numero).toBe(3000);
    expect(tulos.rivit.every((r) => !r.kirjattu)).toBe(true);
    await expect(
      tiliote.suorita(client, { tiliote: TILIOTE, tili: 1999 }, env),
    ).rejects.toMatchObject({ koodi: 'TILIPUUTTUU' });
  });

  it('handles a Tapahtumat export without period or balances', async () => {
    const { client } = await kirja();
    const tulos = (await tiliote.suorita(
      client,
      { tiliote: { muoto: 'tapahtumat', tapahtumat: TILIOTE.tapahtumat } },
      env,
    )) as Tulos;
    expect(tulos.saldot).toBeNull();
    expect(tulos.kirjanpito).toBeNull();
    expect(tulos.rivit).toHaveLength(3);
  });

  it('is a writing tool, kept out of the assistant tool list', () => {
    expect(tiliote.kirjoittava).toBe(true);
    expect(lueTyokalut).not.toContain(tiliote);
  });
});
