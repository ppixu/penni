import { type Cents, roundHalfAway } from '@penni/euro';
import { tarkistaViite } from '@penni/validator';
import { describe, expect, it } from 'vitest';
import { generoiVeroviennit } from '../alv/generoiVeroviennit.js';
import { AlvKoodi, alvKoodilla } from '../alv/koodit.js';
import { Maksutapa, TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import type { Tosite } from '../vouchers/types.js';
import { haeAlvErittely, ryhmitteleAlvErittely } from './alvErittely.js';
import { haeAlvIlmoitus } from './alvIlmoitus.js';
import { haeAlvLaskelma, tallennaAlvTilitys } from './alvLaskelma.js';
import { haeEuMyyntiYhteenveto } from './euMyynti.js';
import { tallennaHyvityslasku } from './hyvityslaskuResource.js';
import { haeJaksotukset, tallennaJaksotukset } from './jaksotukset.js';
import { vanhennaMaksuperusteinenAlv } from './maksuperusteinenVanhennus.js';
import { kirjaaMarginaalivero } from './marginaalivero.js';
import { haeInit, paivitaAsetukset, paivitaInit, putTili } from './masterData.js';
import {
  listaaMyyntilaskut,
  tallennaMyyntilasku,
  tallennaSuoritus,
} from './myyntilaskuResource.js';
import { listaaOstolaskut, tallennaOstolasku } from './ostolaskuResource.js';
import { haePoistolaskelma, tallennaPoistot } from './poistot.js';
import { haeSaldot } from './saldot.js';
import type { ResourceEnv, Storage } from './storage.js';
import { avaaTilikausi, paataTilikausi } from './tilikausiLukitus.js';
import { luoTilinavaus } from './tilinavaus.js';
import {
  laadiTilinpaatos,
  peruVahvistus,
  tallennaLiitetiedot,
  vahvistaTilinpaatos,
} from './tilinpaatos.js';
import {
  listaaTositteet,
  muutaTositteenTila,
  poistaTosite,
  tallennaTosite,
} from './tositeResource.js';
import { listaaTulot } from './tulotResource.js';
import { haeVerolaskelma, tallennaTulovero } from './tulovero.js';

const c = (n: number): Cents => n as Cents;
const env: ResourceEnv = { aika: '2026-06-01T00:00:00.000Z' };

/** A standard seed every adapter is tested against. */
export interface ConformanceSeed {
  tilit: { numero: number; tyyppi: string; nimi: { fi: string } }[];
  tilikaudet: { alkaa: string; loppuu: string }[];
  asetukset: Record<string, string>;
}

export const CONFORMANCE_SEED: ConformanceSeed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto/tappio' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto/tappio' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Kulut' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: { AlvVelvollinen: 'true', Nimi: 'Oy Esimerkki' },
};

function bal(d: number, pvm = '2026-06-01'): Pick<Tosite, 'viennit'> {
  return {
    viennit: [
      { tili: 1900, debet: c(d), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
      { tili: 3000, debet: c(0), kredit: c(d), pvm, alvKoodi: 0, alvProsentti: 0 },
    ],
  };
}

/**
 * Run the resource-engine conformance suite against a Storage factory.
 * `makeStorage(seed)` must return a FRESH storage seeded with the given chart/years/settings.
 */
export function runResourceConformance(
  name: string,
  makeStorage: (seed: ConformanceSeed) => Promise<Storage> | Storage,
): void {
  const fresh = async () => makeStorage(CONFORMANCE_SEED);

  describe(`Storage conformance: ${name}`, () => {
    it('numbers vouchers gaplessly per series, restarting each fiscal year', async () => {
      const s = await fresh();
      const a = await tallennaTosite(
        s,
        { pvm: '2026-02-01', tyyppi: 0, sarja: '', ...bal(100, '2026-02-01') },
        env,
      );
      const b = await tallennaTosite(
        s,
        { pvm: '2026-03-01', tyyppi: 0, sarja: '', ...bal(100, '2026-03-01') },
        env,
      );
      const c25 = await tallennaTosite(
        s,
        { pvm: '2025-05-01', tyyppi: 0, sarja: '', ...bal(100, '2025-05-01') },
        env,
      );
      expect([a.tunniste, b.tunniste]).toEqual([1, 2]);
      expect(c25.tunniste).toBe(1); // separate year bucket
    });

    it('keeps null/empty series in its own bucket, separate from named series', async () => {
      const s = await fresh();
      const x = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      const y = await tallennaTosite(
        s,
        { pvm: '2026-06-02', tyyppi: 0, sarja: 'OL', ...bal(100, '2026-06-02') },
        env,
      );
      expect(x.tunniste).toBe(1);
      expect(y.tunniste).toBe(1);
    });

    it('drafts carry tunniste 0 and are excluded from the default list', async () => {
      const s = await fresh();
      const d = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, tila: TositeTila.LUONNOS, sarja: '', ...bal(100) },
        env,
      );
      expect(d.tunniste).toBe(0);
      expect(await listaaTositteet(s, {})).toHaveLength(0);
      expect(await listaaTositteet(s, { bucket: 'luonnos' })).toHaveLength(1);
    });

    it('rejects finalize of an unbalanced voucher but allows TILINAVAUS', async () => {
      const s = await fresh();
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
                debet: c(100),
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
      const avaus = await tallennaTosite(
        s,
        {
          pvm: '2026-06-01',
          tyyppi: TositeTyyppi.TILINAVAUS,
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
          ],
        },
        env,
      );
      expect(avaus.id).toBeGreaterThan(0);
    });

    it('enforces the period lock for any save', async () => {
      const s = await makeStorage({
        ...CONFORMANCE_SEED,
        asetukset: { ...CONFORMANCE_SEED.asetukset, TilitPaatetty: '2026-06-30' },
      });
      await expect(
        tallennaTosite(
          s,
          {
            pvm: '2026-06-15',
            tyyppi: 0,
            tila: TositeTila.LUONNOS,
            sarja: '',
            ...bal(100, '2026-06-15'),
          },
          env,
        ),
      ).rejects.toMatchObject({ code: 'PVMLUKITTU' });
    });

    it('lukittu kausi: kirjattua tositetta ei voi poistaa, demota eikä uudelleenpäivätä; luonnos ja avoin säilyvät', async () => {
      const s = await fresh();
      // Kirjaa ennen lukitusta: kirjattu 2025:lle, kirjattu 2026:lle, luonnos 2025:lle.
      const lukittava = await tallennaTosite(
        s,
        { pvm: '2025-06-01', tyyppi: 0, sarja: '', ...bal(100, '2025-06-01') },
        env,
      );
      const avoin = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100, '2026-06-01') },
        env,
      );
      const luonnos = await tallennaTosite(
        s,
        {
          pvm: '2025-07-01',
          tyyppi: 0,
          tila: TositeTila.LUONNOS,
          sarja: '',
          ...bal(100, '2025-07-01'),
        },
        env,
      );

      // Lukitse 2025 -> TilitPaatetty = 2025-12-31.
      await paataTilikausi(s, '2025-01-01');

      // Kirjattua lukitun kauden tositetta ei voi poistaa / demota / siirtää pois lukosta.
      await expect(poistaTosite(s, lukittava.id, env)).rejects.toMatchObject({
        code: 'PVMLUKITTU',
      });
      await expect(
        muutaTositteenTila(s, lukittava.id, TositeTila.LUONNOS, env),
      ).rejects.toMatchObject({ code: 'PVMLUKITTU' });
      await expect(
        tallennaTosite(
          s,
          {
            id: lukittava.id,
            tunniste: lukittava.tunniste,
            pvm: '2026-03-01',
            tyyppi: 0,
            sarja: '',
            ...bal(100, '2026-03-01'),
          },
          env,
        ),
      ).rejects.toMatchObject({ code: 'PVMLUKITTU' });

      // Avoimen kauden kirjattu tosite säilyy poistettavana.
      await poistaTosite(s, avoin.id, env);
      expect((await s.getTosite(avoin.id))?.tila).toBe(0);

      // Luonnos lukitulla kaudella (ei kirjoilla) voidaan yhä poistaa.
      await poistaTosite(s, luonnos.id, env);
      expect((await s.getTosite(luonnos.id))?.tila).toBe(0);

      // Puuttuva tosite: EITOSITETTA.
      await expect(poistaTosite(s, 99_999, env)).rejects.toMatchObject({ code: 'EITOSITETTA' });
    });

    it('lukittu kausi: kirjattua ei voi poistaa/demota/uudelleenpäivätä kun VIENTI osuu lukkoon vaikka tositepäivä ei', async () => {
      const s = await fresh();
      // Tositepäivä 2026 (auki), mutta viennit 2025 (lukitaan) — kausirajan yli kirjattu tosite.
      const t = await tallennaTosite(
        s,
        {
          pvm: '2026-01-05',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(100),
              kredit: c(0),
              pvm: '2025-12-15',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(100),
              pvm: '2025-12-15',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      await paataTilikausi(s, '2025-01-01'); // TilitPaatetty = 2025-12-31

      await expect(poistaTosite(s, t.id, env)).rejects.toMatchObject({ code: 'PVMLUKITTU' });
      await expect(muutaTositteenTila(s, t.id, TositeTila.LUONNOS, env)).rejects.toMatchObject({
        code: 'PVMLUKITTU',
      });
      await expect(
        tallennaTosite(
          s,
          {
            id: t.id,
            tunniste: t.tunniste,
            pvm: '2026-02-01',
            tyyppi: 0,
            sarja: '',
            viennit: [
              {
                tili: 1900,
                debet: c(100),
                kredit: c(0),
                pvm: '2026-02-01',
                alvKoodi: 0,
                alvProsentti: 0,
              },
              {
                tili: 3000,
                debet: c(0),
                kredit: c(100),
                pvm: '2026-02-01',
                alvKoodi: 0,
                alvProsentti: 0,
              },
            ],
          },
          env,
        ),
      ).rejects.toMatchObject({ code: 'PVMLUKITTU' });
    });

    it('finalizes a draft via state change and appends to the audit log', async () => {
      const s = await fresh();
      const d = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, tila: TositeTila.LUONNOS, sarja: '', ...bal(100) },
        env,
      );
      const f = await muutaTositteenTila(s, d.id, TositeTila.KIRJANPIDOSSA, env);
      expect(f.tunniste).toBe(1);
      const loki = await s.getLoki(d.id);
      expect(loki.length).toBeGreaterThanOrEqual(2); // create + state change
    });

    it('soft-deletes (recoverable, excluded from default list, audit-logged)', async () => {
      const s = await fresh();
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      await poistaTosite(s, t.id, env);
      expect(await listaaTositteet(s, {})).toHaveLength(0);
      expect(await listaaTositteet(s, { bucket: 'poistetut' })).toHaveLength(1);
      expect((await s.getLoki(t.id)).at(-1)?.data).toBeNull();
    });

    it('protects user-modified chart/settings rows from template re-application', async () => {
      const s = await fresh();
      await putTili(s, 1900, { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Oma pankki' } });
      await paivitaAsetukset(s, { Nimi: 'Oma Oy' });
      await paivitaInit(s, {
        asetukset: { Nimi: 'Malli Oy', Maa: 'FI' },
        tilit: [
          { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Malli pankki' } },
          { numero: 3001, tyyppi: 'CL', nimi: { fi: 'Uusi' } },
        ],
      });
      const init = await haeInit(s);
      expect(init.asetukset.Nimi).toBe('Oma Oy'); // protected
      expect(init.asetukset.Maa).toBe('FI'); // new key applied
      const t1900 = init.tilit.find((t) => Number((t as { numero: number }).numero) === 1900) as {
        nimi: { fi: string };
      };
      expect(t1900.nimi.fi).toBe('Oma pankki'); // protected
      expect(init.tilit.some((t) => Number((t as { numero: number }).numero) === 3001)).toBe(true); // new account added
    });

    it('säilyttää siemenessä annetut samannumeroiset rivit erillisinä', async () => {
      // Adapterit avaavat kartan myös seed-polulla (esim. createMemoryStorage(seed)), joka on
      // eri koodipolku kuin putTili. Tämä tapaus varmistaa ettei seedaus itsessään törmäytä
      // samannumeroisia rivejä, vaikka putTili/deleteTili olisi jo korjattu.
      const s = await makeStorage({
        ...CONFORMANCE_SEED,
        tilit: [
          ...CONFORMANCE_SEED.tilit,
          { numero: 3, tyyppi: 'H1', nimi: { fi: 'Tuloslaskelma' } },
          { numero: 3, tyyppi: 'H2', nimi: { fi: 'Myyntituotot' } },
        ],
      });
      const rivit = (await s.getChart()).filter((t) => t.numero === 3);
      expect(rivit).toHaveLength(2);
      expect(rivit.map((t) => t.otsikkotaso).sort()).toEqual([1, 2]);
    });

    it('patchInit suojaa vain muokatun (numero, taso) -rivin, ei koko numeroa', async () => {
      // Sama numero 1781 kantaa sekä tilin (taso 0) että otsikon (taso 4). Jos "muokattu" on
      // seurattu numeron eikä (numero, taso) -avaimen mukaan, käyttäjän otsikkomuokkaus suojaa
      // virheellisesti myös koskemattoman tilin — tai päinvastoin.
      const s = await makeStorage({
        ...CONFORMANCE_SEED,
        tilit: [
          ...CONFORMANCE_SEED.tilit,
          { numero: 1781, tyyppi: 'A', nimi: { fi: 'Malli tili' } },
          { numero: 1781, tyyppi: 'H4', nimi: { fi: 'Malli otsikko' } },
        ],
      });

      // Käyttäjä muokkaa VAIN otsikkoa; tili säilyy koskemattomana.
      await putTili(s, 1781, { numero: 1781, tyyppi: 'H4', nimi: { fi: 'Oma otsikko' } });

      // Mallin päivitys tarjoaa uudet arvot molemmille riveille.
      await paivitaInit(s, {
        tilit: [
          { numero: 1781, tyyppi: 'A', nimi: { fi: 'Uusi malli tili' } },
          { numero: 1781, tyyppi: 'H4', nimi: { fi: 'Uusi malli otsikko' } },
        ],
      });

      const rivit = (await s.getChart()).filter((t) => t.numero === 1781);
      expect(rivit).toHaveLength(2);
      const tili = rivit.find((t) => t.otsikkotaso === 0);
      const otsikko = rivit.find((t) => t.otsikkotaso === 4);
      expect(otsikko?.nimi.fi).toBe('Oma otsikko'); // muokattu rivi suojattu
      expect(tili?.nimi.fi).toBe('Uusi malli tili'); // muokkaamaton rivi päivittyy mallista
    });

    it('säilyttää saman numeron otsikot eri tasoilla erillisinä', async () => {
      const s = await fresh();
      await putTili(s, 3, { numero: 3, tyyppi: 'H1', nimi: { fi: 'Tuloslaskelma' } });
      await putTili(s, 3, { numero: 3, tyyppi: 'H2', nimi: { fi: 'Myyntituotot' } });

      const kartta = await s.getChart();
      const kolmoset = kartta.filter((t) => t.numero === 3);
      expect(kolmoset).toHaveLength(2);
      expect(kolmoset.map((t) => t.otsikkotaso).sort()).toEqual([1, 2]);
      expect(kolmoset.find((t) => t.otsikkotaso === 1)?.nimi.fi).toBe('Tuloslaskelma');
      expect(kolmoset.find((t) => t.otsikkotaso === 2)?.nimi.fi).toBe('Myyntituotot');
    });

    it('säilyttää saman numeron otsikot kolmella tasolla erillisinä (kitsas-source: numero 40)', async () => {
      // Todellinen kolmoiskollisio referenssikartasta (yritys.kitsaskartta): numero 40 kantaa
      // otsikot tasoilla 3, 4 JA 5 samanaikaisesti. Kaksitasoinen testi ei paljasta virhettä,
      // joka syntyy vasta kolmannella törmäävällä rivillä.
      const s = await fresh();
      await putTili(s, 40, {
        numero: 40,
        tyyppi: 'H3',
        nimi: { fi: 'Aineet, tarvikkeet ja tavarat' },
      });
      await putTili(s, 40, { numero: 40, tyyppi: 'H4', nimi: { fi: 'Ostot tilikauden aikana' } });
      await putTili(s, 40, {
        numero: 40,
        tyyppi: 'H5',
        nimi: { fi: 'Aine-, tarvike- ja tavaraostot' },
      });

      const rivit = (await s.getChart()).filter((t) => t.numero === 40);
      expect(rivit).toHaveLength(3);
      expect(rivit.map((t) => t.otsikkotaso).sort()).toEqual([3, 4, 5]);
      expect(rivit.find((t) => t.otsikkotaso === 3)?.nimi.fi).toBe('Aineet, tarvikkeet ja tavarat');
      expect(rivit.find((t) => t.otsikkotaso === 4)?.nimi.fi).toBe('Ostot tilikauden aikana');
      expect(rivit.find((t) => t.otsikkotaso === 5)?.nimi.fi).toBe(
        'Aine-, tarvike- ja tavaraostot',
      );
    });

    it('säilyttää samannumeroisen tilin ja otsikon erillisinä', async () => {
      const s = await fresh();
      await putTili(s, 1781, { numero: 1781, tyyppi: 'A', nimi: { fi: 'Osakemerkintäsaamiset' } });
      await putTili(s, 1781, {
        numero: 1781,
        tyyppi: 'H4',
        nimi: { fi: 'Maksamattomat osakkeet' },
      });

      const kartta = await s.getChart();
      const rivit = kartta.filter((t) => t.numero === 1781);
      expect(rivit).toHaveLength(2);
      // Tili EI saa kadota otsikon alle: lehtitili on yhä olemassa tasolla 0.
      const tili = rivit.find((t) => t.otsikkotaso === 0);
      expect(tili?.tyyppiKoodi).toBe('A');
      expect(tili?.nimi.fi).toBe('Osakemerkintäsaamiset');
      // Otsikko EI saa vioittua tilin rinnalla: se säilyy omalla tasollaan ehjänä.
      const otsikko = rivit.find((t) => t.otsikkotaso === 4);
      expect(otsikko?.nimi.fi).toBe('Maksamattomat osakkeet');
    });

    it('päivittää saman (numero, taso) -rivin paikallaan', async () => {
      const s = await fresh();
      // Sama numero JA sama taso molemmilla kutsuilla: tämä tapaus ei erottele numero-avainta
      // ja (numero, taso) -avainta, vaan varmistaa että päivitys ei kahdenna riviä.
      await putTili(s, 5, { numero: 5, tyyppi: 'H2', nimi: { fi: 'Vanha' } });
      await putTili(s, 5, { numero: 5, tyyppi: 'H2', nimi: { fi: 'Uusi' } });

      const rivit = (await s.getChart()).filter((t) => t.numero === 5);
      expect(rivit).toHaveLength(1);
      expect(rivit[0]?.nimi.fi).toBe('Uusi');
    });

    it('poistaa vain pyydetyn tason', async () => {
      const s = await fresh();
      await putTili(s, 26, { numero: 26, tyyppi: 'H2', nimi: { fi: 'Vieras pääoma' } });
      await putTili(s, 26, { numero: 26, tyyppi: 'H3', nimi: { fi: 'Pitkäaikainen' } });
      await s.deleteTili(26, 2);

      const rivit = (await s.getChart()).filter((t) => t.numero === 26);
      expect(rivit).toHaveLength(1);
      expect(rivit[0]?.otsikkotaso).toBe(3);
    });

    it('deleteTili ei-olemassaolevalle tasolle ei poista mitään', async () => {
      // "Avulias" toteutus, joka poistaa lähimmän löytyvän numero-osuman kun tarkkaa
      // (numero, taso) -riviä ei löydy, läpäisisi yllä olevan tapauksen. Puuttuva taso EI saa
      // pudottaa mitään olemassa olevaa riviä: no-op on oikea käytös.
      const s = await fresh();
      await putTili(s, 26, { numero: 26, tyyppi: 'H2', nimi: { fi: 'Vieras pääoma' } });
      await putTili(s, 26, { numero: 26, tyyppi: 'H3', nimi: { fi: 'Pitkäaikainen' } });
      await s.deleteTili(26, 7);

      const rivit = (await s.getChart()).filter((t) => t.numero === 26);
      expect(rivit).toHaveLength(2);
      expect(rivit.map((t) => t.otsikkotaso).sort()).toEqual([2, 3]);
    });

    it('deleteTili ilman tasoa poistaa lehtitilin, ei otsikkoa', async () => {
      const s = await fresh();
      await putTili(s, 40, { numero: 40, tyyppi: 'D', nimi: { fi: 'Ostot' } });
      await putTili(s, 40, { numero: 40, tyyppi: 'H3', nimi: { fi: 'Aineet ja tarvikkeet' } });
      await s.deleteTili(40);

      const rivit = (await s.getChart()).filter((t) => t.numero === 40);
      expect(rivit).toHaveLength(1);
      expect(rivit[0]?.otsikkotaso).toBe(3);
    });

    it('keeps an already-assigned tunniste when an edited voucher is re-finalized (same year/series)', async () => {
      const s = await fresh();
      const saved = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      expect(saved.tunniste).toBe(1);
      const muokattu = await tallennaTosite(s, { ...saved, otsikko: 'muokattu' }, env);
      expect(muokattu.tunniste).toBe(saved.tunniste); // a plain edit must NOT renumber
      expect(muokattu.id).toBe(saved.id);
    });

    it('tiliote: tiliotetositteen tiedot ja pankin saldot säilyvät blob-round-tripissä', async () => {
      const s = await fresh();
      const tiliote = {
        tili: 1900,
        alkupvm: '2026-09-01',
        loppupvm: '2026-09-30',
        iban: 'FI2112345600000785',
        alkusaldo: 123_456 as Cents,
        loppusaldo: 98_765 as Cents,
      };
      const saved = await tallennaTosite(
        s,
        { pvm: '2026-09-30', tyyppi: TositeTyyppi.TILIOTE, sarja: '', viennit: [], tiliote },
        env,
      );
      expect((await s.getTosite(saved.id))?.tiliote).toEqual(tiliote);
    });

    it('getChart returns isolated copies (mutating the result does not corrupt the store)', async () => {
      const s = await fresh();
      const first = await s.getChart();
      const acct = first.find((t) => t.numero === 1900);
      if (acct) acct.nimi.fi = 'MUTATED';
      const second = await s.getChart();
      expect(second.find((t) => t.numero === 1900)?.nimi.fi).toBe('Pankkitili');
    });

    it('a confirm-severity violation does not block finalize', async () => {
      const s = await fresh();
      // era on non-erittely account 1900 -> ERA_ILMAN_ERITTELYA (confirm), which must NOT block.
      const t = await tallennaTosite(
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
              era: 5,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(100),
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

    it('computes integer-cent balances with the asset/credit sign convention', async () => {
      const s = await fresh();
      // sell 10000 on cash, expense 4000
      await tallennaTosite(
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
            {
              tili: 3000,
              debet: c(0),
              kredit: c(10000),
              pvm: '2026-06-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      await tallennaTosite(
        s,
        {
          pvm: '2026-07-01',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 4000,
              debet: c(4000),
              kredit: c(0),
              pvm: '2026-07-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 1900,
              debet: c(0),
              kredit: c(4000),
              pvm: '2026-07-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      const saldot = await haeSaldot(s, env, { pvm: '2026-12-31' });
      expect(saldot.get(1900)).toBe(6000); // asset, debit-positive
      expect(saldot.get(3000)).toBe(10000); // income, credit-positive
      expect(saldot.get(4000)).toBe(-4000); // expense (class 4, credit-positive convention) => negative
      expect(saldot.get(2371)).toBe(6000); // KAUDENTULOS = 10000 - 4000
    });

    it('carries prior-year result into EDELLISTENTULOS', async () => {
      const s = await fresh();
      await tallennaTosite(
        s,
        {
          pvm: '2025-05-01',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(2500),
              kredit: c(0),
              pvm: '2025-05-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(2500),
              pvm: '2025-05-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      const saldot = await haeSaldot(s, env, { pvm: '2026-12-31' });
      expect(saldot.get(2251)).toBe(2500);
    });

    it('kumppani: save (auto-id) -> list -> update -> delete round-trip', async () => {
      const s = await fresh();
      const saved = await s.saveKumppani({ nimi: 'Asiakas Oy', alvtunnus: 'FI12345678' });
      expect(saved.id).toBeGreaterThan(0);
      expect(await s.getKumppanit()).toHaveLength(1);
      const paivitetty = await s.saveKumppani({ id: saved.id, nimi: 'Asiakas Oyj', kieli: 'fi' });
      expect(paivitetty.id).toBe(saved.id);
      const lista = await s.getKumppanit();
      expect(lista).toHaveLength(1);
      expect(lista[0]?.nimi).toBe('Asiakas Oyj');
      await s.deleteKumppani(saved.id);
      expect(await s.getKumppanit()).toHaveLength(0);
    });

    it('kumppani: getKumppanit returns isolated copies', async () => {
      const s = await fresh();
      const k = await s.saveKumppani({ nimi: 'Alkuperäinen' });
      const first = await s.getKumppanit();
      const found = first.find((x) => x.id === k.id);
      if (found) found.nimi = 'MUTATED';
      const second = await s.getKumppanit();
      expect(second.find((x) => x.id === k.id)?.nimi).toBe('Alkuperäinen');
    });

    it('liite: tallenna (rooliton) -> listaa -> hae blob tavulleen tarkasti -> poista', async () => {
      const s = await fresh();
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      const tavut = new Uint8Array([0x00, 0x7f, 0xff, 0x10, 0x20]);
      const tallennettu = await s.saveLiite({
        tosite: t.id,
        nimi: 'kuitti.pdf',
        tyyppi: 'application/pdf',
        luotu: '2026-06-01T00:00:00.000Z',
        data: tavut,
      });
      expect(tallennettu.id).toBeGreaterThan(0);
      expect((tallennettu as { data?: unknown }).data).toBeUndefined(); // vain metatiedot
      expect(await s.getLiitteet(t.id)).toHaveLength(1);
      const haettu = await s.getLiite(tallennettu.id);
      expect(haettu?.data).toEqual(tavut);
      expect(haettu?.nimi).toBe('kuitti.pdf');
      await s.deleteLiite(tallennettu.id);
      expect(await s.getLiitteet(t.id)).toHaveLength(0);
      expect(await s.getLiite(tallennettu.id)).toBeNull();
    });

    it('liite: tositteen päivitys säilyttää sen liitteet', async () => {
      const s = await fresh();
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      const liite = await s.saveLiite({
        tosite: t.id,
        nimi: 'kuitti.pdf',
        tyyppi: 'application/pdf',
        luotu: '2026-06-01T00:00:00.000Z',
        data: new Uint8Array([1, 2, 3]),
      });
      const paivitetty = await tallennaTosite(
        s,
        { id: t.id, pvm: '2026-06-02', tyyppi: 0, sarja: '', otsikko: 'Korjattu', ...bal(200) },
        env,
      );
      expect(paivitetty.id).toBe(t.id);
      expect(paivitetty.tunniste).toBe(t.tunniste);
      expect((await s.getLiitteet(t.id)).map((l) => l.id)).toEqual([liite.id]);
      expect((await s.getLiite(liite.id))?.data).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('liite: roolitonta sallitaan monta; nimetty rooli korvaa slotin', async () => {
      const s = await fresh();
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      const perus = { tosite: t.id, tyyppi: 'application/pdf', luotu: '2026-06-01T00:00:00.000Z' };
      await s.saveLiite({ ...perus, nimi: 'a.pdf', data: new Uint8Array([1]) });
      await s.saveLiite({ ...perus, nimi: 'b.pdf', data: new Uint8Array([2]) });
      expect(await s.getLiitteet(t.id)).toHaveLength(2); // rooliton: monta
      const l1 = await s.saveLiite({
        ...perus,
        roolinimi: 'lasku',
        nimi: 'lasku1.pdf',
        data: new Uint8Array([3]),
      });
      const l2 = await s.saveLiite({
        ...perus,
        roolinimi: 'lasku',
        nimi: 'lasku2.pdf',
        data: new Uint8Array([4]),
      });
      expect(l2.id).toBe(l1.id); // sama rooli-slotti korvattu
      expect(await s.getLiitteet(t.id)).toHaveLength(3); // 2 roolitonta + 1 nimetty
      expect((await s.getLiite(l1.id))?.nimi).toBe('lasku2.pdf');
    });

    it('liite: id annettuna korvaa rivin sellaisenaan (ei uutta riviä)', async () => {
      const s = await fresh();
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      const tallennettu = await s.saveLiite({
        tosite: t.id,
        nimi: 'v1.pdf',
        tyyppi: 'application/pdf',
        luotu: '2026-06-01T00:00:00.000Z',
        data: new Uint8Array([1, 2, 3]),
      });
      const alkuperainen = await s.getLiite(tallennettu.id);
      expect(alkuperainen?.nimi).toBe('v1.pdf');
      // Tallennetaan uudelleen samalla id:llä -> korvaa rivin, ei luo uutta
      const korvattu = await s.saveLiite({
        tosite: t.id,
        id: tallennettu.id,
        nimi: 'v2.pdf',
        tyyppi: 'application/pdf',
        luotu: '2026-06-01T00:00:00.000Z',
        data: new Uint8Array([9, 9]),
      });
      expect(korvattu.id).toBe(tallennettu.id); // sama rivi, ei uutta
      expect(await s.getLiitteet(t.id)).toHaveLength(1);
      const haettu = await s.getLiite(tallennettu.id);
      expect(haettu?.nimi).toBe('v2.pdf');
      expect(haettu?.data).toEqual(new Uint8Array([9, 9])); // tavut korvattu täsmälleen
    });

    it('liite: id annettuna jota ei ole olemassa hylätään eikä luo uutta riviä', async () => {
      const s = await fresh();
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      await expect(
        s.saveLiite({
          tosite: t.id,
          id: 999_999,
          nimi: 'olematon.pdf',
          tyyppi: 'application/pdf',
          luotu: '2026-06-01T00:00:00.000Z',
          data: new Uint8Array([1]),
        }),
      ).rejects.toMatchObject({ code: 'LIITE_EI_LOYDY' });
      expect(await s.getLiitteet(t.id)).toHaveLength(0);
    });

    it('liite: id annettuna ei saa korvata toisen rivin varaamaa (tosite, roolinimi)-slottia', async () => {
      const s = await fresh();
      const t = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      const perus = { tosite: t.id, tyyppi: 'application/pdf', luotu: '2026-06-01T00:00:00.000Z' };
      // Rivi A varaa roolin "lasku"; rivi B on eri, rooliton liite samalla tositteella.
      const a = await s.saveLiite({
        ...perus,
        roolinimi: 'lasku',
        nimi: 'lasku.pdf',
        data: new Uint8Array([1]),
      });
      const b = await s.saveLiite({ ...perus, nimi: 'muu.pdf', data: new Uint8Array([2]) });
      // B:n id:llä yritetään ottaa rooli "lasku", jonka A jo omistaa -> hylätään eikä A:ta
      // saa poistaa/korvata (tämä on juuri se datankatoa estävä varmistus).
      await expect(
        s.saveLiite({
          ...perus,
          id: b.id,
          roolinimi: 'lasku',
          nimi: 'yritys.pdf',
          data: new Uint8Array([3]),
        }),
      ).rejects.toMatchObject({ code: 'LIITE_ROOLI_VARATTU' });
      expect(await s.getLiitteet(t.id)).toHaveLength(2); // ei hävinnyt riviä
      const aJalkeen = await s.getLiite(a.id);
      expect(aJalkeen?.nimi).toBe('lasku.pdf'); // A säilyi koskemattomana
      const bJalkeen = await s.getLiite(b.id);
      expect(bJalkeen?.nimi).toBe('muu.pdf'); // B säilyi koskemattomana (ei osittaista päivitystä)
    });

    it('liite: laskeLiitteet laskee liitteet tositteittain ilman blobeja; listat kantavat liitteita-määrän', async () => {
      const s = await fresh();
      const kahdella = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        env,
      );
      const ilman = await tallennaTosite(
        s,
        { pvm: '2026-06-02', tyyppi: 0, sarja: '', ...bal(200, '2026-06-02') },
        env,
      );
      const luonnos = await tallennaTosite(
        s,
        {
          pvm: '2026-06-03',
          tyyppi: 0,
          tila: TositeTila.LUONNOS,
          sarja: '',
          ...bal(300, '2026-06-03'),
        },
        env,
      );
      const perus = { tyyppi: 'application/pdf', luotu: '2026-06-01T00:00:00.000Z' };
      await s.saveLiite({
        ...perus,
        tosite: kahdella.id,
        nimi: 'a.pdf',
        data: new Uint8Array([1]),
      });
      await s.saveLiite({
        ...perus,
        tosite: kahdella.id,
        nimi: 'b.pdf',
        data: new Uint8Array([2]),
      });
      await s.saveLiite({ ...perus, tosite: luonnos.id, nimi: 'c.pdf', data: new Uint8Array([3]) });

      const maarat = await s.laskeLiitteet();
      expect(maarat.get(kahdella.id)).toBe(2);
      expect(maarat.get(luonnos.id)).toBe(1);
      expect(maarat.has(ilman.id)).toBe(false); // liitteetön tosite puuttuu kartasta

      const kirjatut = await listaaTositteet(s, {});
      expect(kirjatut.map((t) => [t.id, t.liitteita])).toEqual([
        [kahdella.id, 2],
        [ilman.id, 0],
      ]);
      const luonnokset = await listaaTositteet(s, { bucket: 'luonnos' });
      expect(luonnokset.map((t) => [t.id, t.liitteita])).toEqual([[luonnos.id, 1]]);

      // Tulot: luonnos näkyy listalla (tila < 100) ja kantaa oman liitemääränsä.
      const tulot = await listaaTulot(s, {});
      expect(tulot.map((r) => [r.tosite, r.tila, r.liitteita])).toEqual([
        [kahdella.id, kahdella.tila, 2],
        [ilman.id, ilman.tila, 0],
        [luonnos.id, TositeTila.LUONNOS, 1],
      ]);
    });

    it('myyntilasku: LASKU posts a balanced AR/revenue/VAT voucher with numero+viite+era', async () => {
      const s = await fresh();
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } });
      await paivitaAsetukset(s, {
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
        LaskuKateistili: '1900',
      });
      const lasku = await tallennaMyyntilasku(
        s,
        {
          pvm: '2026-06-01',
          rivit: [
            { myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 },
          ],
        },
        env,
      );
      const at = (t: number) => lasku.viennit.find((v) => v.tili === t);
      expect(at(1701)?.debet).toBe(12550);
      expect(at(1701)?.era).toBeTruthy();
      expect(at(3000)?.kredit).toBe(10000);
      expect(at(2939)?.kredit).toBe(2550);
      expect(lasku.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
        lasku.viennit.reduce((a, v) => a + v.kredit, 0),
      );
      expect(lasku.numero).toBe('1');
      expect(tarkistaViite(lasku.viite as string)).toBe(true);
      expect(lasku.tunniste).toBeGreaterThanOrEqual(1);
      expect(lasku.maksutapa).toBe(Maksutapa.LASKU);
      // round-trip: the stored voucher preserves the new fields across the adapter
      const haettu = await s.getTosite(lasku.id);
      expect(haettu?.numero).toBe('1');
      expect(haettu?.rivit?.[0]?.aNetto).toBe(100);
    });

    it('myyntilasku: KATEINEN debits the cash account with no era', async () => {
      const s = await fresh();
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } });
      await paivitaAsetukset(s, {
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
        LaskuKateistili: '1900',
      });
      const lasku = await tallennaMyyntilasku(
        s,
        {
          pvm: '2026-06-01',
          maksutapa: Maksutapa.KATEINEN,
          rivit: [
            { myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 },
          ],
        },
        env,
      );
      const kassa = lasku.viennit.find((v) => v.tili === 1900);
      expect(kassa?.debet).toBe(12550);
      expect(kassa?.era).toBeUndefined();
    });

    it('myyntilasku: a zero-rated row produces no VAT leg (gross = net)', async () => {
      const s = await fresh();
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await paivitaAsetukset(s, { LaskuSaatavaTili: '1701', OletusMyyntitili: '3000' });
      const lasku = await tallennaMyyntilasku(
        s,
        {
          pvm: '2026-06-01',
          rivit: [
            {
              myyntiKpl: 1,
              aNetto: 100,
              alvKoodi: AlvKoodi.RAKENNUSPALVELU_MYYNTI,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      expect(
        lasku.viennit.some(
          (v) => v.alvKoodi === alvKoodilla(AlvKoodi.MYYNNIT_NETTO, AlvKoodi.ALVKIRJAUS),
        ),
      ).toBe(false);
      expect(lasku.viennit.find((v) => v.tili === 1701)?.debet).toBe(10000);
    });

    it('queryErat aggregates open balances per era over posted vouchers', async () => {
      const s = await fresh();
      // Voucher A: AR debit era=42 for 10000 (asset 1900), revenue credit 3000. Opens the era.
      await tallennaTosite(
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
              era: 42,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(10000),
              pvm: '2026-06-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      expect((await s.queryErat({})).get(42)).toBe(10000);

      // Partial payment: credit era=42 for 4000. Balance drops to 6000.
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-10',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 3000,
              debet: c(4000),
              kredit: c(0),
              pvm: '2026-06-10',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 1900,
              debet: c(0),
              kredit: c(4000),
              pvm: '2026-06-10',
              alvKoodi: 0,
              alvProsentti: 0,
              era: 42,
            },
          ],
        },
        env,
      );
      expect((await s.queryErat({})).get(42)).toBe(6000);

      // saldopvm before the payment shows the full balance (payment excluded by date bound).
      expect((await s.queryErat({ saldopvm: '2026-06-05' })).get(42)).toBe(10000);

      // A draft carrying the same era is NOT posted, so it never affects the balance.
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-11',
          tyyppi: 0,
          tila: TositeTila.LUONNOS,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(0),
              kredit: c(5000),
              pvm: '2026-06-11',
              alvKoodi: 0,
              alvProsentti: 0,
              era: 42,
            },
            {
              tili: 3000,
              debet: c(5000),
              kredit: c(0),
              pvm: '2026-06-11',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      expect((await s.queryErat({})).get(42)).toBe(6000); // unchanged: draft excluded

      // Viennit without an era never produce a map key (3000 legs carry no era).
      expect((await s.queryErat({})).has(3000)).toBe(false);
    });

    it('myyntilasku: list shows avoin and a suoritus settles the era', async () => {
      const s = await fresh();
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } });
      await paivitaAsetukset(s, {
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
        LaskuMaksutili: '1900',
      });
      const lasku = await tallennaMyyntilasku(
        s,
        {
          pvm: '2026-06-01',
          rivit: [
            { myyntiKpl: 1, aNetto: 100, alvKoodi: AlvKoodi.MYYNNIT_NETTO, alvProsentti: 25.5 },
          ],
        },
        env,
      );
      let lista = await listaaMyyntilaskut(s, {});
      expect(lista).toHaveLength(1);
      expect(lista[0]?.summa).toBe(12550);
      expect(lista[0]?.avoin).toBe(12550);

      await tallennaSuoritus(s, { tosite: lasku.id, pvm: '2026-06-15', summa: c(2550) }, env);
      lista = await listaaMyyntilaskut(s, {});
      expect(lista[0]?.avoin).toBe(10000);

      await tallennaSuoritus(s, { tosite: lasku.id, pvm: '2026-06-20', summa: c(10000) }, env);
      lista = await listaaMyyntilaskut(s, {});
      expect(lista[0]?.avoin).toBe(0);

      // avoin filter drops the settled invoice
      expect(await listaaMyyntilaskut(s, { avoin: true })).toHaveLength(0);
    });

    it('ostolasku: kirjaus ostovelaksi, avoin positiivinen, maksu nollaa erän (4 adapteria)', async () => {
      const s = await fresh();
      await putTili(s, 4000, { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } });
      await putTili(s, 2870, { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } });
      // OstoVelkaTili resolves via Luonne.OSTOVELKA (BO) — no setting needed.
      const lasku = await tallennaOstolasku(
        s,
        {
          pvm: '2025-03-01',
          laskupvm: '2025-03-01',
          erapvm: '2025-03-31',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
        },
        env,
      );
      expect(lasku.tyyppi).toBe(100);
      const d = lasku.viennit.reduce((a, v) => a + v.debet, 0);
      const k = lasku.viennit.reduce((a, v) => a + v.kredit, 0);
      expect(d).toBe(k);
      const lista = await listaaOstolaskut(s, {});
      expect(lista.find((r) => r.tosite === lasku.id)?.avoin).toBe(10_000);
      await tallennaSuoritus(
        s,
        { tosite: lasku.id, pvm: '2025-04-01', summa: c(10_000), rahatili: 1900 },
        env,
      );
      expect((await listaaOstolaskut(s, { avoin: true })).some((r) => r.tosite === lasku.id)).toBe(
        false,
      );
    });

    it('maksuperusteinen: myynnin ja oston alv lykätään ja kohdistetaan maksettaessa (4 adapteria)', async () => {
      const s = await fresh();
      // Myyntitilit + kohdentamaton velka (BLM) + real ALVVELKA (BL) + bank.
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } });
      await putTili(s, 2949, {
        numero: 2949,
        tyyppi: 'BLM',
        nimi: { fi: 'Kohdentamaton alv-velka' },
      });
      // Ostotilit + kohdentamaton saatava (ALM) + real ALVSAATAVA (AL).
      await putTili(s, 4000, { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } });
      await putTili(s, 2870, { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } });
      await putTili(s, 1763, { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } });
      await putTili(s, 1764, {
        numero: 1764,
        tyyppi: 'ALM',
        nimi: { fi: 'Kohdentamaton alv-saatava' },
      });
      await paivitaAsetukset(s, {
        AlvVelvollinen: 'true',
        MaksuAlvAlkaa: '2026-01-01',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        LaskuMaksutili: '1900',
        AlvVelkaTili: '2939', // real ALVVELKA-tili on validoitava vaikka maksuperusteinen ohjaa 2949:lle
      });

      // Myyntilasku 100 € + 25,5 % -> alv lykätään kohdentamattomaan (2949), ei 2939:lle.
      const myynti = await tallennaMyyntilasku(
        s,
        {
          pvm: '2026-06-01',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
        },
        env,
      );
      expect(myynti.viennit.find((v) => v.tili === 2949)?.kredit).toBe(c(2_550));
      expect(myynti.viennit.some((v) => v.tili === 2939)).toBe(false);

      // Maksu -> alv kohdistuu 2939:lle koodilla 118; kohdentamaton nollautuu.
      await tallennaSuoritus(s, { tosite: myynti.id, pvm: '2026-06-15', summa: c(12_550) }, env);
      const laskelma = await haeAlvLaskelma(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(laskelma.koodit.get(301)).toBe(c(2_550)); // recognized domestic sale VAT in the return

      // Ostolasku 100 € + 25,5 % -> vähennettävä alv lykätään kohdentamattomaan (1764).
      const osto = await tallennaOstolasku(
        s,
        {
          pvm: '2026-06-02',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 21, alvProsentti: 25.5, tili: 4000 }],
        },
        env,
      );
      expect(osto.viennit.find((v) => v.tili === 1764)?.debet).toBe(c(2_550));
      await tallennaSuoritus(
        s,
        { tosite: osto.id, pvm: '2026-06-16', summa: c(12_550), rahatili: 1900 },
        env,
      );
      const laskelma2 = await haeAlvLaskelma(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(laskelma2.koodit.get(307)).toBe(c(2_550)); // recognized deduction in the return
    });

    it('maksuperusteinen: vanhennus kirjaa yli 12 kk vanhan lykätyn myynnin veron (4 adapteria)', async () => {
      const s = await fresh();
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } });
      await putTili(s, 2949, {
        numero: 2949,
        tyyppi: 'BLM',
        nimi: { fi: 'Kohdentamaton alv-velka' },
      });
      await paivitaAsetukset(s, {
        AlvVelvollinen: 'true',
        MaksuAlvAlkaa: '2020-01-01',
        AlvVelkaTili: '2939',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        LaskuMaksutili: '1900',
      });
      const lasku = await tallennaMyyntilasku(
        s,
        {
          pvm: '2025-01-15',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
        },
        env,
      );
      // Deferred at booking: VAT in holding 2949, not real 2939.
      expect(lasku.viennit.find((v) => v.tili === 2949)?.kredit).toBe(c(2_550));

      const sweep = await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2026-06-30' }, env);
      expect(sweep).not.toBeNull();
      const real = sweep?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118);
      expect(real?.kredit).toBe(c(2_550));
      expect(real?.maksuperusteinenTosite).toBe(lasku.id);
      // link round-trips through the blob on this adapter
      const haettu = await s.getTosite(sweep?.id ?? 0);
      expect(haettu?.viennit.find((v) => v.alvKoodi === 118)?.maksuperusteinenTosite).toBe(
        lasku.id,
      );
      // return counts it
      const laskelma = await haeAlvLaskelma(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(laskelma.koodit.get(301)).toBe(c(2_550));
      // idempotent
      expect(await vanhennaMaksuperusteinenAlv(s, { loppupvm: '2026-06-30' }, env)).toBeNull();
    });

    it('marginaalivero: MARGINAALILASKELMA kirjaa veron 2939:lle (113) ja erittelyn myyntitilille (914); alijaama säilyy blob-round-tripissä (4 adapteria)', async () => {
      const s = await fresh();
      // Marginaalimyyntitili + real ALVVELKA (BL); 4000 (D) on jo CONFORMANCE_SEED:issä ostotilinä.
      await putTili(s, 3010, { numero: 3010, tyyppi: 'CL', nimi: { fi: 'Marginaalimyynti' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } });

      // Marginaalimyynti 100 000 (alvKoodi 13, 25,5 %) + marginaaliosto 60 000 (alvKoodi 23, 25,5 %).
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-05',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(100_000),
              kredit: c(0),
              pvm: '2026-06-05',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3010,
              debet: c(0),
              kredit: c(100_000),
              pvm: '2026-06-05',
              alvKoodi: 13,
              alvProsentti: 25.5,
            },
          ],
        },
        env,
      );
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-10',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 4000,
              debet: c(60_000),
              kredit: c(0),
              pvm: '2026-06-10',
              alvKoodi: 23,
              alvProsentti: 25.5,
            },
            {
              tili: 1900,
              debet: c(0),
              kredit: c(60_000),
              pvm: '2026-06-10',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );

      // margin 40 000; vero = roundHalfAway(2550*40000/12550) = roundHalfAway(8127.4900...) = 8127
      const odotettuVero = roundHalfAway((2550 * 40_000) / 12550);
      expect(odotettuVero).toBe(8127);

      const tosite = await kirjaaMarginaalivero(
        s,
        { alkupvm: '2026-06-01', loppupvm: '2026-06-30' },
        env,
      );
      expect(tosite?.tyyppi).toBe(TositeTyyppi.MARGINAALILASKELMA); // 9105
      expect(tosite?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 113)?.kredit).toBe(
        odotettuVero,
      );
      expect(tosite?.viennit.find((v) => v.tili === 3010 && v.alvKoodi === 914)?.debet).toBe(
        odotettuVero,
      );
      expect(tosite?.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
        tosite?.viennit.reduce((a, v) => a + v.kredit, 0),
      );

      const laskelma = await haeAlvLaskelma(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(laskelma.koodit.get(301)).toBe(odotettuVero);

      // Blob-round-trip: MARGINAALILASKELMA-tosite ja sen 113-vienti säilyvät haettuna uudelleen.
      const haettu = await s.getTosite(tosite?.id ?? 0);
      expect(haettu?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 113)?.kredit).toBe(
        odotettuVero,
      );

      // Seuraavalla kaudella negatiivinen marginaali -> alijaama, ei veroa; kenttä säilyy blobissa.
      await tallennaTosite(
        s,
        {
          pvm: '2026-07-05',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(30_000),
              kredit: c(0),
              pvm: '2026-07-05',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3010,
              debet: c(0),
              kredit: c(30_000),
              pvm: '2026-07-05',
              alvKoodi: 13,
              alvProsentti: 25.5,
            },
          ],
        },
        env,
      );
      await tallennaTosite(
        s,
        {
          pvm: '2026-07-10',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 4000,
              debet: c(50_000),
              kredit: c(0),
              pvm: '2026-07-10',
              alvKoodi: 23,
              alvProsentti: 25.5,
            },
            {
              tili: 1900,
              debet: c(0),
              kredit: c(50_000),
              pvm: '2026-07-10',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      const alijaamaTosite = await kirjaaMarginaalivero(
        s,
        { alkupvm: '2026-07-01', loppupvm: '2026-07-31' },
        env,
      );
      expect(alijaamaTosite?.viennit.some((v) => v.alvKoodi === 113)).toBe(false); // ei veroa
      expect(alijaamaTosite?.marginaalialijaama?.['25.50']).toBe(20_000); // 50000 - 30000

      // Alijaama säilyy blobissa myös uudelleen haettuna (sama sopimus joka adapterilla).
      const haettuAlijaama = await s.getTosite(alijaamaTosite?.id ?? 0);
      expect(haettuAlijaama?.marginaalialijaama?.['25.50']).toBe(20_000);
    });

    it('erä-namespace: myyntilaskun numero == ostolaskun tosite.id eivät sekoita avoimia saldoja (4 adapteria)', async () => {
      const s = await fresh();
      // Ostolaskun tilit (OstoVelkaTili resolves via Luonne.OSTOVELKA (BO)).
      await putTili(s, 4000, { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } });
      await putTili(s, 2870, { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } });
      // Myyntilaskun tilit/asetukset (nollaverollinen rivi -> ei alv-vientiä, AlvVelkaTili tarpeeton).
      await putTili(s, 1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });

      // 1) Ostolasku: 100,00 € -> ostovelka-era = tosite.id (N).
      const osto = await tallennaOstolasku(
        s,
        {
          pvm: '2025-03-01',
          laskupvm: '2025-03-01',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
        },
        env,
      );
      const N = osto.id;

      // 2) Pakota seuraavan myyntilaskun numero == N (ennen korjausta -> myynnin era = N = oston era).
      await paivitaAsetukset(s, {
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        LaskuNumerointialkaa: String(N),
        LaskuSeuraavaId: String(N),
      });
      const myynti = await tallennaMyyntilasku(
        s,
        { pvm: '2025-03-02', rivit: [{ myyntiKpl: 1, aNetto: 50, alvKoodi: 0, alvProsentti: 0 }] },
        env,
      );

      // Numero törmää oston id:hen, mutta myynnin erä on oma tosite.id (eri kuin N).
      expect(myynti.numero).toBe(String(N));
      expect(myynti.id).toBeGreaterThan(N);
      const arLeg = myynti.viennit.find((v) => v.debet > 0);
      expect(arLeg?.era).toBe(myynti.id);

      // Avoimet saldot ovat riippumattomat: osto 100,00 €, myynti 50,00 € — ei ristikontaminaatiota.
      const ostoLista = await listaaOstolaskut(s, {});
      const myyntiLista = await listaaMyyntilaskut(s, {});
      expect(ostoLista.find((r) => r.tosite === osto.id)?.avoin).toBe(10_000);
      expect(myyntiLista.find((r) => r.tosite === myynti.id)?.avoin).toBe(5_000);
    });

    it('alv: laskelma summaa kauden ja tilitys kirjaa ALVLASKELMA-tositteen joka lukitsee kauden', async () => {
      const s = await fresh();
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } });
      await putTili(s, 1763, { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } });
      await putTili(s, 2940, { numero: 2940, tyyppi: 'BV', nimi: { fi: 'Verovelka' } });
      const chart = await s.getChart();

      // Kotimaan nettomyynti 100,00 (25,5 %) oikean 1c-generaattorin kautta + pankin vastakirjaus.
      const myyntiViennit = generoiVeroviennit(
        [
          {
            tili: 3000,
            alvKoodi: AlvKoodi.MYYNNIT_NETTO,
            alvProsentti: 25.5,
            maara: c(10000),
            bruttoSyotto: false,
            puoli: 'kredit',
            pvm: '2026-06-05',
          },
        ],
        chart,
      );
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-05',
          tyyppi: 0,
          sarja: '',
          viennit: [
            ...myyntiViennit,
            {
              tili: 1900,
              debet: c(12550),
              kredit: c(0),
              pvm: '2026-06-05',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );

      // Palveluiden yhteisöhankinta 100,00 (käännetty verovelvollisuus) + pankin vastakirjaus.
      const ostoViennit = generoiVeroviennit(
        [
          {
            tili: 4000,
            alvKoodi: AlvKoodi.YHTEISOHANKINNAT_PALVELUT,
            alvProsentti: 25.5,
            maara: c(10000),
            bruttoSyotto: false,
            puoli: 'debet',
            pvm: '2026-06-10',
          },
        ],
        chart,
      );
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-10',
          tyyppi: 0,
          sarja: '',
          viennit: [
            ...ostoViennit,
            {
              tili: 1900,
              debet: c(0),
              kredit: c(10000),
              pvm: '2026-06-10',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );

      const laskelma = await haeAlvLaskelma(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(laskelma.koodit.get(301)).toBe(2550);
      expect(laskelma.koodit.get(306)).toBe(2550);
      expect(laskelma.koodit.get(307)).toBe(2550); // käännetty vero nettoutuu 306/307-parina
      expect(laskelma.maksettava).toBe(2550);

      const tilitys = await tallennaAlvTilitys(
        s,
        { alkupvm: '2026-06-01', loppupvm: '2026-06-30' },
        env,
      );
      expect(tilitys.tyyppi).toBe(TositeTyyppi.ALVLASKELMA);
      const debet = tilitys.viennit.reduce((sum, v) => sum + v.debet, 0);
      const kredit = tilitys.viennit.reduce((sum, v) => sum + v.kredit, 0);
      expect(debet).toBe(kredit);

      // Ilmoitetun kauden sisään ei enää saa alv-koodattua vientiä.
      await expect(
        tallennaTosite(
          s,
          {
            pvm: '2026-06-20',
            tyyppi: 0,
            sarja: '',
            viennit: [
              {
                tili: 1900,
                debet: c(1255),
                kredit: c(0),
                pvm: '2026-06-20',
                alvKoodi: 0,
                alvProsentti: 0,
              },
              {
                tili: 3000,
                debet: c(0),
                kredit: c(1000),
                pvm: '2026-06-20',
                alvKoodi: 11,
                alvProsentti: 25.5,
              },
              {
                tili: 2939,
                debet: c(0),
                kredit: c(255),
                pvm: '2026-06-20',
                alvKoodi: 111,
                alvProsentti: 25.5,
              },
            ],
          },
          env,
        ),
      ).rejects.toMatchObject({ code: 'EIVALMISTU' });
    });

    it('alv: bruttokirjauksen vero lasketaan kaudelta ja oikaistaan tilityksessä; BRUTTOOIKAISU säilyy round-tripissä', async () => {
      const s = await fresh();
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } });
      await putTili(s, 2940, { numero: 2940, tyyppi: 'BV', nimi: { fi: 'Verovelka' } });
      const pvm = '2026-06-10';
      await tallennaTosite(
        s,
        {
          pvm,
          tyyppi: TositeTyyppi.TULO,
          sarja: '',
          viennit: [
            { tili: 1900, debet: c(975543), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(975543),
              pvm,
              alvKoodi: AlvKoodi.MYYNNIT_BRUTTO,
              alvProsentti: 25.5,
            },
          ],
        },
        env,
      );
      const kausi = { alkupvm: '2026-06-01', loppupvm: '2026-06-30' };
      const laskelma = await haeAlvLaskelma(s, kausi);
      expect(laskelma.koodit.get(301)).toBe(198218);
      expect(laskelma.maksettava).toBe(198218);

      await tallennaAlvTilitys(s, kausi, env);
      const saldot = await s.querySaldot({ loppupvm: '2026-06-30' });
      expect(saldot.get(3000)).toBe(-777325); // myynti nettona tilityksen jälkeen
      expect(saldot.get(2939) ?? 0).toBe(0);
      expect(saldot.get(2940)).toBe(-198218);

      // Tallennettu oikaisu (VientiTyyppi.BRUTTOOIKAISU) ohitetaan uudelleenlaskennassa vain,
      // jos adapteri säilyttää vienti.tyyppi-kentän.
      const uudelleen = await haeAlvLaskelma(s, kausi);
      expect(uudelleen.koodit.get(301)).toBe(198218);
      expect(uudelleen.maksettava).toBe(198218);
    });

    it('tilikauden lukitus estää kirjaukset lukitulle kaudelle ja avaus sallii ne uudelleen', async () => {
      const s = await fresh();
      // Vuosi 2025 auki: kirjaus 2025-06-01 onnistuu.
      const a = await tallennaTosite(
        s,
        { pvm: '2025-06-01', tyyppi: 0, sarja: '', ...bal(100, '2025-06-01') },
        env,
      );
      expect(a.tila).toBe(100);

      // Ei voi lukita 2026:tta ennen 2025:tta.
      await expect(paataTilikausi(s, '2026-01-01')).rejects.toMatchObject({
        code: 'EDELLINENAUKI',
      });

      // Lukitse 2025 -> TilitPaatetty = 2025-12-31.
      await paataTilikausi(s, '2025-01-01');
      expect((await s.getAsetukset()).TilitPaatetty).toBe('2025-12-31');

      // Kirjaus lukitulle kaudelle hylätään (PVMLUKITTU), avoimelle onnistuu.
      await expect(
        tallennaTosite(
          s,
          { pvm: '2025-06-02', tyyppi: 0, sarja: '', ...bal(100, '2025-06-02') },
          env,
        ),
      ).rejects.toMatchObject({ code: 'PVMLUKITTU' });
      const b = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100, '2026-06-01') },
        env,
      );
      expect(b.tila).toBe(100);

      // Avaa 2025 -> raja rullaa taakse; kirjaus 2025:lle onnistuu taas.
      await avaaTilikausi(s, '2025-01-01');
      expect((await s.getAsetukset()).TilitPaatetty).toBe('2024-12-31');
      const cc = await tallennaTosite(
        s,
        { pvm: '2025-06-03', tyyppi: 0, sarja: '', ...bal(100, '2025-06-03') },
        env,
      );
      expect(cc.tila).toBe(100);
    });

    it('tilinavaus kirjaa alkusaldot ja ne näkyvät saldoissa', async () => {
      const s = await fresh();
      const tosite = await luoTilinavaus(
        s,
        {
          pvm: '2025-01-01',
          saldot: [
            { tili: 1900, saldo: c(10000) }, // vastaavaa -> debet
            { tili: 2251, saldo: c(10000) }, // oma pääoma -> kredit
          ],
        },
        env,
      );
      expect(tosite.tyyppi).toBe(TositeTyyppi.TILINAVAUS);
      expect(tosite.viennit.find((v) => v.tili === 1900)?.debet).toBe(10000);
      expect(tosite.viennit.find((v) => v.tili === 2251)?.kredit).toBe(10000);
      expect((await s.getAsetukset()).Tilinavaus).toBe('1');

      // Pankkitilin (1900) saldo 2025 lopussa sisältää avauksen 10000.
      // haeSaldot palauttaa Map<number, Cents>; 1900 on vastaavaa (debit-positiivinen).
      const saldot = await haeSaldot(s, env, { pvm: '2025-12-31', tase: true });
      expect(saldot.get(1900)).toBe(10000);
    });

    it('alv-ilmoitus paketoi kauden koodit ja yhteisömyynti erittelee asiakkaittain', async () => {
      const s = await fresh();
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } });
      const asiakas = await s.saveKumppani({
        nimi: 'EU Asiakas GmbH',
        alvtunnus: 'DE123456789',
        maa: 'de',
      });

      // Kotimaan 25,5 % myynti (koodit 301 + peruste) + pankin vastakirjaus.
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-05',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(12550),
              kredit: c(0),
              pvm: '2026-06-05',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(10000),
              pvm: '2026-06-05',
              alvKoodi: 11,
              alvProsentti: 25.5,
            },
            {
              tili: 2939,
              debet: c(0),
              kredit: c(2550),
              pvm: '2026-06-05',
              alvKoodi: 111,
              alvProsentti: 25.5,
            },
          ],
        },
        env,
      );
      // EU-tavaramyynti (koodi 14, nollalaji) asiakkaalle + pankin vastakirjaus.
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-10',
          tyyppi: 0,
          sarja: '',
          kumppani: asiakas.id,
          viennit: [
            {
              tili: 1900,
              debet: c(8000),
              kredit: c(0),
              pvm: '2026-06-10',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(8000),
              pvm: '2026-06-10',
              alvKoodi: AlvKoodi.YHTEISOMYYNTI_TAVARAT,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );

      const ilmoitus = await haeAlvIlmoitus(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(ilmoitus.koodit.get(301)).toBe(2550);
      expect(ilmoitus.koodit.get(311)).toBe(8000); // tavaroiden yhteisömyynti, peruste
      expect(ilmoitus.kausityyppi).toBe('K');
      expect(ilmoitus.nolla).toBe(false);

      const eu = await haeEuMyyntiYhteenveto(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(eu.rivit).toHaveLength(1);
      expect(eu.rivit[0]?.tavara).toBe(8000);
      expect(eu.rivit[0]?.alvtunnus).toBe('DE123456789');
      expect(eu.puuttuviaTunnuksia).toBe(false);
    });

    it('tyhjä kausi: alv-ilmoitus on nollailmoitus ja yhteisömyynti tyhjä', async () => {
      const s = await fresh();
      const ilmoitus = await haeAlvIlmoitus(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(ilmoitus.nolla).toBe(true);
      expect(ilmoitus.koodit.size).toBe(0);
      const eu = await haeEuMyyntiYhteenveto(s, { alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(eu.rivit).toHaveLength(0);
      expect(eu.puuttuviaTunnuksia).toBe(false);
    });

    it('alv-erittely: viennit tositetietoineen ja bruttokirjauksen oikaisut; summat täsmäävät laskelmaan, tilitys ei muuta', async () => {
      const s = await fresh();
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } });
      await putTili(s, 2940, { numero: 2940, tyyppi: 'BV', nimi: { fi: 'Verovelka' } });
      const asiakas = await s.saveKumppani({ nimi: 'Asiakas Oy' });
      // Nettomyynti 100,00 + 25,50 kumppanille; selite vain myyntiviennillä.
      const netto = await tallennaTosite(
        s,
        {
          pvm: '2026-06-05',
          tyyppi: 0,
          sarja: '',
          kumppani: asiakas.id,
          otsikko: 'Kesäkuun myynti',
          viennit: [
            {
              tili: 1900,
              debet: c(12550),
              kredit: c(0),
              pvm: '2026-06-05',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(10000),
              pvm: '2026-06-05',
              alvKoodi: AlvKoodi.MYYNNIT_NETTO,
              alvProsentti: 25.5,
              selite: 'Asiakas Oy',
            },
            {
              tili: 2939,
              debet: c(0),
              kredit: c(2550),
              pvm: '2026-06-05',
              alvKoodi: 111,
              alvProsentti: 25.5,
            },
          ],
        },
        env,
      );
      // Bruttomyynti 124,00 @ 24 % ilman kumppania.
      await tallennaTosite(
        s,
        {
          pvm: '2026-06-10',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(12400),
              kredit: c(0),
              pvm: '2026-06-10',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(12400),
              pvm: '2026-06-10',
              alvKoodi: AlvKoodi.MYYNNIT_BRUTTO,
              alvProsentti: 24,
            },
          ],
        },
        env,
      );
      const kausi = { alkupvm: '2026-06-01', loppupvm: '2026-06-30' };

      const e = await haeAlvErittely(s, kausi);
      expect(e.rivit.map((r) => [r.alvKoodi, r.kanta, r.tili, r.summa])).toEqual([
        [11, 2550, 3000, 10000],
        [12, 2400, 3000, 12400],
        [12, 2400, 3000, -2400],
        [111, 2550, 2939, 2550],
        [112, 2400, 2939, 2400],
      ]);
      expect(e.rivit[0]).toMatchObject({
        tosite: netto.id,
        tositeNumero: `${netto.sarja} ${netto.tunniste}`.trim(),
        tositePvm: '2026-06-05',
        pvm: '2026-06-05',
        kumppani: 'Asiakas Oy',
        selite: 'Asiakas Oy',
      });
      expect(e.rivit[3]?.selite).toBe('Kesäkuun myynti'); // ei viennin selitettä -> otsikko
      expect(e.rivit[2]?.tosite).toBeUndefined();
      expect(e.rivit[2]).toMatchObject({ tositeNumero: '', pvm: '2026-06-30', kumppani: '' });

      // Veroryhmien summa = ilmoituksen 301 (111 @ 25,5 % + 112 @ 24 %).
      const laskelma = await haeAlvLaskelma(s, kausi);
      const vero = ryhmitteleAlvErittely(e.rivit)
        .filter((r) => r.alvKoodi >= 100 && r.alvKoodi < 200)
        .reduce((a, r) => a + r.summa, 0);
      expect(vero).toBe(laskelma.koodit.get(301));

      // Tilitys kirjaa saman selitteen eikä muuta erittelyä (ALVLASKELMA-tosite jää pois).
      const tilitys = await tallennaAlvTilitys(s, kausi, env);
      const kirjattu = tilitys.viennit.find(
        (v) => v.tyyppi === VientiTyyppi.BRUTTOOIKAISU && v.tili === 3000,
      );
      expect(kirjattu?.selite).toBe(e.rivit[2]?.selite);
      expect(await haeAlvErittely(s, kausi)).toEqual(e);
    });

    it('tulovero: verolaskelma summaa kauden ja tallennaTulovero kirjaa jaksotustositteen', async () => {
      const s = await fresh();
      await putTili(s, 5000, { numero: 5000, tyyppi: 'DH', nimi: { fi: 'Edustuskulut' } });
      await putTili(s, 1770, { numero: 1770, tyyppi: 'DVE', nimi: { fi: 'Ennakkoverot' } });
      await putTili(s, 9940, {
        numero: 9940,
        tyyppi: 'DZ',
        nimi: { fi: 'Tilikauden verojaksotus' },
      });
      await putTili(s, 2968, {
        numero: 2968,
        tyyppi: 'B',
        nimi: { fi: 'Tuloverot (siirtovelat)' },
      });

      const kirjaa = async (pvm: string, tili: number, debet: number) =>
        tallennaTosite(
          s,
          {
            pvm,
            tyyppi: 0,
            sarja: '',
            viennit: [
              { tili, debet: c(debet), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
              { tili: 1900, debet: c(0), kredit: c(debet), pvm, alvKoodi: 0, alvProsentti: 0 },
            ],
          },
          env,
        );
      // Tulo 100 000 = kredit 3000.
      await tallennaTosite(
        s,
        {
          pvm: '2026-03-01',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(100_000),
              kredit: c(0),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(100_000),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      await kirjaa('2026-03-02', 4000, 30_000); // täysvähennys
      await kirjaa('2026-03-03', 5000, 10_000); // puolivähennys
      await kirjaa('2026-03-04', 1770, 4_000); // ennakko

      const l = await haeVerolaskelma(s, {
        alkupvm: '2026-01-01',
        loppupvm: '2026-12-31',
        aiempiTappio: c(5_000),
      });
      expect(l.tulo).toBe(100_000);
      expect(l.vahennys).toBe(35_000);
      expect(l.tulos).toBe(65_000);
      expect(l.loppuTulos).toBe(60_000);
      expect(l.vero).toBe(12_000);
      expect(l.jaaveroa).toBe(8_000);
      expect(l.joKirjattu).toBe(false);

      const tosite = await tallennaTulovero(
        s,
        { alkupvm: '2026-01-01', loppupvm: '2026-12-31', aiempiTappio: c(5_000) },
        env,
      );
      expect(tosite.tyyppi).toBe(9930);
      expect(tosite.viennit.find((v) => v.tili === 9940)?.debet).toBe(8_000);
      expect(tosite.viennit.find((v) => v.tili === 2968)?.kredit).toBe(8_000);

      await expect(
        tallennaTulovero(
          s,
          { alkupvm: '2026-01-01', loppupvm: '2026-12-31', aiempiTappio: c(5_000) },
          env,
        ),
      ).rejects.toMatchObject({ code: 'JOVEROKIRJATTU' });
      expect(
        (await haeVerolaskelma(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' })).joKirjattu,
      ).toBe(true);
    });

    it('tulovero: jaaveroa === 0 => EIVEROA, ei kirjausta', async () => {
      const s = await fresh();
      await expect(
        tallennaTulovero(s, { alkupvm: '2026-01-01', loppupvm: '2026-12-31' }, env),
      ).rejects.toMatchObject({ code: 'EIVEROA' });
    });

    it('poistot: menojäännöspoisto lasketaan ja POISTOLASKELMA kirjataan tasapainossa', async () => {
      const s = await fresh();
      await putTili(s, 1120, {
        numero: 1120,
        tyyppi: 'APM',
        nimi: { fi: 'Koneet' },
        menojaannospoisto: 25,
        poistotili: 6820,
      });
      await putTili(s, 6820, { numero: 6820, tyyppi: 'DP', nimi: { fi: 'Poistot koneista' } });
      // Hankinta 100 000: DEBET 1120 / KREDIT 1900.
      await tallennaTosite(
        s,
        {
          pvm: '2026-03-01',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1120,
              debet: c(100_000),
              kredit: c(0),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 1900,
              debet: c(0),
              kredit: c(100_000),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );

      const l = await haePoistolaskelma(s, { loppupvm: '2026-12-31' });
      expect(l.rivit).toHaveLength(1);
      expect(l.rivit[0]).toMatchObject({
        tili: 1120,
        ennen: 100_000,
        poisto: 25_000,
        poistotili: 6820,
      });
      expect(l.yhteensa).toBe(25_000);
      expect(l.joKirjattu).toBe(false);

      const tosite = await tallennaPoistot(s, { loppupvm: '2026-12-31' }, env);
      expect(tosite.tyyppi).toBe(9910);
      expect(tosite.viennit.find((v) => v.tili === 1120)?.kredit).toBe(25_000);
      expect(tosite.viennit.find((v) => v.tili === 6820)?.debet).toBe(25_000);

      await expect(tallennaPoistot(s, { loppupvm: '2026-12-31' }, env)).rejects.toMatchObject({
        code: 'JOPOISTETTU',
      });
      expect((await haePoistolaskelma(s, { loppupvm: '2026-12-31' })).joKirjattu).toBe(true);
    });

    it('poistot: ei poistettavaa omaisuutta => EIPOISTETTAVAA', async () => {
      const s = await fresh();
      await expect(tallennaPoistot(s, { loppupvm: '2026-12-31' }, env)).rejects.toMatchObject({
        code: 'EIPOISTETTAVAA',
      });
    });

    it('jaksotukset: jaksokentät säilyvät blob-round-tripissä ja purku kirjataan seuraavalle kaudelle', async () => {
      const s = await fresh();
      await putTili(s, 1774, { numero: 1774, tyyppi: 'AJ', nimi: { fi: 'Siirtosaamiset' } });
      await putTili(s, 2925, { numero: 2925, tyyppi: 'BJ', nimi: { fi: 'Siirtovelat' } });
      // Etukäteen maksettu kulu 2025-11-01, jakso 2025-11-01..2026-10-31 (365 pv).
      const lasku = await tallennaTosite(
        s,
        {
          pvm: '2025-11-01',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 3000,
              debet: c(36_500),
              kredit: c(0),
              pvm: '2025-11-01',
              alvKoodi: 0,
              alvProsentti: 0,
              jaksoalkaa: '2025-11-01',
              jaksoloppuu: '2026-10-31',
            },
            {
              tili: 1900,
              debet: c(0),
              kredit: c(36_500),
              pvm: '2025-11-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      );
      // Blob-round-trip: jaksokentät säilyvät tallennuksen jälkeen.
      const tallennettu = (await listaaTositteet(s, {})).find((t) => t.id === lasku.id);
      expect(tallennettu?.viennit.find((v) => v.tili === 3000)?.jaksoalkaa).toBe('2025-11-01');
      expect(tallennettu?.viennit.find((v) => v.tili === 3000)?.jaksoloppuu).toBe('2026-10-31');

      const paatos = await tallennaJaksotukset(s, { loppupvm: '2025-12-31' }, env);
      expect(paatos.tyyppi).toBe(9920);
      // Branch B: 3000 on kredit-luonteinen (myynti), euro = 0−36500 = −36500; 304/365 → +30400? tarkista tasapaino.
      const d = paatos.viennit.reduce((a, v) => a + v.debet, 0);
      const k = paatos.viennit.reduce((a, v) => a + v.kredit, 0);
      expect(d).toBe(k);
      // Purku 2026-01-01.
      const purut = await listaaTositteet(s, { alkupvm: '2026-01-01', loppupvm: '2026-01-01' });
      expect(purut.some((t) => t.tyyppi === 9920)).toBe(true);
    });

    it('jaksotukset: ei jaksettavaa => EIJAKSOTETTAVAA', async () => {
      const s = await fresh();
      await expect(tallennaJaksotukset(s, { loppupvm: '2025-12-31' }, env)).rejects.toMatchObject({
        code: 'EIJAKSOTETTAVAA',
      });
    });

    it('hyvityslasku: myyntilaskun hyvitys nollaa avoimen (4 adapteria)', async () => {
      const s = await fresh();
      await putTili(s, 1700, { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } });
      // Toisin kuin ostolaskun OstoVelkaTili, myyntilasku ei kaadu luonteeseen — asetettava.
      await paivitaAsetukset(s, {
        LaskuSaatavaTili: '1700',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
      });
      const lasku = await tallennaMyyntilasku(
        s,
        {
          pvm: '2025-03-01',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5, tili: 3000 }],
        },
        env,
      );
      const hyv = await tallennaHyvityslasku(
        s,
        { alkuperainenTosite: lasku.id, pvm: '2025-03-15' },
        env,
      );
      expect(hyv.alkuperainenTosite).toBe(lasku.id); // survives blob round-trip
      expect((await listaaMyyntilaskut(s, {})).find((r) => r.tosite === lasku.id)?.avoin).toBe(0);
    });

    it('hyvityslasku: myyntilaskun hyvitys saa seuraavan laskunumeron ja alkuperäisen viitteen', async () => {
      const s = await fresh();
      await putTili(s, 1700, { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' } });
      await putTili(s, 2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } });
      await paivitaAsetukset(s, {
        LaskuSaatavaTili: '1700',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
      });
      const rivit = [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5, tili: 3000 }];
      const lasku = await tallennaMyyntilasku(s, { pvm: '2025-03-01', rivit }, env);
      expect(lasku.numero).toBe('1');
      const hyv = await tallennaHyvityslasku(
        s,
        { alkuperainenTosite: lasku.id, pvm: '2025-03-15' },
        env,
      );
      expect(hyv.numero).toBe('2');
      expect(hyv.viite).toBe(lasku.viite);
      const seuraava = await tallennaMyyntilasku(s, { pvm: '2025-03-20', rivit }, env);
      expect(seuraava.numero).toBe('3');
    });

    it('hyvityslasku: ostolaskun hyvitys nollaa avoimen (4 adapteria)', async () => {
      const s = await fresh();
      await putTili(s, 4000, { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } });
      await putTili(s, 2870, { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } });
      const osto = await tallennaOstolasku(
        s,
        {
          pvm: '2025-03-01',
          erapvm: '2025-03-31',
          rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
        },
        env,
      );
      const hyv = await tallennaHyvityslasku(
        s,
        { alkuperainenTosite: osto.id, pvm: '2025-03-15' },
        env,
      );
      expect(hyv.numero).toBeUndefined();
      expect((await listaaOstolaskut(s, {})).find((r) => r.tosite === osto.id)?.avoin).toBe(0);
    });

    it('tilinpäätös: laadi -> vahvista -> peru toimii saumattomasti kaikilla adaptereilla (4 adapteria)', async () => {
      const s = await fresh();
      // Tuloa 2026: kredit 3000 (Myynti, jo CONFORMANCE_SEED:issä), debet pankki 1900.
      await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(50_000, '2026-06-01') },
        env,
      );
      // CONFORMANCE_SEED ei sisällä raporttikaavoja -> seedataan minimaaliset tulos/tase-kaavat.
      await paivitaAsetukset(s, {
        'tulos/yleinen': JSON.stringify({
          nimi: { fi: 'Tuloslaskelma' },
          rivit: [{ fi: 'Liikevaihto', L: '3' }],
        }),
        'tase/yleinen': JSON.stringify({
          nimi: { fi: 'Tase' },
          rivit: [{ fi: 'Pankkitili', L: '1900' }],
        }),
      });
      await tallennaLiitetiedot(s, { loppupvm: '2026-12-31', teksti: 'Tilikausi sujui hyvin.' });

      // TilitPaatetty etenee vanhimmasta uusimpaan: 2025 on lukittava ennen 2026:tta.
      await paataTilikausi(s, '2025-01-01');
      await paataTilikausi(s, '2026-01-01');
      await vahvistaTilinpaatos(s, { alkaa: '2026-01-01' }, env);

      const tp = await laadiTilinpaatos(s, env, { alkaa: '2026-01-01' });
      expect(tp.tuloslaskelma.length).toBeGreaterThan(0);
      expect(tp.tase.length).toBeGreaterThan(0);
      expect(tp.liitetiedot).toBe('Tilikausi sujui hyvin.'); // liitetiedot round-trip
      expect(tp.vahvistettu).not.toBeNull();

      await peruVahvistus(s, { alkaa: '2026-01-01' });
      expect((await laadiTilinpaatos(s, env, { alkaa: '2026-01-01' })).vahvistettu).toBeNull();
    });

    it('stamps audit rows with lahde when the env carries one', async () => {
      const s = await fresh();
      const withLahde = await tallennaTosite(
        s,
        { pvm: '2026-06-01', tyyppi: 0, sarja: '', ...bal(100) },
        { ...env, lahde: 'agentti:testi' },
      );
      const loki = await s.getLoki(withLahde.id);
      expect(loki.at(-1)?.lahde).toBe('agentti:testi');

      const withoutLahde = await tallennaTosite(
        s,
        { pvm: '2026-06-02', tyyppi: 0, sarja: '', ...bal(100, '2026-06-02') },
        env,
      );
      const loki2 = await s.getLoki(withoutLahde.id);
      expect(loki2.at(-1)?.lahde).toBeUndefined();
    });

    it('tuoLoki appends historical audit rows verbatim and in order, before later saves', async () => {
      const s = await fresh();
      await s.tuoLoki([
        {
          tosite: 77,
          tila: 100,
          aika: '2024-02-01T09:00:00Z',
          userId: 3,
          lahde: 'kitsas',
          data: { a: 1 },
        },
        { tosite: 77, tila: 0, aika: '2024-02-02T09:00:00Z', lahde: 'kitsas', data: null },
        { tosite: 78, tila: 100, aika: '2024-02-03T09:00:00Z', lahde: 'kitsas', data: { b: 2 } },
      ]);
      const tallennettu = await s.saveTosite(
        { id: 77, pvm: '2026-06-01', tyyppi: 0, tila: 100, tunniste: 1, sarja: '', ...bal(100) },
        env,
      );
      const loki = await s.getLoki(tallennettu.id);
      expect(loki).toHaveLength(3);
      expect(loki[0]).toEqual({
        tosite: 77,
        tila: 100,
        aika: '2024-02-01T09:00:00Z',
        userId: 3,
        lahde: 'kitsas',
        data: { a: 1 },
      });
      expect(loki[1]).toMatchObject({ tila: 0, aika: '2024-02-02T09:00:00Z', data: null });
      expect(loki[1]?.userId).toBeUndefined();
      expect(loki[2]?.aika).toBe(env.aika);
      expect(loki[2]?.lahde).toBeUndefined();
      expect(await s.getLoki(78)).toHaveLength(1);
      // Historiarivit eivät ole tositteita: ne eivät näy listassa eivätkä saldoissa.
      expect((await s.listTositteet({ bucket: 'kirjanpidossa' })).map((t) => t.id)).toEqual([77]);
    });
  });
}
