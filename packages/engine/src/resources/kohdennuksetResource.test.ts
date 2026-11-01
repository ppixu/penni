import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { KohdennusTyyppi } from '../kohdennukset/kohdennus.js';
import {
  haeBudjetti,
  haeKohdennukset,
  poistaKohdennus,
  tallennaBudjetti,
  tallennaKohdennus,
} from './kohdennuksetResource.js';
import { tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };
const seed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {},
};
const { KUSTANNUSPAIKKA, PROJEKTI, MERKKAUS } = KohdennusTyyppi;

describe('tallennaKohdennus', () => {
  it('normalisoi ennen tallennusta', async () => {
    const s = createMemoryStorage(seed);
    const k = await tallennaKohdennus(s, {
      tyyppi: KUSTANNUSPAIKKA,
      kuuluu: 5,
      nimi: { fi: '  Nuorisotoiminta ' },
    });
    expect(k).toEqual({ id: k.id, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta' } });
  });

  it('tarkistaa projektin vanhemman tallennetuista kohdennuksista', async () => {
    const s = createMemoryStorage(seed);
    const kp = await tallennaKohdennus(s, { tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'K' } });
    await expect(
      tallennaKohdennus(s, { tyyppi: PROJEKTI, kuuluu: kp.id + 1, nimi: { fi: 'P' } }),
    ).rejects.toMatchObject({ code: 'KOHDENNUSKUULUU' });
    const p = await tallennaKohdennus(s, { tyyppi: PROJEKTI, kuuluu: kp.id, nimi: { fi: 'P' } });
    expect(p.kuuluu).toBe(kp.id);
    await expect(
      tallennaKohdennus(s, { tyyppi: MERKKAUS, nimi: { fi: ' ' } }),
    ).rejects.toMatchObject({ code: 'KOHDENNUSNIMI' });
  });
});

describe('tallennaKohdennus: tyypin vaihto', () => {
  it('projekteja omaavan kustannuspaikan tyyppiä ei voi vaihtaa', async () => {
    const s = createMemoryStorage(seed);
    const kp = await tallennaKohdennus(s, { tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'K' } });
    const p = await tallennaKohdennus(s, { tyyppi: PROJEKTI, kuuluu: kp.id, nimi: { fi: 'P' } });
    await expect(
      tallennaKohdennus(s, { id: kp.id, tyyppi: MERKKAUS, nimi: { fi: 'K' } }),
    ).rejects.toMatchObject({ code: 'KOHDENNUSTYYPPI' });
    await expect(
      tallennaKohdennus(s, { id: kp.id, tyyppi: PROJEKTI, kuuluu: kp.id, nimi: { fi: 'K' } }),
    ).rejects.toMatchObject({ code: 'KOHDENNUSTYYPPI' });
    await expect(
      tallennaKohdennus(s, { id: 0, tyyppi: MERKKAUS, nimi: { fi: 'Yleinen' } }),
    ).rejects.toMatchObject({ code: 'KOHDENNUSID' });
    await poistaKohdennus(s, p.id);
    const m = await tallennaKohdennus(s, { id: kp.id, tyyppi: MERKKAUS, nimi: { fi: 'K' } });
    expect(m.tyyppi).toBe(MERKKAUS);
  });
});

describe('haeKohdennukset', () => {
  it('liittää käyttömäärän (kohdennus + merkkaukset), käyttämätön = 0', async () => {
    const s = createMemoryStorage(seed);
    const kp = await tallennaKohdennus(s, { tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'K' } });
    const m = await tallennaKohdennus(s, { tyyppi: MERKKAUS, nimi: { fi: 'M' } });
    const vapaa = await tallennaKohdennus(s, { tyyppi: MERKKAUS, nimi: { fi: 'Vapaa' } });
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-01',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(100),
            kredit: c(0),
            pvm: '2026-06-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: c(0),
            kredit: c(100),
            pvm: '2026-06-01',
            alvKoodi: 0,
            alvProsentti: 0,
            kohdennus: kp.id,
            merkkaukset: [m.id],
          },
        ],
      },
      env,
    );
    const lista = await haeKohdennukset(s);
    expect(lista.map((k) => [k.id, k.lkm])).toEqual([
      [kp.id, 1],
      [m.id, 1],
      [vapaa.id, 0],
    ]);
  });
});

describe('poistaKohdennus', () => {
  it('poistaa käyttämättömän kohdennuksen budjettiriveineen', async () => {
    const s = createMemoryStorage(seed);
    const kp = await tallennaKohdennus(s, { tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'K' } });
    await tallennaBudjetti(s, '2026-01-01', [
      { kohdennus: kp.id, tili: 3000, sentit: c(500) },
      { kohdennus: 0, tili: 3000, sentit: c(700) },
    ]);
    await poistaKohdennus(s, kp.id);
    expect(await haeKohdennukset(s)).toEqual([]);
    expect(await haeBudjetti(s, '2026-01-01')).toEqual([{ kohdennus: 0, tili: 3000, sentit: 700 }]);
  });
});

describe('tallennaBudjetti', () => {
  it('EITILIKAUTTA kun tilikautta ei ole', async () => {
    const s = createMemoryStorage(seed);
    await expect(
      tallennaBudjetti(s, '2027-01-01', [{ kohdennus: 0, tili: 3000, sentit: c(1) }]),
    ).rejects.toMatchObject({ code: 'EITILIKAUTTA' });
  });

  it('tarkistaa rivit ennen tallennusta', async () => {
    const s = createMemoryStorage(seed);
    const m = await tallennaKohdennus(s, { tyyppi: MERKKAUS, nimi: { fi: 'M' } });
    await expect(
      tallennaBudjetti(s, '2026-01-01', [{ kohdennus: 0, tili: 1900, sentit: c(1) }]),
    ).rejects.toMatchObject({ code: 'BUDJETTITILI' });
    await expect(
      tallennaBudjetti(s, '2026-01-01', [{ kohdennus: m.id, tili: 3000, sentit: c(1) }]),
    ).rejects.toMatchObject({ code: 'BUDJETTIKOHDENNUS' });
    await expect(
      tallennaBudjetti(s, '2026-01-01', [
        { kohdennus: 0, tili: 3000, sentit: c(1) },
        { kohdennus: 0, tili: 3000, sentit: c(2) },
      ]),
    ).rejects.toMatchObject({ code: 'BUDJETTIDUPLIKAATTI' });
    expect(await haeBudjetti(s, '2026-01-01')).toEqual([]);
  });

  it('tallentaa kelvollisen budjetin lukitullekin kaudelle', async () => {
    const s = createMemoryStorage({ ...seed, asetukset: { TilitPaatetty: '2026-12-31' } });
    await tallennaBudjetti(s, '2026-01-01', [
      { kohdennus: 0, tili: 4000, sentit: c(-300) },
      { kohdennus: 0, tili: 3000, sentit: c(900) },
    ]);
    expect(await haeBudjetti(s, '2026-01-01')).toEqual([
      { kohdennus: 0, tili: 3000, sentit: 900 },
      { kohdennus: 0, tili: 4000, sentit: -300 },
    ]);
  });
});
