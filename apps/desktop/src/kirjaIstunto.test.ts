import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { IstuntoHallinta, KirjaIstunto } from './kirjaIstunto.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-istunto-'));
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

describe('KirjaIstunto', () => {
  it('avaa kirjan, kuuntelee localhostissa ja tarjoilee api:n', async () => {
    const istunto = await KirjaIstunto.avaa(join(hakemisto, 'a.penni'));
    try {
      expect(istunto.osoite).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const vastaus = await fetch(`${istunto.osoite}/api/init`);
      expect(vastaus.status).toBe(200);
    } finally {
      await istunto.sulje();
    }
  });

  it('kirjoittaa pysyvästi: sama tiedosto uudelleen avattuna säilyttää asetukset', async () => {
    const polku = join(hakemisto, 'pysyva.penni');
    const eka = await KirjaIstunto.avaa(polku);
    await eka.storage.patchAsetukset({ Nimi: 'Testikirja Oy' });
    await eka.sulje();

    const toka = await KirjaIstunto.avaa(polku);
    try {
      const asetukset = await toka.storage.getAsetukset();
      expect(asetukset.Nimi).toBe('Testikirja Oy');
    } finally {
      await toka.sulje();
    }
  });

  it('sulkemisen jälkeen portti ei enää vastaa', async () => {
    const istunto = await KirjaIstunto.avaa(join(hakemisto, 'b.penni'));
    const osoite = istunto.osoite;
    await istunto.sulje();
    await expect(fetch(`${osoite}/api/init`)).rejects.toThrow();
  });

  it('sulkemisen jälkeen storage on suljettu', async () => {
    const istunto = await KirjaIstunto.avaa(join(hakemisto, 'f.penni'));
    await istunto.sulje();
    // Yritä käyttää storagea sulkemisen jälkeen — pitäisi hylätä.
    await expect(istunto.storage.getAsetukset()).rejects.toThrow();
  });

  it('storage suljetaan, vaikka palvelimen sulkeminen epäonnistuisi', async () => {
    const istunto = await KirjaIstunto.avaa(join(hakemisto, 'i.penni'));
    // kirjaIstunto.ts ei saa tuoda Electronia, joten `palvelin` on TS-yksityinen mutta ei
    // suojattu ajon aikana — tästä päästään käsiksi Fastify-instanssiin vakoilua varten.
    const palvelin = (istunto as unknown as { palvelin: FastifyInstance }).palvelin;
    const sulkuVakoilu = vi
      .spyOn(palvelin, 'close')
      .mockRejectedValueOnce(new Error('palvelimen sulku epäonnistui'));
    try {
      await expect(istunto.sulje()).rejects.toThrow('palvelimen sulku epäonnistui');
      // Storage on silti suljettu, vaikka palvelimen sulku epäonnistui.
      await expect(istunto.storage.getAsetukset()).rejects.toThrow();
      // closed-lippu on jo asetettu ensimmäisellä kutsulla, joten toinen kutsu ei enää heitä.
      await expect(istunto.sulje()).resolves.toBeUndefined();
    } finally {
      sulkuVakoilu.mockRestore();
      // closed-lippu esti oikean sulje()-kutsun palvelinta sulkemasta — suljetaan se nyt
      // suoraan, ettei testi jätä kuuntelijaa roikkumaan.
      await palvelin.close();
    }
  });
});

describe('IstuntoHallinta', () => {
  it('vaihtaa kirjaa ja sulkee edellisen', async () => {
    const hallinta = new IstuntoHallinta();
    try {
      const eka = await hallinta.vaihda(join(hakemisto, 'c.penni'));
      const ekaOsoite = eka.osoite;
      const toka = await hallinta.vaihda(join(hakemisto, 'd.penni'));

      expect(toka.osoite).not.toBe(ekaOsoite);
      expect(hallinta.nykyinen()?.polku).toBe(join(hakemisto, 'd.penni'));
      await expect(fetch(`${ekaOsoite}/api/init`)).rejects.toThrow();
    } finally {
      await hallinta.suljeKaikki();
    }
  });

  it('nykyinen on null ennen ensimmäistä avausta', () => {
    const hallinta = new IstuntoHallinta();
    expect(hallinta.nykyinen()).toBeNull();
  });

  it('epäonnistunut vanhan istunnon sulkeminen ei estä vaihtoa', async () => {
    const hallinta = new IstuntoHallinta();
    let eka: KirjaIstunto | null = null;
    const virheVakoilu = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      eka = await hallinta.vaihda(join(hakemisto, 'g.penni'));
      const suljeVakoilu = vi
        .spyOn(eka, 'sulje')
        .mockRejectedValueOnce(new Error('sulku epäonnistui'));

      // Vaihto onnistuu silti — vanhan istunnon sulkeminen on siivousta, ei osa vaihtoa.
      const toka = await hallinta.vaihda(join(hakemisto, 'h.penni'));

      expect(hallinta.nykyinen()).toBe(toka);
      expect(toka.polku).toBe(join(hakemisto, 'h.penni'));
      const vastaus = await fetch(`${toka.osoite}/api/init`);
      expect(vastaus.status).toBe(200);
      expect(virheVakoilu).toHaveBeenCalled();

      suljeVakoilu.mockRestore();
    } finally {
      virheVakoilu.mockRestore();
      // eka:n oikea sulje() ei koskaan päässyt ajamaan (vakoilu esti sen) — suljetaan nyt,
      // ettei testi jätä sen Fastify-kuuntelijaa roikkumaan.
      await eka?.sulje();
      await hallinta.suljeKaikki();
    }
  });

  it('epäonnistunut vaihto huonoon polkuun ei sammuta edellistä istuntoa', async () => {
    const hallinta = new IstuntoHallinta();
    try {
      const eka = await hallinta.vaihda(join(hakemisto, 'e.penni'));
      const ekaOsoite = eka.osoite;
      // Hakemistoa ei ole olemassa: better-sqlite3 ei voi luoda tiedostoa sinne, avaa() heittää.
      const huonoPolku = join(hakemisto, 'ei-olemassa-hakemisto', 'huono.penni');

      await expect(hallinta.vaihda(huonoPolku)).rejects.toThrow();

      expect(hallinta.nykyinen()).toBe(eka);
      const vastaus = await fetch(`${ekaOsoite}/api/init`);
      expect(vastaus.status).toBe(200);
    } finally {
      await hallinta.suljeKaikki();
    }
  });

  it('näyttää uuden istunnon ennen vanhan sulkemista; uusi on jo nykyinen näytön aikana', async () => {
    const hallinta = new IstuntoHallinta();
    try {
      const eka = await hallinta.vaihda(join(hakemisto, 'e.penni'));
      let nykyinenNaytonAikana: string | undefined;
      let vanhaVastasiNaytonAikana = false;
      const toka = await hallinta.vaihda(join(hakemisto, 'f.penni'), async (uusi) => {
        // Uuden sivun IPC-kutsut tarkistetaan nykyistä osoitetta vasten heti latauksessa.
        nykyinenNaytonAikana = hallinta.nykyinen()?.osoite;
        vanhaVastasiNaytonAikana = (await fetch(`${eka.osoite}/api/init`)).ok;
        expect(uusi.polku).toBe(join(hakemisto, 'f.penni'));
      });
      expect(nykyinenNaytonAikana).toBe(toka.osoite);
      expect(vanhaVastasiNaytonAikana).toBe(true);
      await expect(fetch(`${eka.osoite}/api/init`)).rejects.toThrow();
    } finally {
      await hallinta.suljeKaikki();
    }
  });

  it('peruttu näyttö sulkee uuden istunnon ja jättää vanhan voimaan', async () => {
    const hallinta = new IstuntoHallinta();
    try {
      const eka = await hallinta.vaihda(join(hakemisto, 'g.penni'));
      let uudenOsoite = '';
      await expect(
        hallinta.vaihda(join(hakemisto, 'h.penni'), async (uusi) => {
          uudenOsoite = uusi.osoite;
          throw new Error('käyttäjä jäi sivulle');
        }),
      ).rejects.toThrow('käyttäjä jäi sivulle');

      expect(hallinta.nykyinen()).toBe(eka);
      expect((await fetch(`${eka.osoite}/api/init`)).ok).toBe(true);
      await expect(fetch(`${uudenOsoite}/api/init`)).rejects.toThrow();
    } finally {
      await hallinta.suljeKaikki();
    }
  });
});
