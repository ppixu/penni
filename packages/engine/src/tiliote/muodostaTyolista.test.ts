import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { lataaKartta } from '../accounts/tili.js';
import { haeKumppanit } from '../resources/masterData.js';
import { haeSaldot } from '../resources/saldot.js';
import type { Storage } from '../resources/storage.js';
import { listaaTositteet, tallennaTosite } from '../resources/tositeResource.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import {
  type TyolistaLahde,
  muodostaTyolista,
  tasmayksenPankkitili,
  tyolistanPvmVali,
  tyolistanTositeAsetukset,
} from './muodostaTyolista.js';
import { riviTositteeksi } from './riviTositteeksi.js';
import { lueTasmaysSaannot } from './tasmaysSaannot.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-08-01T00:00:00.000Z' };
const TILIT = [
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Alv-saatava' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 7690, tyyppi: 'D', nimi: { fi: 'Atk-palvelut' } },
];
const CHART = lataaKartta(TILIT);

function lahde(storage: Storage): TyolistaLahde {
  return {
    listaaTositteet: (f) => listaaTositteet(storage, f),
    haeKumppanit: () => haeKumppanit(storage),
    haeSaldot: (p) => haeSaldot(storage, env, p),
  };
}

async function pankkiTosite(
  storage: Storage,
  pvm: string,
  maara: number,
  vastatili: number,
  otsikko: string,
  selite: string,
): Promise<void> {
  const ulos = maara < 0;
  const summa = c(Math.abs(maara));
  await tallennaTosite(
    storage,
    {
      pvm,
      tyyppi: ulos ? TositeTyyppi.MENO : TositeTyyppi.TULO,
      sarja: '',
      otsikko,
      viennit: [
        {
          tili: vastatili,
          debet: ulos ? summa : c(0),
          kredit: ulos ? c(0) : summa,
          pvm,
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 1910,
          debet: ulos ? c(0) : summa,
          kredit: ulos ? summa : c(0),
          pvm,
          alvKoodi: 0,
          alvProsentti: 0,
          selite,
        },
      ],
    },
    env,
  );
}

async function kirja(): Promise<Storage> {
  const storage = createMemoryStorage({
    tilit: TILIT,
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { Nimi: 'Meikäläinen Matti', AlvVelvollinen: 'true' },
  });
  // Opening balance 480,00 € before July, and history: last month's cloud bill.
  await pankkiTosite(storage, '2026-06-01', 50000, 3000, 'Myynti kesäkuu', 'ASIAKAS OY');
  await pankkiTosite(
    storage,
    '2026-06-03',
    -2000,
    7690,
    'Pilvipalvelu kesäkuu 2026',
    'PILVIPALVELU',
  );
  // Already booked in July: the 1,240.00 € payment, booked one day off the bank date.
  await pankkiTosite(storage, '2026-07-04', 124000, 3000, 'Myynti heinäkuu', 'ASIAKAS OY');
  return storage;
}

const TILIOTE = {
  kausi: { alkaa: '2026-07-01', loppuu: '2026-07-31' },
  alkusaldo: c(48000),
  tapahtumat: [
    { pvm: '2026-07-03', nimi: 'PILVIPALVELU', maara: c(-2000) },
    { pvm: '2026-07-03', nimi: 'ASIAKAS OY', maara: c(124000) },
    { pvm: '2026-07-15', nimi: 'MEIKÄLÄINEN MATTI', maara: c(-30000) },
  ],
};

describe('muodostaTyolista', () => {
  it('marks booked rows, suggests from history, and compares the opening balance', async () => {
    const storage = await kirja();
    const tulos = await muodostaTyolista(lahde(storage), TILIOTE, [], {
      pankkitili: 1910,
      chart: CHART,
      saannot: lueTasmaysSaannot((await storage.getAsetukset()) as Record<string, string>),
    });
    const [pilvi, asiakas, omistaja] = tulos.rivit;
    expect(asiakas).toMatchObject({ tila: 'joKirjattu', valittu: false });
    expect(asiakas?.kirjattuTunniste).toMatch(/^2026-\d+$/);
    expect(pilvi).toMatchObject({ tila: 'kuittiPuuttuu', valittu: true, tili: 7690 });
    expect(pilvi?.ehdotus).toMatchObject({ tili: 7690, otsikko: 'Pilvipalvelu heinäkuu 2026' });
    expect(omistaja).toMatchObject({ tila: 'omaPaaoma', valittu: false });
    // the book's bank balance on 30.6. equals the statement's opening balance
    expect(tulos.kirjanpidonAlkusaldo).toBe(TILIOTE.alkusaldo);
    expect(tulos.kuititIlmanTapahtumaa).toEqual([]);
  });

  it('counts a draft as already booked, so a half-booked batch is not drafted twice', async () => {
    const storage = await kirja();
    const tulos1 = await muodostaTyolista(lahde(storage), TILIOTE, [], {
      pankkitili: 1910,
      chart: CHART,
      saannot: lueTasmaysSaannot({}),
    });
    const pilvi = tulos1.rivit[0];
    if (!pilvi) throw new Error('rivi puuttuu');
    await tallennaTosite(
      storage,
      riviTositteeksi(pilvi, CHART, tyolistanTositeAsetukset(1910, lueTasmaysSaannot({}))),
      env,
    );
    const tulos2 = await muodostaTyolista(lahde(storage), TILIOTE, [], {
      pankkitili: 1910,
      chart: CHART,
      saannot: lueTasmaysSaannot({}),
    });
    expect(tulos2.rivit[0]?.tila).toBe('joKirjattu');
    const luonnokset = await listaaTositteet(storage, { bucket: 'luonnos' });
    expect(luonnokset.every((t) => t.tila === TositeTila.LUONNOS)).toBe(true);
  });

  it('skips the opening-balance lookup for a statement without balances', async () => {
    const storage = await kirja();
    const tulos = await muodostaTyolista(lahde(storage), { tapahtumat: TILIOTE.tapahtumat }, [], {
      pankkitili: 1910,
      chart: CHART,
      saannot: lueTasmaysSaannot({}),
    });
    expect(tulos.kirjanpidonAlkusaldo).toBeUndefined();
  });
});

describe('tasmayksenPankkitili / tyolistanPvmVali', () => {
  it('prefers the stored TasmaysPankkitili, then the first bank account in the chart', () => {
    expect(tasmayksenPankkitili({ TasmaysPankkitili: '1911' }, CHART)).toBe(1911);
    expect(tasmayksenPankkitili({}, CHART)).toBe(1910);
    expect(tasmayksenPankkitili({}, [])).toBeUndefined();
  });

  it('widens the date range by the booked-match tolerance', () => {
    expect(
      tyolistanPvmVali([{ pvm: '2026-07-15' }, { pvm: '2026-07-01' }, { pvm: '2026-07-31' }]),
    ).toEqual({ alkupvm: '2026-06-29', loppupvm: '2026-08-02' });
  });
});
