import type { KpClient } from '@penni/asiakas';
import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { CLIENT_CONFORMANCE_SEED, type ClientConformanceSeed } from './conformance.js';

type MakeClient = (seed: ClientConformanceSeed) => Promise<KpClient> | KpClient;

/**
 * Laskutuksen lisät: asiakasrajapinnan yhteinen käyttäytyminen molemmilla siirtotavoilla
 * (InProcessClient ja HttpClient). Myöhemmät tehtävät lisäävät tänne tapauksia.
 */
export function runLaskutusClientConformance(name: string, makeClient: MakeClient): void {
  describe(`KpClient laskutus: ${name}`, () => {
    /** Tuore asiakas, jolla on laskutuksen tili- ja alv-asetukset. */
    const fresh = async () => {
      const c = await makeClient(CLIENT_CONFORMANCE_SEED);
      await c.paivitaAsetukset({
        AlvVelvollinen: 'true',
        LaskuSaatavaTili: '1701',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
      });
      await c.tallennaTili(1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
      await c.tallennaTili(2939, { numero: 2939, tyyppi: 'CV', nimi: { fi: 'Suoritettava alv' } });
      return c;
    };

    const rivit = [{ myyntiKpl: 1, aNetto: 100, alvKoodi: 11, alvProsentti: 25.5 }];

    it('luonnos tallentuu, listautuu ja kirjautuu', async () => {
      const c = await fresh();
      const asiakas = await c.tallennaKumppani({ nimi: 'Luonnosasiakas Oy' });
      const luonnos = await c.tallennaMyyntilasku({
        pvm: '2026-06-01',
        kumppani: asiakas.id,
        otsikko: 'Kesäkuun työt',
        rivit,
        luonnos: true,
      });
      expect(luonnos.tila).toBe(80);
      expect(luonnos.numero).toBeUndefined();
      expect(luonnos.viennit).toHaveLength(0);

      const lista = await c.listaaLaskuluonnokset();
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({
        tosite: luonnos.id,
        tila: 80,
        pvm: '2026-06-01',
        kumppani: asiakas.id,
        asiakas: 'Luonnosasiakas Oy',
        otsikko: 'Kesäkuun työt',
        summa: 12_550,
      });

      const kirjattu = await c.kirjaaLaskuluonnos(luonnos.id);
      expect(kirjattu.id).toBe(luonnos.id);
      expect(kirjattu.tila).toBe(100);
      expect(kirjattu.numero).toBe('1');
      expect(kirjattu.viennit.length).toBeGreaterThan(0);

      expect(await c.listaaLaskuluonnokset()).toEqual([]);
    });

    it('luonnos säilyttää uudet kentät tallennuksessa ja kirjautuu muutoksilla', async () => {
      const c = await fresh();
      const luonnos = await c.tallennaMyyntilasku({
        pvm: '2026-06-01',
        rivit,
        luonnos: true,
        jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
        info: 'Lisätieto',
        viivkorko: 8,
        ryhma: 'ryhma-1',
        toistoPvm: '2026-06-01',
      });
      expect(luonnos.tila).toBe(80);
      expect(luonnos.numero).toBeUndefined();
      expect(luonnos.jakso).toEqual({ alkaa: '2026-05-01', loppuu: '2026-05-31' });
      expect(luonnos.info).toBe('Lisätieto');
      expect(luonnos.viivkorko).toBe(8);
      expect(luonnos.ryhma).toBe('ryhma-1');
      expect(luonnos.toistoPvm).toBe('2026-06-01');

      const rivi = (await c.listaaLaskuluonnokset())[0];
      expect(rivi?.ryhma).toBe('ryhma-1');

      const kirjattu = await c.kirjaaLaskuluonnos(luonnos.id, {
        erapvm: '2026-06-20',
        jakso: { alkaa: '2026-05-02', loppuu: '2026-05-30' },
      });
      expect(kirjattu.tila).toBe(100);
      expect(kirjattu.erapvm).toBe('2026-06-20');
      expect(kirjattu.jakso).toEqual({ alkaa: '2026-05-02', loppuu: '2026-05-30' });
      expect(kirjattu.viivkorko).toBe(8);
      expect(kirjattu.ryhma).toBe('ryhma-1');
    });

    it('päivittää olemassa olevan luonnoksen id:llä', async () => {
      const c = await fresh();
      const luonnos = await c.tallennaMyyntilasku({ pvm: '2026-06-01', rivit, luonnos: true });
      const paivitetty = await c.tallennaMyyntilasku({
        id: luonnos.id,
        pvm: '2026-06-02',
        rivit,
        luonnos: true,
      });
      expect(paivitetty.id).toBe(luonnos.id);
      expect(paivitetty.pvm).toBe('2026-06-02');
      expect(await c.listaaLaskuluonnokset()).toHaveLength(1);
    });

    it('kirjattua tai tuntematonta tositetta ei voi kirjata luonnoksena (EILUONNOS)', async () => {
      const c = await fresh();
      const lasku = await c.tallennaMyyntilasku({ pvm: '2026-06-01', rivit });
      await expect(c.kirjaaLaskuluonnos(lasku.id)).rejects.toMatchObject({ code: 'EILUONNOS' });
      await expect(c.kirjaaLaskuluonnos(99_999)).rejects.toMatchObject({ code: 'EILUONNOS' });
    });

    describe('maksumuistutus', () => {
      /** Erääntynyt lasku (125,50 €, eräpäivä 30.4.) ja muistutuksen tilit. */
      const erantynyt = async () => {
        const c = await fresh();
        await c.tallennaTili(9170, { numero: 9170, tyyppi: 'C', nimi: { fi: 'Korkotuotot' } });
        await c.paivitaAsetukset({
          LaskuMaksumuistutustili: '9170',
          LaskuViivastyskorkotili: '9170',
        });
        const lasku = await c.tallennaMyyntilasku({
          pvm: '2026-04-01',
          erapvm: '2026-04-30',
          rivit,
        });
        return { c, lasku };
      };

      it('muistutus luodaan ja kirjataan', async () => {
        const { c, lasku } = await erantynyt();
        const luodut = await c.luoMaksumuistutukset({
          tositteet: [lasku.id],
          pvm: '2026-05-30',
          korko: false,
        });
        expect(luodut).toHaveLength(1);
        expect(luodut[0]).toMatchObject({
          tyyppi: 216,
          tila: 80,
          alkuperainenTosite: lasku.id,
          muistutus: { maksu: 500, korko: 0, aiempiSaldo: 12_550 },
        });
        expect(luodut[0]?.numero).toBeUndefined();

        const luonnokset = await c.listaaLaskuluonnokset();
        expect(luonnokset).toHaveLength(1);
        expect(luonnokset[0]).toMatchObject({
          tosite: luodut[0]?.id,
          tyyppi: 216,
          alkuperainenTosite: lasku.id,
          summa: 500,
        });

        const kirjattu = await c.kirjaaLaskuluonnos(luodut[0]?.id as number);
        expect(kirjattu).toMatchObject({ id: luodut[0]?.id, tila: 100, tyyppi: 216, numero: '2' });
        expect(kirjattu.viennit.length).toBeGreaterThan(0);
        expect(await c.listaaLaskuluonnokset()).toEqual([]);
      });

      it('kirjattu muistutus ja muistutettu lasku näkyvät Tuloissa ja Lähtevissä', async () => {
        const { c, lasku } = await erantynyt();
        const [luonnos] = await c.luoMaksumuistutukset({
          tositteet: [lasku.id],
          pvm: '2026-05-30',
          korko: false,
        });
        const muistutus = await c.kirjaaLaskuluonnos(luonnos?.id as number);

        for (const rivit of [await c.listaaTulot({}), await c.listaaMyyntilaskut({})]) {
          expect(rivit.find((r) => r.tosite === muistutus.id)).toMatchObject({
            muistutus: true,
            avoin: 0,
            summa: 500,
          });
          expect(rivit.find((r) => r.tosite === lasku.id)).toMatchObject({
            muistutettu: 1,
            avoin: 13_050,
          });
          expect(rivit.find((r) => r.tosite === lasku.id)?.muistutus).toBeUndefined();
        }
      });

      it('erääntymätön lasku → EIMUISTUTETTAVA ja virheellinen maksu → EIMUISTUTUSARVO', async () => {
        const { c, lasku } = await erantynyt();
        await expect(
          c.luoMaksumuistutukset({ tositteet: [lasku.id], pvm: '2026-04-20', korko: false }),
        ).rejects.toMatchObject({ code: 'EIMUISTUTETTAVA' });
        await expect(
          c.luoMaksumuistutukset({
            tositteet: [lasku.id],
            pvm: '2026-05-30',
            korko: false,
            maksu: -100 as Cents,
          }),
        ).rejects.toMatchObject({ code: 'EIMUISTUTUSARVO' });
      });
    });

    describe('rekisterit', () => {
      it('tuote: tallennus, päivitys ja poisto; hinta säilyy euroina', async () => {
        const c = await fresh();
        const t = await c.tallennaTuote({
          nimike: 'Asiantuntijatyö',
          unKoodi: 'HUR',
          aNetto: 80.5,
          alvKoodi: 1,
          alvProsentti: 25.5,
          tili: 3000,
          koodi: 'TYO',
        });
        expect(t.id).toBeGreaterThan(0);
        expect(t).toMatchObject({ nimike: 'Asiantuntijatyö', aNetto: 80.5, unKoodi: 'HUR' });
        expect(await c.haeTuotteet()).toEqual([t]);

        const paivitetty = await c.tallennaTuote({ ...t, aNetto: 90 });
        expect(paivitetty).toMatchObject({ id: t.id, aNetto: 90 });
        expect(await c.haeTuotteet()).toHaveLength(1);

        await c.poistaTuote(t.id);
        expect(await c.haeTuotteet()).toEqual([]);
      });

      it('vakioviite: automaattinen numerointi, käsinvalinta, uudelleennimeäminen ja poisto', async () => {
        const c = await fresh();
        const a = await c.tallennaVakioviite({ tili: 3000, otsikko: 'Jäsenmaksu' });
        const b = await c.tallennaVakioviite({ tili: 3000, kohdennus: 2, otsikko: 'Lahjoitus' });
        const d = await c.tallennaVakioviite({ tili: 3000, otsikko: 'Muu' });
        expect([a.viite, b.viite, d.viite]).toEqual(['1009', '1012', '1025']);
        expect(b).toMatchObject({ tili: 3000, kohdennus: 2, otsikko: 'Lahjoitus' });
        expect((await c.haeVakioviitteet()).map((v) => v.viite)).toEqual(['1009', '1012', '1025']);

        // Muokkaus samalla viitteellä ei ole VIITEKAYTOSSA; viitteen vaihto poistaa vanhan.
        await c.tallennaVakioviite({
          viite: '1009',
          vanhaViite: '1009',
          tili: 3000,
          otsikko: 'Jäsenmaksu 2026',
        });
        const siirretty = await c.tallennaVakioviite({
          viite: '2008',
          vanhaViite: '1009',
          tili: 3000,
          otsikko: 'Jäsenmaksu 2026',
        });
        expect(siirretty.viite).toBe('2008');
        expect((await c.haeVakioviitteet()).map((v) => v.viite)).toEqual(['1012', '1025', '2008']);

        await c.poistaVakioviite('2008');
        expect((await c.haeVakioviitteet()).map((v) => v.viite)).toEqual(['1012', '1025']);
      });

      it('vakioviite: virhekoodit EIVIITE, VIITEKAYTOSSA, EITILIA ja EIOTSIKKOA', async () => {
        const c = await fresh();
        await c.tallennaVakioviite({ tili: 3000, otsikko: 'Ensimmäinen' });
        await expect(
          c.tallennaVakioviite({ viite: '1009', tili: 3000, otsikko: 'Kaksi' }),
        ).rejects.toMatchObject({ code: 'VIITEKAYTOSSA' });
        for (const viite of ['1234', '0123', '12345672']) {
          await expect(
            c.tallennaVakioviite({ viite, tili: 3000, otsikko: 'Väärä' }),
          ).rejects.toMatchObject({ code: 'EIVIITE' });
        }
        await expect(c.tallennaVakioviite({ tili: 3000, otsikko: '' })).rejects.toMatchObject({
          code: 'EIOTSIKKOA',
        });
        await expect(
          c.tallennaVakioviite({ otsikko: 'Ei tiliä' } as unknown as Parameters<
            KpClient['tallennaVakioviite']
          >[0]),
        ).rejects.toMatchObject({ code: 'EITILIA' });
      });

      it('toisto: tallennus pohjariveineen, päivitys ja poisto', async () => {
        const c = await fresh();
        const asiakas = await c.tallennaKumppani({ nimi: 'Toistoasiakas Oy' });
        const t = await c.tallennaToisto({
          nimi: 'Kuukausilaskutus',
          kumppani: asiakas.id,
          kuukausia: 1,
          seuraava: '2026-07-01',
          loppuu: '2026-12-31',
          aktiivinen: true,
          pohja: {
            otsikko: 'Ylläpito',
            maksutapa: 1,
            maksuaikaPaivia: 14,
            jakso: { alkaa: '2026-07-01', loppuu: '2026-07-31' },
            rivit: [
              {
                myyntiKpl: 2,
                aNetto: 49.9,
                alvKoodi: 1,
                alvProsentti: 25.5,
                selite: 'Palvelu',
                tili: 3000,
              },
              { myyntiKpl: 1, aNetto: 10, alvKoodi: 0, alvProsentti: 0, tuote: 5 },
            ],
          },
        });
        expect(t.id).toBeGreaterThan(0);
        expect(t).toMatchObject({
          nimi: 'Kuukausilaskutus',
          kumppani: asiakas.id,
          kuukausia: 1,
          seuraava: '2026-07-01',
          loppuu: '2026-12-31',
          aktiivinen: true,
        });
        expect(t.pohja).toMatchObject({
          otsikko: 'Ylläpito',
          maksutapa: 1,
          maksuaikaPaivia: 14,
          jakso: { alkaa: '2026-07-01', loppuu: '2026-07-31' },
        });
        expect(t.pohja.rivit).toEqual([
          {
            myyntiKpl: 2,
            aNetto: 49.9,
            alvKoodi: 1,
            alvProsentti: 25.5,
            selite: 'Palvelu',
            tili: 3000,
          },
          { myyntiKpl: 1, aNetto: 10, alvKoodi: 0, alvProsentti: 0, tuote: 5 },
        ]);
        expect(await c.haeToistot()).toEqual([t]);

        const paivitetty = await c.tallennaToisto({
          ...t,
          seuraava: '2026-08-01',
          aktiivinen: false,
        });
        expect(paivitetty).toMatchObject({ id: t.id, seuraava: '2026-08-01', aktiivinen: false });
        expect(await c.haeToistot()).toHaveLength(1);

        await c.poistaToisto(t.id);
        expect(await c.haeToistot()).toEqual([]);
      });
    });

    describe('toistuvat laskut', () => {
      it('toisto kirjatusta laskusta ja erääntyneen luonnoksen luonti', async () => {
        const c = await fresh();
        const asiakas = await c.tallennaKumppani({ nimi: 'Toistoasiakas Oy' });
        const lasku = await c.tallennaMyyntilasku({
          pvm: '2026-05-31',
          erapvm: '2026-06-14',
          kumppani: asiakas.id,
          otsikko: 'Toukokuu',
          rivit,
        });
        const t = await c.luoToistoLaskusta({ tosite: lasku.id, kuukausia: 1, nimi: 'Ylläpito' });
        expect(t).toMatchObject({
          nimi: 'Ylläpito',
          kumppani: asiakas.id,
          kuukausia: 1,
          seuraava: '2026-06-30',
          lahdeTosite: lasku.id,
          aktiivinen: true,
        });
        expect(t.pohja).toMatchObject({ otsikko: 'Toukokuu', maksutapa: 0, maksuaikaPaivia: 14 });
        expect(t.pohja.rivit).toEqual(rivit);

        const tulos = await c.luoErantyneetToistot('2026-07-05');
        expect(tulos.ohitettu).toBeUndefined();
        expect(tulos.luodut).toHaveLength(1);
        const lista = await c.listaaLaskuluonnokset();
        expect(lista).toHaveLength(1);
        expect(lista[0]).toMatchObject({
          tosite: tulos.luodut[0],
          toisto: t.id,
          pvm: '2026-06-30',
          kumppani: asiakas.id,
          summa: 12_550,
        });
        expect((await c.haeToistot())[0]?.seuraava).toBe('2026-07-31');

        expect(await c.luoErantyneetToistot('2026-07-05')).toEqual({ luodut: [] });
      });

      it('toisto vain kirjatusta laskusta; tilikaudeton päivä ohitetaan', async () => {
        const c = await fresh();
        await expect(c.luoToistoLaskusta({ tosite: 999, kuukausia: 1 })).rejects.toMatchObject({
          code: 'EITOSITETTA',
        });
        const lasku = await c.tallennaMyyntilasku({ pvm: '2026-05-31', rivit });
        await expect(c.luoToistoLaskusta({ tosite: lasku.id, kuukausia: 0 })).rejects.toMatchObject(
          { code: 'EIKUUKAUSIA' },
        );
        await c.luoToistoLaskusta({ tosite: lasku.id, kuukausia: 1 });
        expect(await c.luoErantyneetToistot('2027-07-05')).toEqual({
          luodut: [],
          ohitettu: 'EITILIKAUTTA',
        });
      });
    });

    describe('toistuvat laskut: virheet', () => {
      it('epäonnistuva toisto palautetaan, muut luodaan; virheelliset päivät hylätään', async () => {
        const c = await fresh();
        const lasku = await c.tallennaMyyntilasku({ pvm: '2026-05-31', rivit });
        await expect(
          c.luoToistoLaskusta({ tosite: lasku.id, kuukausia: 1, seuraava: '2026-02-30' }),
        ).rejects.toMatchObject({ code: 'EITOISTOPVM' });
        await expect(
          c.luoToistoLaskusta({
            tosite: lasku.id,
            kuukausia: 1,
            seuraava: '2026-06-30',
            loppuu: '2026-06-29',
          }),
        ).rejects.toMatchObject({ code: 'EITOISTOPVM' });
        const ehja = await c.luoToistoLaskusta({ tosite: lasku.id, kuukausia: 1 });
        const rikki = await c.tallennaToisto({
          nimi: 'Rivitön',
          kuukausia: 1,
          seuraava: '2026-06-30',
          aktiivinen: true,
          pohja: { maksutapa: 0, rivit: [], maksuaikaPaivia: 14 },
        });
        const tulos = await c.luoErantyneetToistot('2026-07-05');
        expect(tulos.luodut).toHaveLength(1);
        expect(tulos.epaonnistuneet).toEqual([
          { toisto: rikki.id, nimi: 'Rivitön', virhe: 'EIRIVEJA' },
        ]);
        const toistot = await c.haeToistot();
        expect(toistot.find((t) => t.id === ehja.id)?.seuraava).toBe('2026-07-31');
        expect(toistot.find((t) => t.id === rikki.id)?.seuraava).toBe('2026-06-30');
      });
    });

    describe('ennakkolaskut', () => {
      it('avoin ennakko listautuu ja poistuu loppulaskun vähennyksellä', async () => {
        const c = await fresh();
        await c.paivitaAsetukset({
          LaskuEnnakkosaatavat: '1715',
          LaskuEnnakkotili: '2861',
          LaskuEnnakkoALV: '29392',
        });
        await c.tallennaTili(1715, { numero: 1715, tyyppi: 'AO', nimi: { fi: 'Ennakkosaatavat' } });
        await c.tallennaTili(2861, { numero: 2861, tyyppi: 'B', nimi: { fi: 'Saadut ennakot' } });
        await c.tallennaTili(29392, { numero: 29392, tyyppi: 'B', nimi: { fi: 'Ennakon alv' } });
        const asiakas = await c.tallennaKumppani({ nimi: 'Ennakkoasiakas Oy' });
        await expect(
          c.tallennaMyyntilasku({ pvm: '2026-06-01', maksutapa: 2, rivit }),
        ).rejects.toMatchObject({ code: 'EIKUMPPANIA' });
        const ennakko = await c.tallennaMyyntilasku({
          pvm: '2026-06-01',
          kumppani: asiakas.id,
          maksutapa: 2,
          rivit,
        });
        expect(await c.haeAvoimetEnnakot(asiakas.id)).toEqual([
          {
            tosite: ennakko.id,
            numero: ennakko.numero,
            alvProsentti: 25.5,
            netto: 10_000 as Cents,
            avoin: 10_000 as Cents,
          },
        ]);
        await c.tallennaMyyntilasku({
          pvm: '2026-06-15',
          kumppani: asiakas.id,
          rivit: [
            { myyntiKpl: 1, aNetto: 300, alvKoodi: 11, alvProsentti: 25.5 },
            {
              myyntiKpl: 1,
              aNetto: -100,
              alvKoodi: 11,
              alvProsentti: 25.5,
              tili: 2861,
              ennakkoTosite: ennakko.id,
            },
          ],
        });
        expect(await c.haeAvoimetEnnakot(asiakas.id)).toEqual([]);
      });
    });

    describe('ryhmälasku', () => {
      it('luo luonnoksen per vastaanottaja, ohittaa kaksoiskappaleet ja listautuu ryhmänä', async () => {
        const c = await fresh();
        const a = await c.tallennaKumppani({ nimi: 'Ryhmä A Oy' });
        const b = await c.tallennaKumppani({ nimi: 'Ryhmä B Oy' });
        const luotu = await c.tallennaRyhmalasku({
          pvm: '2026-06-01',
          otsikko: 'Jäsenmaksu',
          jakso: { alkaa: '2026-05-01', loppuu: '2026-05-31' },
          rivit,
          kumppanit: [b.id, a.id, b.id],
          ryhma: 'ryhma-uuid',
        });
        expect(luotu.map((t) => t.kumppani)).toEqual([b.id, a.id]);
        expect(luotu.every((t) => t.tila === 80 && t.numero === undefined)).toBe(true);
        expect(luotu.every((t) => t.ryhma === 'ryhma-uuid')).toBe(true);
        expect(luotu[0]?.jakso).toEqual({ alkaa: '2026-05-01', loppuu: '2026-05-31' });

        const lista = await c.listaaLaskuluonnokset();
        expect(lista).toHaveLength(2);
        expect(lista.every((r) => r.ryhma === 'ryhma-uuid')).toBe(true);
      });

      it('tyhjä vastaanottajalista → EIVASTAANOTTAJIA', async () => {
        const c = await fresh();
        await expect(
          c.tallennaRyhmalasku({ pvm: '2026-06-01', rivit, kumppanit: [], ryhma: 'r' }),
        ).rejects.toMatchObject({ code: 'EIVASTAANOTTAJIA' });
      });
    });
  });
}
