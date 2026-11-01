import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { BudjettiRivi } from '../kohdennukset/budjetti.js';
import { type Kohdennus, KohdennusTyyppi } from '../kohdennukset/kohdennus.js';
import { TositeTila } from '../vouchers/enums.js';
import type { Tosite, TositeVienti } from '../vouchers/types.js';
// Syklinen import conformance.ts:n kanssa: turvallinen vain, koska seed luetaan kutsuhetkellä.
import { CONFORMANCE_SEED, type ConformanceSeed } from './conformance.js';
import { poistaKohdennus, tallennaKohdennus } from './kohdennuksetResource.js';
import { laadiKohdennusRaportti } from './kohdennusRaportit.js';
import { poistaTili, poistaTilikausi } from './masterData.js';
import { laadiRaportti } from './raportti.js';
import type { ResourceEnv, Storage } from './storage.js';
import { poistaTosite, tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env: ResourceEnv = { aika: '2026-06-01T00:00:00.000Z' };
const { KUSTANNUSPAIKKA, PROJEKTI, MERKKAUS } = KohdennusTyyppi;

/** Tasapainoinen tosite: tulos-/kulutili kohdennuksineen ja merkkauksineen vastaan pankkitili. */
function kohdistettu(
  tili: 3000 | 4000,
  maara: number,
  kohdennus?: number,
  merkkaukset?: number[],
  pvm = '2026-06-01',
): Pick<Tosite, 'viennit'> {
  const tulos: TositeVienti = {
    tili,
    debet: c(tili === 4000 ? maara : 0),
    kredit: c(tili === 3000 ? maara : 0),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    ...(kohdennus !== undefined ? { kohdennus } : {}),
    ...(merkkaukset !== undefined ? { merkkaukset } : {}),
  };
  const pankki: TositeVienti = {
    tili: 1900,
    debet: c(tili === 3000 ? maara : 0),
    kredit: c(tili === 4000 ? maara : 0),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
  };
  return { viennit: [pankki, tulos] };
}

/** Yhdistyksen perusrakenne: kustannuspaikat 1 ja 2, projekti 4 kustannuspaikan 1 alla, merkkaus 3. */
async function perusrakenne(s: Storage): Promise<void> {
  await s.saveKohdennus({ id: 1, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Nuorisotoiminta' } });
  await s.saveKohdennus({ id: 2, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerhotalo' } });
  await s.saveKohdennus({ id: 3, tyyppi: MERKKAUS, nimi: { fi: 'Avustus' } });
  await s.saveKohdennus({ id: 4, tyyppi: PROJEKTI, kuuluu: 1, nimi: { fi: 'Kesäleiri' } });
}

const tulokset = { loppupvm: '2026-12-31', tiliAlkaen: '3' } as const;

/**
 * Kohdennusten ja budjetin tallennussopimus: jokainen Storage-adapteri ajaa nämä samat tapaukset.
 * `makeStorage(seed)` palauttaa TUOREEN, siemennetyn tallennuksen (kuten runResourceConformance).
 */
export function runKohdennusConformance(
  name: string,
  makeStorage: (seed: ConformanceSeed) => Promise<Storage> | Storage,
): void {
  const fresh = async () => makeStorage(CONFORMANCE_SEED);

  describe(`Kohdennus conformance: ${name}`, () => {
    it('kohdennus: assigned id -> get -> update keeps id; explicit id kept; next id above it', async () => {
      const s = await fresh();
      const k = await s.saveKohdennus({ tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerhotalo' } });
      expect(k.id).toBeGreaterThanOrEqual(1);
      expect(await s.getKohdennukset()).toEqual([
        { id: k.id, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Kerhotalo' } },
      ]);
      const p = await s.saveKohdennus({
        id: k.id,
        tyyppi: KUSTANNUSPAIKKA,
        nimi: { fi: 'Seurantalo' },
        alkaa: '2026-01-01',
        paattyy: '2026-12-31',
      });
      expect(p.id).toBe(k.id);
      expect(await s.getKohdennukset()).toEqual([
        {
          id: k.id,
          tyyppi: KUSTANNUSPAIKKA,
          nimi: { fi: 'Seurantalo' },
          alkaa: '2026-01-01',
          paattyy: '2026-12-31',
        },
      ]);

      const e = await s.saveKohdennus({ id: 42, tyyppi: MERKKAUS, nimi: { fi: 'Avustus' } });
      expect(e.id).toBe(42);
      const seuraava = await s.saveKohdennus({ tyyppi: MERKKAUS, nimi: { fi: 'Talkoot' } });
      expect(seuraava.id).toBeGreaterThan(42);
      expect((await s.getKohdennukset()).map((x) => x.id)).toEqual([k.id, 42, seuraava.id]);
    });

    it('kohdennus: isolated copies; extra json keys and project kuuluu round-trip', async () => {
      const s = await fresh();
      await s.saveKohdennus({
        id: 1,
        tyyppi: KUSTANNUSPAIKKA,
        nimi: { fi: 'Nuoriso', sv: 'Ungdom' },
      });
      await s.saveKohdennus({ id: 4, tyyppi: PROJEKTI, kuuluu: 1, nimi: { fi: 'Leiri' }, x: 1 });
      const eka = await s.getKohdennukset();
      const nuoriso = eka.find((k) => k.id === 1);
      if (nuoriso) nuoriso.nimi.fi = 'MUTATED';
      const toka = await s.getKohdennukset();
      expect(toka.find((k) => k.id === 1)?.nimi).toEqual({ fi: 'Nuoriso', sv: 'Ungdom' });
      expect(toka.find((k) => k.id === 4)).toEqual({
        id: 4,
        tyyppi: PROJEKTI,
        kuuluu: 1,
        nimi: { fi: 'Leiri' },
        x: 1,
      });
    });

    it('kohdennus: getInit().kohdennukset lists the saved kohdennukset', async () => {
      const s = await fresh();
      expect((await s.getInit()).kohdennukset).toEqual([]);
      await perusrakenne(s);
      const init = await s.getInit();
      expect(init.kohdennukset).toEqual(await s.getKohdennukset());
      expect(init.kohdennukset.map((k) => k.id)).toEqual([1, 2, 3, 4]);
    });

    it('merkkaukset: tallennaTosite normalises and getTosite returns them', async () => {
      const s = await fresh();
      await perusrakenne(s);
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...kohdistettu(3000, 100, 1, [2, 1]) },
        env,
      );
      const haettu = await s.getTosite(t.id);
      expect(haettu?.viennit.find((v) => v.tili === 3000)).toMatchObject({
        kohdennus: 1,
        merkkaukset: [1, 2],
      });
      expect(haettu?.viennit.find((v) => v.tili === 1900)).not.toHaveProperty('merkkaukset');
    });

    it('querySaldot: kohdennukset set (incl. 0) and merkkaus filter', async () => {
      const s = await fresh();
      await perusrakenne(s);
      const tallenna = (v: Pick<Tosite, 'viennit'>) =>
        tallennaTosite(s, { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...v }, env);
      await tallenna(kohdistettu(3000, 100)); // kohdentamaton
      await tallenna(kohdistettu(3000, 200, 1, [3])); // kustannuspaikka 1 + merkkaus 3
      await tallenna(kohdistettu(4000, 50, 4)); // projekti 4
      await tallenna(kohdistettu(3000, 1000, 2)); // kustannuspaikka 2
      await tallenna(kohdistettu(4000, 7, undefined, [3])); // vain merkkaus 3

      expect(await s.querySaldot({ ...tulokset, kohdennukset: [0] })).toEqual(
        new Map([
          [3000, -100],
          [4000, 7],
        ]),
      );
      expect(await s.querySaldot({ ...tulokset, kohdennukset: [1, 4] })).toEqual(
        new Map([
          [3000, -200],
          [4000, 50],
        ]),
      );
      expect(await s.querySaldot({ ...tulokset, merkkaus: 3 })).toEqual(
        new Map([
          [3000, -200],
          [4000, 7],
        ]),
      );
      expect(await s.querySaldot({ ...tulokset, kohdennukset: [1], merkkaus: 3 })).toEqual(
        new Map([[3000, -200]]),
      );
      expect(await s.querySaldot({ ...tulokset, kohdennukset: [] })).toEqual(new Map());
      // Pankkitilin viennit ovat kohdentamattomia.
      expect(
        (await s.querySaldot({ loppupvm: '2026-12-31', tili: 1900, kohdennukset: [0] })).get(1900),
      ).toBe(1243);
    });

    it('usage: drafts count but stay out of saldot; soft-deleted vouchers count nowhere; tags count', async () => {
      const s = await fresh();
      await perusrakenne(s);
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-01',
          tyyppi: 0,
          tila: TositeTila.LUONNOS,
          sarja: '',
          ...kohdistettu(3000, 100, 1),
        },
        env,
      );
      const poistettava = await tallennaTosite(
        s,
        {
          pvm: '2026-06-02',
          tyyppi: 0,
          sarja: '',
          ...kohdistettu(3000, 300, 2, [3], '2026-06-02'),
        },
        env,
      );
      await poistaTosite(s, poistettava.id, env);
      await tallennaTosite(
        s,
        { pvm: '2026-06-03', tyyppi: 0, sarja: '', ...kohdistettu(4000, 40, 4, [3], '2026-06-03') },
        env,
      );

      const kaytto = await s.laskeKohdennustenKaytto();
      expect(kaytto.get(1)).toBe(1); // luonnos
      expect(kaytto.get(2) ?? 0).toBe(0); // poistettu
      expect(kaytto.get(3)).toBe(1); // merkkausrivi (poistetun tositteen merkkaus ei)
      expect(kaytto.get(4)).toBe(1);
      expect(kaytto.has(0)).toBe(false);

      expect(await s.querySaldot({ ...tulokset, kohdennukset: [1] })).toEqual(new Map());
      expect(await s.querySaldot({ ...tulokset, kohdennukset: [2] })).toEqual(new Map());
      expect(await s.querySaldot({ ...tulokset, merkkaus: 3 })).toEqual(new Map([[4000, 40]]));
    });

    it('merkkaukset: updating a voucher to drop its tags removes them from queries and usage', async () => {
      const s = await fresh();
      await perusrakenne(s);
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...kohdistettu(3000, 100, 1, [3]) },
        env,
      );
      expect(await s.querySaldot({ ...tulokset, merkkaus: 3 })).toEqual(new Map([[3000, -100]]));
      await tallennaTosite(
        s,
        { id: t.id, pvm: '2026-06-01', tyyppi: 0, sarja: '', ...kohdistettu(3000, 100, 1) },
        env,
      );
      expect(await s.querySaldot({ ...tulokset, merkkaus: 3 })).toEqual(new Map());
      expect((await s.laskeKohdennustenKaytto()).get(3) ?? 0).toBe(0);
      expect((await s.getTosite(t.id))?.viennit.some((v) => 'merkkaukset' in v)).toBe(false);
    });

    it('budjetti: put replaces the year, drops zero rows, sorts; other years untouched', async () => {
      const s = await fresh();
      await perusrakenne(s);
      expect(await s.getBudjetti('2026-01-01')).toEqual([]);
      const r = (kohdennus: number, tili: number, sentit: number): BudjettiRivi => ({
        kohdennus,
        tili,
        sentit: c(sentit),
      });
      await s.putBudjetti('2025-01-01', [r(0, 3000, 900)]);
      await s.putBudjetti('2026-01-01', [
        r(4, 4000, -500),
        r(0, 4000, -300),
        r(1, 3000, 0),
        r(0, 3000, 1000),
      ]);
      expect(await s.getBudjetti('2026-01-01')).toEqual([
        r(0, 3000, 1000),
        r(0, 4000, -300),
        r(4, 4000, -500),
      ]);
      await s.putBudjetti('2026-01-01', [r(1, 3000, 250)]);
      expect(await s.getBudjetti('2026-01-01')).toEqual([r(1, 3000, 250)]);
      expect(await s.getBudjetti('2025-01-01')).toEqual([r(0, 3000, 900)]);
      await s.putBudjetti('2026-01-01', []);
      expect(await s.getBudjetti('2026-01-01')).toEqual([]);
    });

    it('budjetti: deleteKohdennus removes its budget rows in every year and keeps the others', async () => {
      const s = await fresh();
      await perusrakenne(s);
      await s.putBudjetti('2025-01-01', [
        { kohdennus: 1, tili: 3000, sentit: c(10) },
        { kohdennus: 2, tili: 3000, sentit: c(20) },
      ]);
      await s.putBudjetti('2026-01-01', [
        { kohdennus: 0, tili: 4000, sentit: c(-30) },
        { kohdennus: 1, tili: 4000, sentit: c(-40) },
      ]);
      await s.deleteKohdennus(1);
      expect((await s.getKohdennukset()).map((k) => k.id)).toEqual([2, 3, 4]);
      expect(await s.getBudjetti('2025-01-01')).toEqual([{ kohdennus: 2, tili: 3000, sentit: 20 }]);
      expect(await s.getBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 4000, sentit: -30 },
      ]);
    });

    it('poistaKohdennus: refuses a used kohdennus or a cost centre with projects', async () => {
      const s = await fresh();
      await perusrakenne(s);
      await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...kohdistettu(3000, 100, 2, [3]) },
        env,
      );
      await expect(poistaKohdennus(s, 2)).rejects.toMatchObject({ code: 'KOHDENNUSKAYTOSSA' });
      await expect(poistaKohdennus(s, 3)).rejects.toMatchObject({ code: 'KOHDENNUSKAYTOSSA' });
      await expect(poistaKohdennus(s, 1)).rejects.toMatchObject({ code: 'KOHDENNUSPROJEKTEJA' });
      expect((await s.getKohdennukset()).map((k) => k.id)).toEqual([1, 2, 3, 4]);
      await poistaKohdennus(s, 4); // käyttämätön projekti
      await poistaKohdennus(s, 1); // nyt ilman projekteja
      expect((await s.getKohdennukset()).map((k) => k.id)).toEqual([2, 3]);
    });

    it('laadiKohdennusRaportti sections add up', async () => {
      const layout = {
        rivit: [
          { fi: 'Tulot', L: '3' },
          { fi: 'Kulut', L: '4' },
          { fi: 'Tulos', L: '3..9 S' },
        ],
      };
      const s = await makeStorage({
        ...CONFORMANCE_SEED,
        asetukset: { ...CONFORMANCE_SEED.asetukset, 'tulos/yleinen': JSON.stringify(layout) },
      });
      await perusrakenne(s);
      await s.saveKohdennus({ id: 5, tyyppi: PROJEKTI, nimi: { fi: 'Arpajaiset' } });
      const tallenna = (v: Pick<Tosite, 'viennit'>) =>
        tallennaTosite(s, { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...v }, env);
      await tallenna(kohdistettu(3000, 100)); // kohdentamaton
      await tallenna(kohdistettu(3000, 200, 1, [3]));
      await tallenna(kohdistettu(4000, 50, 4));
      await tallenna(kohdistettu(4000, 30, 5)); // projekti Yleisen alla
      await tallenna(kohdistettu(3000, 1000, 2));
      await tallenna(kohdistettu(3000, 7, 99)); // tallentamaton kohdennus

      const p = { muoto: 'tulos/yleinen', alkupvm: '2026-01-01', pvm: '2026-12-31' };
      const osiot = await laadiKohdennusRaportti(s, env, { ...p, laji: 'kustannuspaikat' });
      const tulos = (rivit: { teksti: string; arvo: Cents | null }[]) =>
        rivit.find((r) => r.teksti === 'Tulos')?.arvo ?? 0;
      expect(osiot.map((o) => [o.kohdennus.nimi, tulos(o.rivit)])).toEqual([
        ['Yleinen', 70],
        ['Kerhotalo', 1000],
        ['Nuorisotoiminta', 150],
        ['Tuntematon kohdennus (99)', 7],
      ]);
      const kaikki = tulos(await laadiRaportti(s, env, p));
      expect(kaikki).toBe(1227);
      expect(osiot.reduce((a, o) => a + tulos(o.rivit), 0)).toBe(kaikki);

      const projektit = await laadiKohdennusRaportti(s, env, { ...p, laji: 'projektit' });
      expect(projektit.map((o) => [o.kohdennus.polku, tulos(o.rivit)])).toEqual([
        ['Arpajaiset', -30],
        ['Nuorisotoiminta/Kesäleiri', -50],
      ]);
    });

    it('saveKohdennus drops a stale lkm usage count', async () => {
      const s = await fresh();
      await perusrakenne(s);
      const [k] = await s.getKohdennukset();
      // UI tallentaa muokatun KohdennusKaytolla-olion: lkm ei saa päätyä tallennukseen.
      await tallennaKohdennus(s, { ...(k as Kohdennus), nimi: { fi: 'Nuoriso' }, lkm: 5 });
      const luettu = (await s.getKohdennukset()).find((x) => x.id === k?.id);
      expect(luettu?.nimi.fi).toBe('Nuoriso');
      expect('lkm' in (luettu ?? {})).toBe(false);
    });

    it('kohdennus: a deleted highest id is never reused', async () => {
      const s = await fresh();
      await s.saveKohdennus({ tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'A' } });
      const ylin = await s.saveKohdennus({ tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'B' } });
      await s.deleteKohdennus(ylin.id);
      const uusi = await s.saveKohdennus({ tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'C' } });
      expect(uusi.id).toBeGreaterThan(ylin.id);
      // Myös tuonnin säilyttämä eksplisiittinen id siirtää laskuria, vaikka se poistetaan.
      await s.saveKohdennus({ id: 50, tyyppi: MERKKAUS, nimi: { fi: 'D' } });
      await s.deleteKohdennus(50);
      const seuraava = await s.saveKohdennus({ tyyppi: MERKKAUS, nimi: { fi: 'E' } });
      expect(seuraava.id).toBeGreaterThan(50);
    });

    it('usage: a negative kohdennus id on a ledger row is not counted', async () => {
      const s = await fresh();
      await perusrakenne(s);
      await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...kohdistettu(3000, 100, -1) },
        env,
      );
      await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...kohdistettu(3000, 100, 2) },
        env,
      );
      expect([...(await s.laskeKohdennustenKaytto())]).toEqual([[2, 1]]);
    });

    it('poistaTili removes the account budget rows in every year; a header keeps them', async () => {
      const s = await makeStorage({
        ...CONFORMANCE_SEED,
        tilit: [...CONFORMANCE_SEED.tilit, { numero: 4000, tyyppi: 'H2', nimi: { fi: 'Kulut' } }],
      });
      await perusrakenne(s);
      await s.putBudjetti('2025-01-01', [
        { kohdennus: 0, tili: 4000, sentit: c(-10) },
        { kohdennus: 1, tili: 3000, sentit: c(20) },
      ]);
      await s.putBudjetti('2026-01-01', [
        { kohdennus: 1, tili: 4000, sentit: c(-30) },
        { kohdennus: 0, tili: 3000, sentit: c(40) },
      ]);
      await poistaTili(s, 4000, 2); // otsikko: lehtitilin budjetti säilyy
      expect(await s.getBudjetti('2026-01-01')).toHaveLength(2);
      await poistaTili(s, 4000);
      expect(await s.getBudjetti('2025-01-01')).toEqual([{ kohdennus: 1, tili: 3000, sentit: 20 }]);
      expect(await s.getBudjetti('2026-01-01')).toEqual([{ kohdennus: 0, tili: 3000, sentit: 40 }]);
    });

    it('poistaTilikausi clears the year budget and keeps the other years', async () => {
      const s = await fresh();
      await perusrakenne(s);
      await s.putBudjetti('2025-01-01', [{ kohdennus: 0, tili: 3000, sentit: c(10) }]);
      await s.putBudjetti('2026-01-01', [{ kohdennus: 1, tili: 4000, sentit: c(-20) }]);
      await poistaTilikausi(s, '2026-01-01');
      expect(await s.getBudjetti('2026-01-01')).toEqual([]);
      expect(await s.getBudjetti('2025-01-01')).toEqual([{ kohdennus: 0, tili: 3000, sentit: 10 }]);
      // Samalle päivälle luotu uusi kausi alkaa tyhjällä budjetilla.
      await s.putTilikausi('2026-01-01', { alkaa: '2026-01-01', loppuu: '2026-12-31' });
      expect(await s.getBudjetti('2026-01-01')).toEqual([]);
    });

    it('tallennaKohdennus refuses a type change while the kohdennus has budget rows', async () => {
      const s = await fresh();
      await perusrakenne(s);
      await s.putBudjetti('2025-01-01', [{ kohdennus: 2, tili: 3000, sentit: c(10) }]);
      await expect(
        tallennaKohdennus(s, { id: 2, tyyppi: MERKKAUS, nimi: { fi: 'Kerhotalo' } }),
      ).rejects.toMatchObject({ code: 'KOHDENNUSTYYPPI' });
      await expect(
        tallennaKohdennus(s, { id: 2, tyyppi: PROJEKTI, nimi: { fi: 'Kerhotalo' } }),
      ).rejects.toMatchObject({ code: 'KOHDENNUSTYYPPI' });
      // Nimen vaihto ilman tyypin vaihtoa onnistuu.
      await tallennaKohdennus(s, { id: 2, tyyppi: KUSTANNUSPAIKKA, nimi: { fi: 'Seurantalo' } });
      expect((await s.getKohdennukset()).find((k) => k.id === 2)?.tyyppi).toBe(KUSTANNUSPAIKKA);
      await s.putBudjetti('2025-01-01', []);
      const m = await tallennaKohdennus(s, { id: 2, tyyppi: MERKKAUS, nimi: { fi: 'Seurantalo' } });
      expect(m.tyyppi).toBe(MERKKAUS);
    });
  });
}
