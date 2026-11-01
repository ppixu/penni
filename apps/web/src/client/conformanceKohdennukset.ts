import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { CLIENT_CONFORMANCE_SEED, type ClientConformanceSeed } from './conformance.js';

type MakeClient = (seed: ClientConformanceSeed) => Promise<KpClient> | KpClient;

const c = (n: number) => Euro.fromCents(n);

/** Seed + tulos/yleinen -kaava, jossa on erilliset tulo-, kulu- ja tulosrivit. */
const SEED: ClientConformanceSeed = {
  ...CLIENT_CONFORMANCE_SEED,
  asetukset: {
    ...CLIENT_CONFORMANCE_SEED.asetukset,
    'tulos/yleinen': JSON.stringify({
      nimi: { fi: 'Tuloslaskelma' },
      rivit: [
        { fi: 'Tulot', L: '3' },
        { fi: 'Kulut', L: '4' },
        { fi: 'Tulos', L: '3..9 S' },
      ],
    }),
  },
};

/** Tasapainoinen tosite: tulos-/kulutili kohdennuksineen ja merkkauksineen vastaan pankkitili. */
function kohdistettu(
  tili: 3000 | 4000,
  sentit: number,
  pvm: string,
  kohdennus?: number,
  merkkaukset?: number[],
) {
  const tulo = tili === 3000;
  return {
    pvm,
    tyyppi: 200,
    sarja: '',
    tila: 100,
    viennit: [
      {
        tili: 1900,
        debet: c(tulo ? sentit : 0),
        kredit: c(tulo ? 0 : sentit),
        pvm,
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili,
        debet: c(tulo ? 0 : sentit),
        kredit: c(tulo ? sentit : 0),
        pvm,
        alvKoodi: 0,
        alvProsentti: 0,
        ...(kohdennus !== undefined ? { kohdennus } : {}),
        ...(merkkaukset !== undefined ? { merkkaukset } : {}),
      },
    ],
  };
}

/**
 * Kohdennusten, merkkausten, budjetin ja kohdennusraporttien asiakasrajapinta: jokainen KpClient
 * (suoraan moottorissa, HTTP:n yli, pilven yli) ajaa nämä samat tapaukset.
 */
export function runKohdennusClientConformance(name: string, makeClient: MakeClient): void {
  describe(`KpClient kohdennus conformance: ${name}`, () => {
    const fresh = () => makeClient(SEED);

    it('kohdennus kiertää: luonti, lista lkm:ineen, päivitys, init, poisto', async () => {
      const k = await fresh();
      const kp = await k.tallennaKohdennus({
        tyyppi: 1,
        nimi: { fi: 'Nuorisotoiminta' },
        alkaa: '2026-01-01',
      });
      expect(kp.id).toBeGreaterThanOrEqual(1);
      const projekti = await k.tallennaKohdennus({
        tyyppi: 2,
        kuuluu: kp.id,
        nimi: { fi: 'Kesäleiri' },
      });
      expect(projekti.kuuluu).toBe(kp.id);

      expect(await k.haeKohdennukset()).toEqual([
        { ...kp, lkm: 0 },
        { ...projekti, lkm: 0 },
      ]);

      await k.luoTosite(kohdistettu(4000, 5000, '2026-06-01', projekti.id));
      const lista = await k.haeKohdennukset();
      expect(lista.find((x) => x.id === projekti.id)?.lkm).toBe(1);
      expect(lista.find((x) => x.id === kp.id)?.lkm).toBe(0);

      const paivitetty = await k.tallennaKohdennus({ ...kp, nimi: { fi: 'Nuoriso' } });
      expect(paivitetty.id).toBe(kp.id);
      expect(paivitetty.alkaa).toBe('2026-01-01');
      const init = await k.haeInit();
      expect(init.kohdennukset.map((x) => [x.id, x.nimi.fi])).toEqual([
        [kp.id, 'Nuoriso'],
        [projekti.id, 'Kesäleiri'],
      ]);
    });

    it('kohdennuksen poisto estetään koodilla KOHDENNUSKAYTOSSA / KOHDENNUSPROJEKTEJA', async () => {
      const k = await fresh();
      const kp = await k.tallennaKohdennus({ tyyppi: 1, nimi: { fi: 'Kerhotalo' } });
      const projekti = await k.tallennaKohdennus({
        tyyppi: 2,
        kuuluu: kp.id,
        nimi: { fi: 'Remontti' },
      });
      await expect(k.poistaKohdennus(kp.id)).rejects.toMatchObject({
        code: 'KOHDENNUSPROJEKTEJA',
      });
      await k.luoTosite(kohdistettu(4000, 1000, '2026-06-01', projekti.id));
      await expect(k.poistaKohdennus(projekti.id)).rejects.toMatchObject({
        code: 'KOHDENNUSKAYTOSSA',
      });
      expect(await k.haeKohdennukset()).toHaveLength(2);

      const vapaa = await k.tallennaKohdennus({ tyyppi: 3, nimi: { fi: 'Avustus' } });
      await k.poistaKohdennus(vapaa.id);
      expect((await k.haeKohdennukset()).map((x) => x.id)).not.toContain(vapaa.id);
    });

    it('kohdennuksen validointivirhe kulkee koodilla', async () => {
      const k = await fresh();
      await expect(k.tallennaKohdennus({ tyyppi: 1, nimi: { fi: '  ' } })).rejects.toMatchObject({
        code: 'KOHDENNUSNIMI',
      });
    });

    it('merkkaukset kiertävät tositteen viennillä (nouseva, tyhjä jätetään pois)', async () => {
      const k = await fresh();
      const a = await k.tallennaKohdennus({ tyyppi: 3, nimi: { fi: 'Avustus' } });
      const b = await k.tallennaKohdennus({ tyyppi: 3, nimi: { fi: 'Messut' } });
      const t = await k.luoTosite(kohdistettu(3000, 2500, '2026-06-01', undefined, [b.id, a.id]));
      const haettu = await k.haeTosite(t.id);
      const tulo = haettu?.viennit.find((v) => v.tili === 3000);
      expect(tulo?.merkkaukset).toEqual([a.id, b.id]);
      expect(haettu?.viennit.find((v) => v.tili === 1900)).not.toHaveProperty('merkkaukset');

      const tyhja = await k.luoTosite(kohdistettu(3000, 100, '2026-06-02', undefined, []));
      const haettuTyhja = await k.haeTosite(tyhja.id);
      expect(haettuTyhja?.viennit.some((v) => 'merkkaukset' in v)).toBe(false);
      const lista = await k.haeKohdennukset();
      expect(lista.find((x) => x.id === a.id)?.lkm).toBe(1);
    });

    it('budjetti kiertää sentteinä ja korvautuu kokonaan; virheet kulkevat koodilla', async () => {
      const k = await fresh();
      const kp = await k.tallennaKohdennus({ tyyppi: 1, nimi: { fi: 'Nuorisotoiminta' } });
      expect(await k.haeBudjetti('2026-01-01')).toEqual([]);
      const rivit = [
        { kohdennus: 0, tili: 3000, sentit: c(1_000_050) },
        { kohdennus: kp.id, tili: 4000, sentit: c(-250_099) },
      ];
      await k.tallennaBudjetti('2026-01-01', rivit);
      expect(await k.haeBudjetti('2026-01-01')).toEqual(rivit);
      expect(await k.haeBudjetti('2025-01-01')).toEqual([]);

      await k.tallennaBudjetti('2026-01-01', [rivit[0] as (typeof rivit)[number]]);
      expect(await k.haeBudjetti('2026-01-01')).toEqual([rivit[0]]);

      await expect(k.tallennaBudjetti('2026-02-01', rivit)).rejects.toMatchObject({
        code: 'EITILIKAUTTA',
      });
      await expect(
        k.tallennaBudjetti('2026-01-01', [{ kohdennus: 0, tili: 1900, sentit: c(100) }]),
      ).rejects.toMatchObject({ code: 'BUDJETTITILI' });
    });

    it('laadiRaportti suodattaa kohdennuksella; kohdennusraportti ja budjettivertailu toimivat', async () => {
      const k = await fresh();
      const kp = await k.tallennaKohdennus({ tyyppi: 1, nimi: { fi: 'Nuorisotoiminta' } });
      const projekti = await k.tallennaKohdennus({
        tyyppi: 2,
        kuuluu: kp.id,
        nimi: { fi: 'Kesäleiri' },
      });
      await k.luoTosite(kohdistettu(3000, 10_000, '2026-03-01')); // kohdentamaton
      await k.luoTosite(kohdistettu(3000, 40_000, '2026-03-02', kp.id));
      await k.luoTosite(kohdistettu(4000, 7_000, '2026-03-03', projekti.id));

      const p = { muoto: 'tulos/yleinen', alkupvm: '2026-01-01', pvm: '2026-12-31' };
      const tulos = (rivit: { teksti: string; arvo: unknown }[]) =>
        rivit.find((r) => r.teksti === 'Tulos')?.arvo;

      expect(tulos(await k.laadiRaportti(p))).toBe(43_000);
      expect(tulos(await k.laadiRaportti({ ...p, kohdennus: kp.id }))).toBe(33_000);
      expect(tulos(await k.laadiRaportti({ ...p, kohdennus: 0 }))).toBe(10_000);
      expect(tulos(await k.laadiRaportti({ ...p, kohdennus: projekti.id }))).toBe(-7_000);

      const osiot = await k.laadiKohdennusRaportti({ ...p, laji: 'kustannuspaikat' });
      expect(osiot.map((o) => [o.kohdennus.id, o.kohdennus.polku, tulos(o.rivit)])).toEqual([
        [0, 'Yleinen', 10_000],
        [kp.id, 'Nuorisotoiminta', 33_000],
      ]);
      const projektit = await k.laadiKohdennusRaportti({
        ...p,
        laji: 'projektit',
        kustannuspaikka: kp.id,
      });
      expect(projektit.map((o) => [o.kohdennus.polku, tulos(o.rivit)])).toEqual([
        ['Nuorisotoiminta/Kesäleiri', -7_000],
      ]);

      await k.tallennaBudjetti('2026-01-01', [
        { kohdennus: kp.id, tili: 3000, sentit: c(100_000) },
        { kohdennus: projekti.id, tili: 4000, sentit: c(-20_000) },
      ]);
      const vertailu = await k.laadiBudjettivertailu({
        muoto: 'tulos/yleinen',
        tilikausi: '2026-01-01',
        kohdennus: kp.id,
      });
      const tulot = vertailu.find((r) => r.teksti === 'Tulot');
      expect(tulot).toMatchObject({
        budjetti: 100_000,
        toteutunut: 40_000,
        ero: -60_000,
        prosentti: 4000,
      });
      const tuloksenRivi = vertailu.find((r) => r.teksti === 'Tulos');
      expect(tuloksenRivi).toMatchObject({ budjetti: 80_000, toteutunut: 33_000, ero: -47_000 });
      await expect(
        k.laadiBudjettivertailu({ muoto: 'tulos/ei-ole', tilikausi: '2026-01-01' }),
      ).rejects.toMatchObject({ code: 'EIRAPORTTIA' });
      await expect(
        k.laadiBudjettivertailu({ muoto: 'tulos/yleinen', tilikausi: '2026-02-01' }),
      ).rejects.toMatchObject({ code: 'EITILIKAUTTA' });
    });
  });
}
