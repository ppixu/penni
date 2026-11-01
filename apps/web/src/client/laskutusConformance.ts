import type { KpClient } from '@penni/asiakas';
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
  });
}
