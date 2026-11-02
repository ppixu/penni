import { laskeSha } from '@/liitteet/laskeSha';
import {
  PALKAT_ASETUKSET,
  TYONTEKIJA_A,
  TYONTEKIJA_B,
  luonnosA,
  palkkaSiemen,
} from '@/test/palkkaFikstuuri';
import { InProcessClient } from '@penni/asiakas';
import { type StoredTosite, TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { deliveryId, sha256Hex } from '@penni/palkat';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { PalkkaAjoVirhe, palkkaAjotTositteista, vuodenAlusta } from './palkkaAjoTiedot';
import { palkkalaskelmat, palkkatietoilmoitus } from './palkkaAjonTiedostot';
import { laskeAjo, merkitseLahetetyksi, tallennaPalkkaAjo } from './tallennaPalkkaAjo';

const NYT = '2026-11-01T08:00:00.000Z';
const NYT2 = '2026-11-02T09:30:00.000Z';
const c = (n: number) => n as Cents;

function kirja(asetukset: Record<string, string> = {}) {
  const storage = createMemoryStorage(palkkaSiemen(asetukset));
  const client = new InProcessClient(storage, () => '2026-11-01T00:00:00.000Z');
  return { storage, client };
}

const summa = (t: StoredTosite, puoli: 'debet' | 'kredit') =>
  t.viennit.reduce((a, v) => a + v[puoli], 0);

describe('tallennaPalkkaAjo', () => {
  it('tapaus A: yksi kirjattu Palkka-tosite, OmaVero-erä EP- ja SB-riveillä', async () => {
    const { storage, client } = kirja();
    const t = await tallennaPalkkaAjo(client, luonnosA(), undefined, () => NYT);

    expect(t.tila).toBeGreaterThanOrEqual(100);
    expect(t.tyyppi).toBe(TositeTyyppi.PALKKA);
    expect(t.sarja).toBe('P');
    expect(t.tunniste).toBe(1);
    expect(t.pvm).toBe('2026-10-31');
    expect(t.otsikko).toBe('Palkat 10/2026');
    expect(summa(t, 'debet')).toBe(summa(t, 'kredit'));

    const omaVero = t.viennit.filter((v) => v.tili === 2920);
    expect(omaVero.map((v) => v.kredit).sort()).toEqual([5768, 60_400]);
    expect(omaVero.every((v) => v.era === t.id)).toBe(true);
    expect(t.viennit.filter((v) => v.tili !== 2920).every((v) => v.era === undefined)).toBe(true);

    const erat = await storage.queryErat({});
    expect(erat.get(t.id)).toBe(-(60_400 + 5768));

    expect(t.palkka?.laskettu).toBe(NYT);
    expect(t.palkka?.henkilot[0]?.tulos.nettopalkka).toBe(220_366);
    expect(JSON.stringify(t)).not.toContain(TYONTEKIJA_A.hetu);
    expect(JSON.stringify(t)).not.toContain(TYONTEKIJA_A.iban);
    expect(await client.haeLiitteet(t.id)).toHaveLength(0);
  });

  it('muokkaus pitää saman tositteen, numeron ja erän ja päivittää laskenta-ajan', async () => {
    const { storage, client } = kirja();
    const eka = await tallennaPalkkaAjo(client, luonnosA(), undefined, () => NYT);
    const l = luonnosA();
    l.syotteet[0]?.rivit.push({ laji: 'lisa', selite: 'Kertaluonteinen lisä', summa: c(10_000) });
    const toka = await tallennaPalkkaAjo(client, l, eka.id, () => NYT2);

    expect(toka.id).toBe(eka.id);
    expect(toka.tunniste).toBe(eka.tunniste);
    expect(toka.palkka?.laskettu).toBe(NYT2);
    expect(toka.palkka?.henkilot[0]?.tulos.rahapalkka).toBe(310_000);
    expect(toka.viennit.filter((v) => v.tili === 2920).every((v) => v.era === eka.id)).toBe(true);
    // 3 120,00 × 20 % = 624,00 ja sava 3 120,00 × 1,91 % = 59,592 -> 59,59
    expect((await storage.queryErat({})).get(eka.id)).toBe(-(62_400 + 5959));
    expect(await client.listaaTositteet({})).toHaveLength(1);
  });

  it('merkitse lähetetyksi: tiiviste ladatusta XML:stä, palkkalaskelmat liitteiksi, sen jälkeen vain luku', async () => {
    const { client } = kirja();
    const l = luonnosA();
    l.syotteet.push({
      tyontekijaId: TYONTEKIJA_B.id,
      rivit: [{ laji: 'kuukausipalkka', selite: 'Palkka 10/2026', summa: c(200_000) }],
    });
    const t = await tallennaPalkkaAjo(client, l, undefined, () => NYT);
    const { nimi, xml } = await palkkatietoilmoitus(client, t);
    expect(nimi).toBe('palkkatietoilmoitus-2026-10-31.xml');

    await merkitseLahetetyksi(client, t.id, () => NYT2);
    const merkitty = await client.haeTosite(t.id);
    expect(merkitty?.palkka?.ilmoitus).toEqual({
      lahetetty: '2026-11-02',
      deliveryId: deliveryId(t.id, NYT),
      sha256: await sha256Hex(xml),
    });
    // Muu sisältö ennallaan
    expect(merkitty?.viennit).toEqual(t.viennit);
    expect(merkitty?.palkka?.laskettu).toBe(NYT);

    const liitteet = await client.haeLiitteet(t.id);
    expect(liitteet.map((x) => x.nimi).sort()).toEqual([
      'palkkalaskelma-kokeilija-2026-10-31.pdf',
      'palkkalaskelma-testinen-2026-10-31.pdf',
    ]);
    expect(liitteet.every((x) => x.tyyppi === 'application/pdf')).toBe(true);
    // Liitteet ovat samat tavut kuin ladattavat palkkalaskelmat
    const pdft = await palkkalaskelmat(client, t);
    const shat = await Promise.all(pdft.map((p) => laskeSha(p.pdf)));
    expect(liitteet.map((x) => x.sha).sort()).toEqual([...shat].sort());
    // XML:ää ei tallenneta liitteeksi
    expect(liitteet.some((x) => x.nimi.endsWith('.xml'))).toBe(false);

    await expect(tallennaPalkkaAjo(client, luonnosA(), t.id, () => NYT2)).rejects.toMatchObject({
      koodi: 'LAHETETTY',
    });
    await expect(merkitseLahetetyksi(client, t.id, () => NYT2)).rejects.toBeInstanceOf(
      PalkkaAjoVirhe,
    );
  });

  it('toinen palkka-ajo samalla verokortilla laskee ensimmäisen tulokertymään', async () => {
    const { client } = kirja();
    const eka = await tallennaPalkkaAjo(client, luonnosA(), undefined, () => NYT);
    const toka = await laskeAjo(client, luonnosA('2026-11-30'));
    // 3 020,00 aiemmin + 3 020,00 nyt
    expect(toka.henkilot[0]?.tulos.kertymaJalkeen).toBe(604_000);
    // Muokattava ajo ei laske itseään
    const sama = await laskeAjo(client, luonnosA(), eka.id);
    expect(sama.henkilot[0]?.tulos.kertymaJalkeen).toBe(302_000);
  });

  it('kortin aiemmin maksettu ja tulorajan ylitys: lisäprosentti ylittävälle osalle', async () => {
    const kortti = { ...TYONTEKIJA_A.verokortit[0], aiemminMaksettu: c(2_850_000) };
    const { client } = kirja({
      PalkatTyontekijat: JSON.stringify([{ ...TYONTEKIJA_A, verokortit: [kortti] }]),
    });
    const ajo = await laskeAjo(client, luonnosA());
    // tilaa 1 500,00 perusprosentilla, loput 1 520,00 lisäprosentilla
    expect(ajo.henkilot[0]?.tulos.pidatysOsat).toEqual([
      { bp: 2000, peruste: 150_000 },
      { bp: 4000, peruste: 152_000 },
    ]);
  });

  it('negatiivista nettopalkkaa ei tallenneta', async () => {
    const { client } = kirja();
    const l = luonnosA();
    l.syotteet = [
      { tyontekijaId: TYONTEKIJA_A.id, rivit: [{ laji: 'puhelinetu', selite: 'Puhelinetu' }] },
    ];
    await expect(tallennaPalkkaAjo(client, l, undefined, () => NYT)).rejects.toMatchObject({
      koodi: 'NEGATIIVINEN',
    });
    expect(await client.listaaTositteet({})).toHaveLength(0);
  });

  it('ilman nettopalkkojen maksutiliä ei tallenneta', async () => {
    const { client } = kirja({ LaskuMaksutili: '' });
    await expect(tallennaPalkkaAjo(client, luonnosA(), undefined, () => NYT)).rejects.toMatchObject(
      { koodi: 'PALKKATILIT' },
    );
    expect(await client.listaaTositteet({})).toHaveLength(0);
  });

  it('kauden alku ei saa olla lopun jälkeen', async () => {
    const { client } = kirja();
    const l = { ...luonnosA(), kausiAlkaa: '2026-11-01' };
    await expect(tallennaPalkkaAjo(client, l, undefined, () => NYT)).rejects.toMatchObject({
      koodi: 'SYOTE',
    });
  });
});

describe('palkkaAjonTiedostot', () => {
  it('XML vaatii Y-tunnuksen ja yhteyshenkilön', async () => {
    const ilmanY = kirja({ Ytunnus: '' });
    const t = await tallennaPalkkaAjo(ilmanY.client, luonnosA(), undefined, () => NYT);
    await expect(palkkatietoilmoitus(ilmanY.client, t)).rejects.toMatchObject({
      koodi: 'YTUNNUS',
    });

    const { yhteyshenkilo: _pois, ...ilmanYhteyshenkiloa } = PALKAT_ASETUKSET;
    const ilmanH = kirja({ PalkatAsetukset: JSON.stringify(ilmanYhteyshenkiloa) });
    const t2 = await tallennaPalkkaAjo(ilmanH.client, luonnosA(), undefined, () => NYT);
    await expect(palkkatietoilmoitus(ilmanH.client, t2)).rejects.toMatchObject({
      koodi: 'YHTEYSHENKILO',
    });
  });

  it('XML on deterministinen ja sisältää henkilötunnuksen vain tiedostossa', async () => {
    const { client } = kirja();
    const t = await tallennaPalkkaAjo(client, luonnosA(), undefined, () => NYT);
    const a = await palkkatietoilmoitus(client, t);
    const b = await palkkatietoilmoitus(client, t);
    expect(a.xml).toBe(b.xml);
    expect(a.xml).toContain(TYONTEKIJA_A.hetu);
    expect(a.xml).toContain(`<DeliveryId>${deliveryId(t.id, NYT)}</DeliveryId>`);
  });

  it('palkkalaskelmat: yksi PDF per henkilö', async () => {
    const { client } = kirja();
    const t = await tallennaPalkkaAjo(client, luonnosA(), undefined, () => NYT);
    const pdft = await palkkalaskelmat(client, t);
    expect(pdft.map((p) => p.nimi)).toEqual(['palkkalaskelma-testinen-2026-10-31.pdf']);
    expect(new TextDecoder().decode(pdft[0]?.pdf.slice(0, 5))).toBe('%PDF-');
  });
});

describe('vuodenAlusta', () => {
  it('kalenterivuoden aiemmat ajot maksupäivään asti + tämä maksu', async () => {
    const { client } = kirja();
    await tallennaPalkkaAjo(client, luonnosA(), undefined, () => NYT);
    const marras = await tallennaPalkkaAjo(client, luonnosA('2026-11-30'), undefined, () => NYT);
    await tallennaPalkkaAjo(client, luonnosA('2026-12-31'), undefined, () => NYT);
    const kaikki = palkkaAjotTositteista(
      await client.listaaTositteet({ tyyppi: TositeTyyppi.PALKKA }),
    );
    expect(kaikki).toHaveLength(3);
    // Edellisen vuoden ajo ei kuulu kertymään
    const viime = { ...(kaikki[0] as (typeof kaikki)[number]), id: 999, pvm: '2025-12-31' };
    const h = marras.palkka?.henkilot[0];
    if (!h) throw new Error('henkilö puuttuu');
    const tulos = vuodenAlusta(marras, h, [...kaikki, viime]);
    // brutto 2 × 3 020,00; pidätys 2 × 604,00; netto 2 × 2 203,66 (joulukuu ei mukana)
    expect(tulos).toEqual({ brutto: 604_000, ennakonpidatys: 120_800, netto: 440_732 });
  });
});
