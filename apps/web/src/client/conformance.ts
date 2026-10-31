import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';

/** Seed shape shared by both client factories (mirrors the engine ConformanceSeed). */
export interface ClientConformanceSeed {
  tilit: { numero: number; tyyppi: string; nimi: { fi: string } }[];
  tilikaudet: { alkaa: string; loppuu: string }[];
  asetukset: Record<string, string>;
}

/**
 * Minimal but legal seed over two fiscal years. The tyyppi codes are the engine's own
 * (ARP=pankkitili, CL=liikevaihtotulo, D=meno, BE=edellisten tulos, T=kauden tulos) so
 * lataaKartta resolves their luonne and the equity carry-forward rows (EDELLISTENTULOS /
 * KAUDENTULOS) compute — these are required for sign-normalized saldot to behave.
 */
export const CLIENT_CONFORMANCE_SEED: ClientConformanceSeed = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto/tappio' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto/tappio' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: {
    Nimi: 'Testi Oy',
    AlvVelvollinen: 'false',
    'tulos/yleinen': JSON.stringify({
      nimi: { fi: 'Tuloslaskelma' },
      rivit: [{ fi: 'Liikevaihto', L: '3 *' }],
    }),
  },
};

type MakeClient = (seed: ClientConformanceSeed) => Promise<KpClient> | KpClient;

/** Run the shared behavioral conformance suite against a KpClient implementation. */
export function runClientConformance(name: string, makeClient: MakeClient): void {
  describe(`KpClient conformance: ${name}`, () => {
    const fresh = () => makeClient(CLIENT_CONFORMANCE_SEED);

    /** A balanced 2-line voucher (debet 1900 / kredit 3000) for `summa` cents on `pvm`. */
    const tasapainoinen = (pvm: string, summaSnt: number) => ({
      pvm,
      tyyppi: 200,
      sarja: '',
      viennit: [
        {
          tili: 1900,
          debet: Euro.fromCents(summaSnt),
          kredit: Euro.fromCents(0),
          pvm,
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 3000,
          debet: Euro.fromCents(0),
          kredit: Euro.fromCents(summaSnt),
          pvm,
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });

    it('loads the seeded init bundle', async () => {
      const c = await fresh();
      const init = await c.haeInit();
      expect(init.tilit.length).toBe(5);
      expect(init.tilikaudet.length).toBe(2);
      expect(init.asetukset.Nimi).toBe('Testi Oy');
    });

    it('assigns gapless tunniste on create into the books', async () => {
      const c = await fresh();
      const a = await c.luoTosite({ ...tasapainoinen('2026-02-01', 10_000), tila: 100 });
      const b = await c.luoTosite({ ...tasapainoinen('2026-02-02', 20_000), tila: 100 });
      expect(a.tunniste).toBe(1);
      expect(b.tunniste).toBe(2);
    });

    it('keeps drafts out of the default bucket and unnumbered', async () => {
      const c = await fresh();
      await c.luoTosite({ ...tasapainoinen('2026-03-01', 5_000), tila: 50 });
      const kirjanpidossa = await c.listaaTositteet({ bucket: 'kirjanpidossa' });
      const luonnokset = await c.listaaTositteet({ bucket: 'luonnos' });
      expect(kirjanpidossa).toHaveLength(0);
      expect(luonnokset).toHaveLength(1);
      expect(luonnokset[0]?.tunniste).toBe(0);
    });

    it('finalizes a draft (assigns tunniste) via muutaTila', async () => {
      const c = await fresh();
      const draft = await c.luoTosite({ ...tasapainoinen('2026-03-05', 7_000), tila: 50 });
      await c.muutaTila(draft.id, 100);
      const after = await c.haeTosite(draft.id);
      expect(after?.tila).toBe(100);
      expect(after?.tunniste).toBe(1);
    });

    it('rejects finalizing an unbalanced voucher with EIVALMISTU', async () => {
      const c = await fresh();
      const epatasapaino = {
        pvm: '2026-04-01',
        tyyppi: 200,
        sarja: '',
        tila: 50,
        viennit: [
          {
            tili: 1900,
            debet: Euro.fromCents(10_000),
            kredit: Euro.fromCents(0),
            pvm: '2026-04-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(9_000),
            pvm: '2026-04-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      };
      const draft = await c.luoTosite(epatasapaino);
      await expect(c.muutaTila(draft.id, 100)).rejects.toMatchObject({ code: 'EIVALMISTU' });
    });

    it('soft-deletes a voucher (moves it to the poistetut bucket)', async () => {
      const c = await fresh();
      const t = await c.luoTosite({ ...tasapainoinen('2026-05-01', 3_300), tila: 100 });
      await c.poistaTosite(t.id);
      expect(await c.listaaTositteet({ bucket: 'kirjanpidossa' })).toHaveLength(0);
      expect(await c.listaaTositteet({ bucket: 'poistetut' })).toHaveLength(1);
    });

    it('computes sign-normalized saldot in integer cents', async () => {
      const c = await fresh();
      await c.luoTosite({ ...tasapainoinen('2026-06-01', 12_345), tila: 100 });
      // Full saldot (no tase/tuloslaskelma flag): both the balance-sheet and result blocks run,
      // so the asset and income accounts both appear. Asset 1900 is debit-positive; income 3000
      // is credit-positive — both normalize to +12345.
      const saldot = await c.haeSaldot({ pvm: '2026-12-31' });
      expect(saldot.get(1900)).toBe(12_345);
      expect(saldot.get(3000)).toBe(12_345);
    });

    it('listaa tulot tilin luonteen perusteella', async () => {
      const c = await fresh();
      await c.luoTosite(tasapainoinen('2026-03-01', 10000));

      const rivit = await c.listaaTulot({});

      expect(rivit).toHaveLength(1);
      expect(rivit[0]?.netto).toBe(Euro.fromCents(10000));
      expect(rivit[0]?.summa).toBe(Euro.fromCents(10000));
      expect(rivit[0]?.avoin).toBe(Euro.fromCents(0));
    });

    it('ei listaa myyntiä menoina', async () => {
      const c = await fresh();
      await c.luoTosite(tasapainoinen('2026-03-01', 10000));

      expect(await c.listaaMenot({})).toEqual([]);
    });

    it('renders a report through laadiRaportti (transport-parity money)', async () => {
      const c = await fresh();
      await c.luoTosite({ ...tasapainoinen('2026-06-01', 10_000), tila: 100 });
      const rivit = await c.laadiRaportti({
        muoto: 'tulos/yleinen',
        pvm: '2026-12-31',
        alkupvm: '2026-01-01',
      });
      const liikevaihto = rivit.find((r) => r.teksti === 'Liikevaihto');
      expect(liikevaihto?.arvo).toBe(Euro.fromCents(10_000));
    });

    it('carries per-account detail rows only when erittelyt is requested', async () => {
      const c = await fresh();
      await c.luoTosite({ ...tasapainoinen('2026-06-01', 10_000), tila: 100 });
      const params = { muoto: 'tulos/yleinen', pvm: '2026-12-31', alkupvm: '2026-01-01' };
      expect((await c.laadiRaportti(params)).some((r) => r.tili !== undefined)).toBe(false);
      const rivit = await c.laadiRaportti({ ...params, erittelyt: true });
      expect(rivit.find((r) => r.tili === 3000)).toEqual({
        teksti: '3000 Myynti',
        sisennys: 1,
        lihava: false,
        arvo: Euro.fromCents(10_000),
        tili: 3000,
        kaavarivi: 0,
      });
    });

    it('kaikkiRivit emits every layout row with its kaavaLaji (default drops empty rows)', async () => {
      const c = await fresh();
      await c.paivitaAsetukset({
        'tulos/kaikki': JSON.stringify({
          rivit: [
            { fi: 'Liikevaihto', L: '3' },
            { fi: 'Tyhjä', L: '9' },
            { fi: 'Välisumma', L: '=' },
          ],
        }),
      });
      await c.luoTosite({ ...tasapainoinen('2026-06-01', 10_000), tila: 100 });
      const params = { muoto: 'tulos/kaikki', pvm: '2026-12-31', alkupvm: '2026-01-01' };
      const oletus = await c.laadiRaportti(params);
      expect(oletus.map((r) => r.teksti)).toEqual(['Liikevaihto', 'Välisumma']);
      const kaikki = await c.laadiRaportti({ ...params, kaikkiRivit: true });
      expect(kaikki.map((r) => [r.kaavarivi, r.teksti, r.kaavaLaji])).toEqual([
        [0, 'Liikevaihto', undefined],
        [1, 'Tyhjä', 'ohitettava'],
        [2, 'Välisumma', 'valisumma'],
      ]);
    });

    it('rejects an unknown report layout with EIRAPORTTIA', async () => {
      const c = await fresh();
      await expect(
        c.laadiRaportti({ muoto: 'tase/yleinen', pvm: '2026-12-31' }),
      ).rejects.toMatchObject({ code: 'EIRAPORTTIA' });
    });

    it('round-trips a master-data settings patch', async () => {
      const c = await fresh();
      await c.paivitaAsetukset({ Nimi: 'Päivitetty Oy' });
      const a = await c.haeAsetukset();
      expect(a.Nimi).toBe('Päivitetty Oy');
    });

    it('round-trips a kumppani (save auto-id -> list -> update -> delete)', async () => {
      const c = await fresh();
      const saved = await c.tallennaKumppani({ nimi: 'Asiakas Oy', alvtunnus: 'FI12345678' });
      expect(saved.id).toBeGreaterThan(0);
      expect(await c.haeKumppanit()).toHaveLength(1);
      const paivitetty = await c.tallennaKumppani({ id: saved.id, nimi: 'Asiakas Oyj' });
      expect(paivitetty.id).toBe(saved.id);
      expect((await c.haeKumppanit())[0]?.nimi).toBe('Asiakas Oyj');
      await c.poistaKumppani(saved.id);
      expect(await c.haeKumppanit()).toHaveLength(0);
    });

    it('kiertää liitteen tavulleen molemmilla transporteilla (base64)', async () => {
      const c = await fresh();
      const t = await c.luoTosite(tasapainoinen('2026-06-01', 10000));
      const tavut = new Uint8Array([0x00, 0xff, 0x10, 0x7f]);
      const tallennettu = await c.tallennaLiite({
        tosite: t.id,
        nimi: 'kuitti.pdf',
        tyyppi: 'application/pdf',
        luotu: '2026-06-01T00:00:00.000Z',
        data: tavut,
      });
      expect(tallennettu.id).toBeGreaterThan(0);
      expect(await c.haeLiitteet(t.id)).toHaveLength(1);
      const haettu = await c.haeLiite(tallennettu.id);
      expect(haettu?.data).toEqual(tavut);
      await c.poistaLiite(tallennettu.id);
      expect(await c.haeLiitteet(t.id)).toHaveLength(0);
    });

    it('listat kantavat liitemäärän ja tulot näyttävät luonnoksen molemmilla transporteilla', async () => {
      const c = await fresh();
      const kirjattu = await c.luoTosite({ ...tasapainoinen('2026-06-01', 10000), tila: 100 });
      const luonnos = await c.luoTosite({ ...tasapainoinen('2026-06-02', 5000), tila: 50 });
      const perus = { tyyppi: 'application/pdf', luotu: '2026-06-01T00:00:00.000Z' };
      await c.tallennaLiite({
        ...perus,
        tosite: luonnos.id,
        nimi: 'a.pdf',
        data: new Uint8Array([1]),
      });
      await c.tallennaLiite({
        ...perus,
        tosite: luonnos.id,
        nimi: 'b.pdf',
        data: new Uint8Array([2]),
      });

      expect(
        (await c.listaaTositteet({ bucket: 'kirjanpidossa' })).map((t) => t.liitteita),
      ).toEqual([0]);
      expect((await c.listaaTositteet({ bucket: 'luonnos' })).map((t) => t.liitteita)).toEqual([2]);
      const tulot = await c.listaaTulot({});
      expect(tulot.map((r) => [r.tosite, r.tila, r.liitteita])).toEqual([
        [kirjattu.id, 100, 0],
        [luonnos.id, 50, 2],
      ]);
      expect((await c.listaaTulot({ bucket: 'luonnos' })).map((r) => r.tosite)).toEqual([
        luonnos.id,
      ]);
      expect((await c.listaaTulot({ bucket: 'kirjanpidossa' })).map((r) => r.tosite)).toEqual([
        kirjattu.id,
      ]);
    });

    it('listat kertovat alkuperän (kumppanin maa, kun alv-koodi ei luokittele)', async () => {
      const c = await fresh();
      const ruotsi = await c.tallennaKumppani({ nimi: 'AB Exempel', maa: 'se' });
      const eu = await c.luoTosite({
        ...tasapainoinen('2026-06-01', 10000),
        kumppani: ruotsi.id,
        tila: 100,
      });
      const tuntematon = await c.luoTosite({ ...tasapainoinen('2026-06-02', 5000), tila: 100 });

      const tositteet = await c.listaaTositteet({});
      expect(tositteet.map((t) => [t.id, t.alkupera])).toEqual([
        [eu.id, 'eu'],
        [tuntematon.id, undefined],
      ]);
      expect((await c.listaaTulot({})).map((r) => [r.tosite, r.alkupera])).toEqual([
        [eu.id, 'eu'],
        [tuntematon.id, undefined],
      ]);
    });

    it('lisaaLiite: lokiin kirjattu lisäys luonnokselle, lukittu kausi hylätään molemmilla', async () => {
      const c = await fresh();
      const luonnos = await c.luoTosite({ ...tasapainoinen('2026-06-01', 10000), tila: 50 });
      const tavut = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const uusi = {
        tosite: luonnos.id,
        nimi: 'kuitti.pdf',
        tyyppi: 'application/pdf',
        sha: 'ab12',
        luotu: '2026-06-01T00:00:00.000Z',
        data: tavut,
      };
      const meta = await c.lisaaLiite(uusi);
      expect(meta).toMatchObject({ tosite: luonnos.id, nimi: 'kuitti.pdf' });
      expect((await c.haeLiite(meta.id))?.data).toEqual(tavut);
      expect((await c.haeTosite(luonnos.id))?.tila).toBe(50);

      const vanha = await c.luoTosite(tasapainoinen('2025-06-01', 5000));
      await c.paataTilikausi('2025-01-01');
      await expect(c.lisaaLiite({ ...uusi, tosite: vanha.id })).rejects.toMatchObject({
        code: 'PVMLUKITTU',
      });
      expect(await c.haeLiitteet(vanha.id)).toHaveLength(0);
    });

    it('posts a sales invoice (three-leg, numbered, referenced) identically on both transports', async () => {
      const c = await fresh();
      await c.paivitaAsetukset({
        AlvVelvollinen: 'true',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
      });
      await c.tallennaTili(1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await c.tallennaTili(2939, { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } });
      const lasku = await c.tallennaMyyntilasku({
        pvm: '2026-06-01',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
      });
      expect(lasku.numero).toBe('1');
      expect(lasku.viennit.find((v) => v.tili === 1701)?.debet).toBe(Euro.fromCents(12_550));
      expect(lasku.viennit.find((v) => v.tili === 3000)?.kredit).toBe(Euro.fromCents(10_000));
      expect(lasku.viennit.find((v) => v.tili === 2939)?.kredit).toBe(Euro.fromCents(2_550));
      expect(lasku.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
        lasku.viennit.reduce((a, v) => a + v.kredit, 0),
      );
    });

    it('lists invoices with avoin and settles via tallennaSuoritus on both transports', async () => {
      const c = await fresh();
      await c.paivitaAsetukset({
        AlvVelvollinen: 'true',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
        LaskuMaksutili: '1900',
      });
      await c.tallennaTili(1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await c.tallennaTili(2939, { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } });
      const lasku = await c.tallennaMyyntilasku({
        pvm: '2026-06-01',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
      });
      let lista = await c.listaaMyyntilaskut({});
      expect(lista).toHaveLength(1);
      expect(lista[0]?.summa).toBe(Euro.fromCents(12_550));
      expect(lista[0]?.avoin).toBe(Euro.fromCents(12_550));

      const suoritus = await c.tallennaSuoritus({
        tosite: lasku.id,
        pvm: '2026-06-15',
        summa: Euro.fromCents(12_550),
      });
      expect(suoritus.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
        suoritus.viennit.reduce((a, v) => a + v.kredit, 0),
      );

      lista = await c.listaaMyyntilaskut({});
      expect(lista[0]?.avoin).toBe(Euro.fromCents(0));
    });

    it('ostolasku: kirjaus, lista ja maksu identtiset molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.tallennaTili(4000, { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } });
      await c.tallennaTili(2870, { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } });
      const lasku = await c.tallennaOstolasku({
        pvm: '2025-03-01',
        laskupvm: '2025-03-01',
        erapvm: '2025-03-31',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 0, alvProsentti: 0, tili: 4000 }],
      });
      expect(lasku.tyyppi).toBe(100);
      const lista = await c.listaaOstolaskut({ avoin: true });
      expect(lista.find((r) => r.tosite === lasku.id)?.avoin).toBe(10_000);
      await c.tallennaSuoritus({
        tosite: lasku.id,
        pvm: '2025-04-01',
        summa: Euro.fromCents(10_000),
        rahatili: 1900,
      });
      expect((await c.listaaOstolaskut({ avoin: true })).some((r) => r.tosite === lasku.id)).toBe(
        false,
      );
    });

    it('maksuperusteinen: alv lykätään ja kohdistetaan maksettaessa identtisesti molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.paivitaAsetukset({
        AlvVelvollinen: 'true',
        MaksuAlvAlkaa: '2026-01-01',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        LaskuMaksutili: '1900',
        AlvVelkaTili: '2939', // real ALVVELKA-tili on validoitava vaikka maksuperusteinen ohjaa 2949:lle
      });
      await c.tallennaTili(1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await c.tallennaTili(2939, {
        numero: 2939,
        tyyppi: 'BL',
        nimi: { fi: 'Arvonlisäverovelka' },
      });
      await c.tallennaTili(2949, {
        numero: 2949,
        tyyppi: 'BLM',
        nimi: { fi: 'Kohdentamaton alv-velka' },
      });

      const lasku = await c.tallennaMyyntilasku({
        pvm: '2026-06-01',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
      });
      // Alv lykätään kohdentamattomalle tilille, ei aidolle ALVVELKA-tilille.
      expect(lasku.viennit.find((v) => v.tili === 2949)?.kredit).toBe(Euro.fromCents(2_550));
      expect(lasku.viennit.some((v) => v.tili === 2939)).toBe(false);

      await c.tallennaSuoritus({
        tosite: lasku.id,
        pvm: '2026-06-15',
        summa: Euro.fromCents(12_550),
      });
      const laskelma = await c.haeAlvLaskelma({ alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(laskelma.koodit.get(301)).toBe(Euro.fromCents(2_550));
      // Lasku on täysin maksettu.
      expect((await c.listaaMyyntilaskut({})).find((r) => r.tosite === lasku.id)?.avoin).toBe(
        Euro.fromCents(0),
      );
    });

    it('maksuperusteinen: vanhennus kirjaa yli 12 kk vanhan myynnin veron identtisesti molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.paivitaAsetukset({
        AlvVelvollinen: 'true',
        MaksuAlvAlkaa: '2020-01-01',
        AlvVelkaTili: '2939',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        LaskuMaksutili: '1900',
      });
      await c.tallennaTili(1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await c.tallennaTili(2939, {
        numero: 2939,
        tyyppi: 'BL',
        nimi: { fi: 'Arvonlisäverovelka' },
      });
      await c.tallennaTili(2949, {
        numero: 2949,
        tyyppi: 'BLM',
        nimi: { fi: 'Kohdentamaton alv-velka' },
      });
      const lasku = await c.tallennaMyyntilasku({
        pvm: '2025-01-15',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }],
      });
      const sweep = await c.vanhennaMaksuperusteinenAlv({ loppupvm: '2026-06-30' });
      expect(sweep?.tyyppi).toBe(1000);
      expect(sweep?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit).toBe(
        Euro.fromCents(2_550),
      );
      expect(sweep?.viennit.find((v) => v.alvKoodi === 118)?.maksuperusteinenTosite).toBe(lasku.id);
      expect(await c.vanhennaMaksuperusteinenAlv({ loppupvm: '2026-06-30' })).toBeNull();
    });

    it('marginaalivero: kirjaaMarginaalivero kirjaa koodi-113-veron 2939:lle identtisesti molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.tallennaTili(3010, { numero: 3010, tyyppi: 'CL', nimi: { fi: 'Marginaalimyynti' } });
      await c.tallennaTili(4000, { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } });
      await c.tallennaTili(2939, {
        numero: 2939,
        tyyppi: 'BL',
        nimi: { fi: 'Arvonlisäverovelka' },
      });
      await c.paivitaAsetukset({ AlvVelvollinen: 'true' });

      // Marginaalimyynti 100 000 (alvKoodi 13, 25,5 %).
      await c.luoTosite({
        pvm: '2026-06-05',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: Euro.fromCents(100_000),
            kredit: Euro.fromCents(0),
            pvm: '2026-06-05',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3010,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(100_000),
            pvm: '2026-06-05',
            alvKoodi: 13,
            alvProsentti: 25.5,
          },
        ],
      });
      // Marginaaliosto 60 000 (alvKoodi 23, 25,5 %).
      await c.luoTosite({
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: Euro.fromCents(60_000),
            kredit: Euro.fromCents(0),
            pvm: '2026-06-10',
            alvKoodi: 23,
            alvProsentti: 25.5,
          },
          {
            tili: 1900,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(60_000),
            pvm: '2026-06-10',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      });

      // margin 40 000; vero = roundHalfAway(2550*40000/12550) = roundHalfAway(8127.4900...) = 8127
      const odotettuVero = Euro.fromCents(8_127);
      const tosite = await c.kirjaaMarginaalivero({
        alkupvm: '2026-06-01',
        loppupvm: '2026-06-30',
      });
      expect(tosite?.tyyppi).toBe(9105); // MARGINAALILASKELMA
      expect(tosite?.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 113)?.kredit).toBe(
        odotettuVero,
      );

      // Kaudella ilman marginaalitoimintaa ei ole mitään kirjattavaa -> null.
      expect(
        await c.kirjaaMarginaalivero({ alkupvm: '2026-07-01', loppupvm: '2026-07-31' }),
      ).toBeNull();
    });

    it('hyvityslasku: myyntilaskun hyvitys nollaa avoimen molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.paivitaAsetukset({
        LaskuSaatavaTili: '1700',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
      });
      await c.tallennaTili(1700, { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' } });
      await c.tallennaTili(2939, { numero: 2939, tyyppi: 'BL', nimi: { fi: 'ALV-velka' } });
      const lasku = await c.tallennaMyyntilasku({
        pvm: '2025-03-01',
        rivit: [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5, tili: 3000 }],
      });
      const hyv = await c.tallennaHyvityslasku({ alkuperainenTosite: lasku.id, pvm: '2025-03-15' });
      expect(hyv.tyyppi).toBe(214);
      expect(hyv.alkuperainenTosite).toBe(lasku.id);
      expect((await c.listaaMyyntilaskut({})).find((r) => r.tosite === lasku.id)?.avoin).toBe(0);
    });

    it('alv: laskelma ja tilitys toimivat identtisesti molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.tallennaTili(1763, {
        numero: 1763,
        tyyppi: 'AL',
        nimi: { fi: 'Arvonlisäverosaatava' },
      });
      await c.tallennaTili(2939, {
        numero: 2939,
        tyyppi: 'BL',
        nimi: { fi: 'Arvonlisäverovelka' },
      });
      await c.tallennaTili(2940, { numero: 2940, tyyppi: 'BV', nimi: { fi: 'Verovelka' } });
      await c.paivitaAsetukset({ AlvVelvollinen: 'true' });

      // Kotimaan nettomyynti 100,00 + alv 25,50.
      await c.luoTosite({
        pvm: '2026-06-05',
        tyyppi: 200,
        sarja: '',
        tila: 100,
        viennit: [
          {
            tili: 1900,
            debet: Euro.fromCents(12550),
            kredit: Euro.fromCents(0),
            pvm: '2026-06-05',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(10000),
            pvm: '2026-06-05',
            alvKoodi: 11,
            alvProsentti: 25.5,
          },
          {
            tili: 2939,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(2550),
            pvm: '2026-06-05',
            alvKoodi: 111,
            alvProsentti: 25.5,
          },
        ],
      });

      const laskelma = await c.haeAlvLaskelma({ alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(laskelma.koodit.get(301)).toBe(2550);
      expect(laskelma.koodit.get(308)).toBe(2550);
      expect(laskelma.maksettava).toBe(2550);

      const tilitys = await c.tallennaAlvTilitys({ alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(tilitys.tyyppi).toBe(9100); // ALVLASKELMA
      expect(tilitys.tunniste).toBeGreaterThanOrEqual(1);
      const debet = tilitys.viennit.reduce((sum, v) => sum + v.debet, 0);
      const kredit = tilitys.viennit.reduce((sum, v) => sum + v.kredit, 0);
      expect(debet).toBe(kredit);

      // Ilmoitettu kausi hylkää uuden alv-koodatun viennin molemmilla siirtotavoilla (422/EIVALMISTU).
      await expect(
        c.luoTosite({
          pvm: '2026-06-20',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            {
              tili: 1900,
              debet: Euro.fromCents(1255),
              kredit: Euro.fromCents(0),
              pvm: '2026-06-20',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(1000),
              pvm: '2026-06-20',
              alvKoodi: 11,
              alvProsentti: 25.5,
            },
            {
              tili: 2939,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(255),
              pvm: '2026-06-20',
              alvKoodi: 111,
              alvProsentti: 25.5,
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'EIVALMISTU' });
    });

    it('tilikauden lukitus estää ja avaus sallii kirjauksen; tilinavaus kirjaa alkusaldot (molemmat siirtotavat)', async () => {
      const c = await fresh();

      // Lukitse 2025 -> kirjaus 2025:lle hylätään PVMLUKITTU:lla molemmilla siirtotavoilla.
      await c.paataTilikausi('2025-01-01');
      await expect(
        c.luoTosite({ ...tasapainoinen('2025-06-01', 10_000), tila: 100 }),
      ).rejects.toMatchObject({ code: 'PVMLUKITTU' });

      // Avaa 2025 -> sama kirjaus onnistuu.
      await c.avaaTilikausi('2025-01-01');
      const t = await c.luoTosite({ ...tasapainoinen('2025-06-01', 10_000), tila: 100 });
      expect(t.tila).toBe(100);

      // Tilinavaus: 1900 debet / 2251 kredit.
      const avaus = await c.luoTilinavaus({
        pvm: '2025-01-01',
        saldot: [
          { tili: 1900, saldo: Euro.fromCents(20_000) },
          { tili: 2251, saldo: Euro.fromCents(20_000) },
        ],
      });
      expect(avaus.tyyppi).toBe(9010); // TILINAVAUS
      expect(avaus.viennit.find((v) => v.tili === 1900)?.debet).toBe(20_000);
      expect(avaus.viennit.find((v) => v.tili === 2251)?.kredit).toBe(20_000);
    });

    it('lukittu kausi estää kirjatun tositteen poiston molemmilla siirtotavoilla (PVMLUKITTU)', async () => {
      const c = await fresh();
      // Kirjaa 2025:lle ennen lukitusta.
      const t = await c.luoTosite({ ...tasapainoinen('2025-06-01', 10_000), tila: 100 });
      await c.paataTilikausi('2025-01-01');
      await expect(c.poistaTosite(t.id)).rejects.toMatchObject({ code: 'PVMLUKITTU' });
    });

    it('alv-ilmoitus ja yhteisömyynti toimivat identtisesti molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.tallennaTili(2939, {
        numero: 2939,
        tyyppi: 'BL',
        nimi: { fi: 'Arvonlisäverovelka' },
      });
      await c.paivitaAsetukset({ AlvVelvollinen: 'true' });
      const asiakas = await c.tallennaKumppani({
        nimi: 'EU Ostaja GmbH',
        alvtunnus: 'DE999999999',
        maa: 'de',
      });

      // Kotimaan 25,5 % myynti.
      await c.luoTosite({
        pvm: '2026-06-05',
        tyyppi: 200,
        sarja: '',
        tila: 100,
        viennit: [
          {
            tili: 1900,
            debet: Euro.fromCents(12550),
            kredit: Euro.fromCents(0),
            pvm: '2026-06-05',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(10000),
            pvm: '2026-06-05',
            alvKoodi: 11,
            alvProsentti: 25.5,
          },
          {
            tili: 2939,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(2550),
            pvm: '2026-06-05',
            alvKoodi: 111,
            alvProsentti: 25.5,
          },
        ],
      });
      // EU-tavaramyynti (koodi 14) asiakkaalle.
      await c.luoTosite({
        pvm: '2026-06-10',
        tyyppi: 200,
        sarja: '',
        tila: 100,
        kumppani: asiakas.id,
        viennit: [
          {
            tili: 1900,
            debet: Euro.fromCents(8000),
            kredit: Euro.fromCents(0),
            pvm: '2026-06-10',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 3000,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(8000),
            pvm: '2026-06-10',
            alvKoodi: 14,
            alvProsentti: 0,
          },
        ],
      });

      const ilmoitus = await c.haeAlvIlmoitus({ alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(ilmoitus.koodit.get(301)).toBe(2550);
      expect(ilmoitus.koodit.get(311)).toBe(8000);
      expect(ilmoitus.kausityyppi).toBe('K');
      expect(ilmoitus.nolla).toBe(false);

      const eu = await c.haeEuMyyntiYhteenveto({ alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(eu.rivit).toHaveLength(1);
      expect(eu.rivit[0]?.tavara).toBe(8000);
      expect(eu.rivit[0]?.alvtunnus).toBe('DE999999999');
      expect(eu.puuttuviaTunnuksia).toBe(false);

      const erittely = await c.haeAlvErittely({ alkupvm: '2026-06-01', loppupvm: '2026-06-30' });
      expect(erittely.rivit.map((r) => [r.alvKoodi, r.tili, r.summa])).toEqual([
        [11, 3000, 10000],
        [14, 3000, 8000],
        [111, 2939, 2550],
      ]);
      const euRivi = erittely.rivit[1];
      expect(euRivi?.kumppani).toBe('EU Ostaja GmbH');
      expect(euRivi?.tositePvm).toBe('2026-06-10');
      expect(typeof euRivi?.tosite).toBe('number');
      expect(euRivi?.tositeNumero).not.toBe('');
    });

    it('tulovero: verolaskelma ja jaksotuskirjaus identtiset molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.tallennaTili(5000, { numero: 5000, tyyppi: 'DH', nimi: { fi: 'Edustus' } });
      await c.tallennaTili(1770, { numero: 1770, tyyppi: 'DVE', nimi: { fi: 'Ennakkoverot' } });
      await c.tallennaTili(9940, { numero: 9940, tyyppi: 'DZ', nimi: { fi: 'Verojaksotus' } });
      await c.tallennaTili(2968, { numero: 2968, tyyppi: 'B', nimi: { fi: 'Siirtovelat' } });
      // Tulo 50 000.
      await c.luoTosite({ ...tasapainoinen('2026-03-01', 50_000), tila: 100 });

      const l = await c.haeVerolaskelma({ alkupvm: '2026-01-01', loppupvm: '2026-12-31' });
      expect(l.tulo).toBe(50_000);
      expect(l.vero).toBe(10_000);
      expect(l.jaaveroa).toBe(10_000);
      expect(l.joKirjattu).toBe(false);

      const tosite = await c.tallennaTulovero({ alkupvm: '2026-01-01', loppupvm: '2026-12-31' });
      expect(tosite.tyyppi).toBe(9930);
      expect(tosite.viennit.find((v) => v.tili === 9940)?.debet).toBe(10_000);
      expect(tosite.viennit.find((v) => v.tili === 2968)?.kredit).toBe(10_000);
    });

    it('poistot: menojäännöspoisto ja POISTOLASKELMA identtiset molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.tallennaTili(1120, {
        numero: 1120,
        tyyppi: 'APM',
        nimi: { fi: 'Koneet' },
        menojaannospoisto: 25,
        poistotili: 6820,
      });
      await c.tallennaTili(6820, { numero: 6820, tyyppi: 'DP', nimi: { fi: 'Poistot' } });
      // Hankinta 100 000: DEBET 1120 / KREDIT 1900.
      await c.luoTosite({
        pvm: '2026-03-01',
        tyyppi: 0,
        sarja: '',
        tila: 100,
        viennit: [
          {
            tili: 1120,
            debet: Euro.fromCents(100_000),
            kredit: Euro.fromCents(0),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 1900,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(100_000),
            pvm: '2026-03-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      });

      const l = await c.haePoistolaskelma({ loppupvm: '2026-12-31' });
      expect(l.rivit).toHaveLength(1);
      expect(l.rivit[0]?.poisto).toBe(25_000);
      expect(l.yhteensa).toBe(25_000);
      expect(l.joKirjattu).toBe(false);

      const tosite = await c.tallennaPoistot({ loppupvm: '2026-12-31' });
      expect(tosite.tyyppi).toBe(9910);
      expect(tosite.viennit.find((v) => v.tili === 1120)?.kredit).toBe(25_000);
      expect(tosite.viennit.find((v) => v.tili === 6820)?.debet).toBe(25_000);
    });

    it('jaksotukset: päätös- ja purkukirjaus identtiset molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.tallennaTili(1774, { numero: 1774, tyyppi: 'AJ', nimi: { fi: 'Siirtosaamiset' } });
      await c.tallennaTili(2925, { numero: 2925, tyyppi: 'BJ', nimi: { fi: 'Siirtovelat' } });
      // Etukäteen maksettu kulu 2025-11-01, jakso 2025-11-01..2026-10-31.
      await c.luoTosite({
        pvm: '2025-11-01',
        tyyppi: 0,
        sarja: '',
        tila: 100,
        viennit: [
          {
            tili: 3000,
            debet: Euro.fromCents(36_500),
            kredit: Euro.fromCents(0),
            pvm: '2025-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
            jaksoalkaa: '2025-11-01',
            jaksoloppuu: '2026-10-31',
          },
          {
            tili: 1900,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(36_500),
            pvm: '2025-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      });
      const l = await c.haeJaksotukset({ loppupvm: '2025-12-31' });
      expect(l.rivit).toHaveLength(1);
      const paatos = await c.tallennaJaksotukset({ loppupvm: '2025-12-31' });
      expect(paatos.tyyppi).toBe(9920);
      const d = paatos.viennit.reduce((a, v) => a + v.debet, 0);
      const k = paatos.viennit.reduce((a, v) => a + v.kredit, 0);
      expect(d).toBe(k);
    });

    it('jaksotukset: JOJAKSOTETTU-koodi säilyy identtisenä molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      await c.tallennaTili(1774, { numero: 1774, tyyppi: 'AJ', nimi: { fi: 'Siirtosaamiset' } });
      await c.tallennaTili(2925, { numero: 2925, tyyppi: 'BJ', nimi: { fi: 'Siirtovelat' } });
      await c.luoTosite({
        pvm: '2025-11-01',
        tyyppi: 0,
        sarja: '',
        tila: 100,
        viennit: [
          {
            tili: 3000,
            debet: Euro.fromCents(36_500),
            kredit: Euro.fromCents(0),
            pvm: '2025-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
            jaksoalkaa: '2025-11-01',
            jaksoloppuu: '2026-10-31',
          },
          {
            tili: 1900,
            debet: Euro.fromCents(0),
            kredit: Euro.fromCents(36_500),
            pvm: '2025-11-01',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      });
      await c.tallennaJaksotukset({ loppupvm: '2025-12-31' });
      // Uusintakirjaus -> JOJAKSOTETTU (400-perheen koodi): sama todellinen koodi molemmilla siirtotavoilla.
      await expect(c.tallennaJaksotukset({ loppupvm: '2025-12-31' })).rejects.toMatchObject({
        code: 'JOJAKSOTETTU',
      });
    });

    it('tilinpäätös: laadinta, liitetiedot ja vahvistuksen peruminen identtiset molemmilla siirtotavoilla', async () => {
      const c = await fresh();
      // Lisää tase-kaava (tulos/yleinen on jo siemenessä) — additiivinen, ei kosketa SEEDiä.
      await c.paivitaAsetukset({
        'tase/yleinen': JSON.stringify({
          nimi: { fi: 'Tase' },
          rivit: [{ fi: 'Vastaavaa', L: '1' }],
        }),
      });
      await c.luoTosite({ ...tasapainoinen('2026-06-01', 10_000), tila: 100 });

      // Molemmat kaudet on lukittava vanhimmasta uusimpaan ennen vahvistusta.
      await c.paataTilikausi('2025-01-01');
      await c.paataTilikausi('2026-01-01');

      // Liitetiedot tallennetaan ennen vahvistusta — vahvistettua tilinpäätöstä ei saa enää
      // muokata (JOVAHVISTETTU), joten järjestys on tallenna -> vahvista -> lue.
      await c.tallennaLiitetiedot({ loppupvm: '2026-12-31', teksti: 'X' });
      await c.vahvistaTilinpaatos({ alkaa: '2026-01-01' });

      let doc = await c.haeTilinpaatos({ alkaa: '2026-01-01' });
      expect(doc.vahvistettu).not.toBeNull();
      expect(doc.liitetiedot).toBe('X');
      expect(doc.tuloslaskelma.length).toBeGreaterThan(0);
      const liikevaihto = doc.tuloslaskelma.find((r) => r.teksti === 'Liikevaihto');
      expect(liikevaihto?.arvo).toBe(Euro.fromCents(10_000));

      await c.peruVahvistus({ alkaa: '2026-01-01' });
      doc = await c.haeTilinpaatos({ alkaa: '2026-01-01' });
      expect(doc.vahvistettu).toBeNull();
    });
  });
}
