import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kuitti } from '@penni/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lueAineisto } from './lueAineisto.js';
import { luoTestiPdf } from './testi/luoTestiPdf.js';
import { type KuittiLukija, type LukuEdistyminen, LukuVirhe } from './tyypit.js';

let juuri: string;
let tiliote: string;
let kuittikansio: string;

/** Testilukija: nimen mukaan onnistuu tai epäonnistuu — pitää testin PDF-sisällöstä riippumattomana. */
function testiLukija(): KuittiLukija {
  return {
    nimi: 'testi',
    async lue(tiedosto: string) {
      if (tiedosto.includes('rikki')) return { ok: false, virhe: 'ei luettavissa' };
      const kuitti: Kuitti = { valuutta: 'EUR', alv: [], myyja: 'Testi Oy', bruttoSumma: 2000 };
      return { ok: true, kuitti };
    },
  };
}

beforeAll(() => {
  juuri = mkdtempSync(join(tmpdir(), 'luku-aineisto-'));
  kuittikansio = join(juuri, 'kuitit');
  tiliote = join(juuri, 'Tapahtumat.pdf');
  writeFileSync(tiliote, luoTestiPdf(['4.4.2026 PILVIPALVELU -20,00']));
  // mkdir + kolme tiedostoa: kaksi luettavaa, yksi rikki, yksi ohitettava .DS_Store
  mkdirSync(kuittikansio);
  writeFileSync(join(kuittikansio, 'a.pdf'), luoTestiPdf(['a']));
  writeFileSync(join(kuittikansio, 'rikki.pdf'), luoTestiPdf(['b']));
  writeFileSync(join(kuittikansio, '.DS_Store'), 'roska');
});
afterAll(() => rmSync(juuri, { recursive: true, force: true }));

describe('lueAineisto', () => {
  it('kokoaa tapahtumat, luetut kuitit ja lukematta jääneet', async () => {
    const aineisto = await lueAineisto(tiliote, kuittikansio, testiLukija());
    expect(aineisto.tiliote.tapahtumat).toHaveLength(1);
    expect(aineisto.kuitit.map((k) => k.tiedosto)).toEqual([join(kuittikansio, 'a.pdf')]);
    expect(aineisto.lukematta).toEqual([
      { tiedosto: join(kuittikansio, 'rikki.pdf'), syy: 'ei luettavissa' },
    ]);
  });

  it('lukee pelkän tiliotteen ilman kuittikansiota', async () => {
    const aineisto = await lueAineisto(tiliote, null, testiLukija());
    expect(aineisto.tiliote).toMatchObject({ tiedosto: tiliote, muoto: 'tapahtumat' });
    expect(aineisto.tiliote.tapahtumat).toHaveLength(1);
    expect(aineisto.kuitit).toEqual([]);
    expect(aineisto.lukematta).toEqual([]);
  });

  it('raportoi edistymisen molemmista vaiheista', async () => {
    const tapahtumat: LukuEdistyminen[] = [];
    await lueAineisto(tiliote, kuittikansio, testiLukija(), (e) => tapahtumat.push(e));
    expect(tapahtumat[0]?.vaihe).toBe('tiliote');
    expect(tapahtumat.at(-1)).toMatchObject({ vaihe: 'kuitit', valmiina: 2, yhteensa: 2 });
  });

  it('eristää lukijan heittämän poikkeuksen, muut kuitit ja edistyminen säilyvät', async () => {
    const oma = mkdtempSync(join(tmpdir(), 'luku-aineisto-poikkeus-'));
    try {
      const omaTiliote = join(oma, 'Tapahtumat.pdf');
      writeFileSync(omaTiliote, luoTestiPdf(['4.4.2026 PILVIPALVELU -20,00']));
      const omaKansio = join(oma, 'kuitit');
      mkdirSync(omaKansio);
      writeFileSync(join(omaKansio, 'a.pdf'), luoTestiPdf(['a']));
      writeFileSync(join(omaKansio, 'kaatuu.pdf'), luoTestiPdf(['b']));
      const kaatuvaPolku = join(omaKansio, 'kaatuu.pdf');

      const kaatuvaLukija: KuittiLukija = {
        nimi: 'testi-poikkeus',
        async lue(tiedosto: string) {
          if (tiedosto === kaatuvaPolku) throw new Error('lukija kaatui');
          const kuitti: Kuitti = { valuutta: 'EUR', alv: [], myyja: 'Testi Oy', bruttoSumma: 2000 };
          return { ok: true, kuitti };
        },
      };

      const tapahtumat: LukuEdistyminen[] = [];
      const aineisto = await lueAineisto(omaTiliote, omaKansio, kaatuvaLukija, (e) =>
        tapahtumat.push(e),
      );

      expect(aineisto.lukematta).toEqual([{ tiedosto: kaatuvaPolku, syy: 'lukija kaatui' }]);
      expect(aineisto.kuitit.map((k) => k.tiedosto)).toEqual([join(omaKansio, 'a.pdf')]);
      expect(tapahtumat).toContainEqual({
        vaihe: 'kuitit',
        valmiina: 2,
        yhteensa: 2,
        tiedosto: kaatuvaPolku,
      });
    } finally {
      rmSync(oma, { recursive: true, force: true });
    }
  });

  it('heittää EI_TIEDOSTOJA-virheen tyhjästä kuittikansiosta', async () => {
    const oma = mkdtempSync(join(tmpdir(), 'luku-aineisto-tyhja-'));
    try {
      const omaTiliote = join(oma, 'Tapahtumat.pdf');
      writeFileSync(omaTiliote, luoTestiPdf(['4.4.2026 PILVIPALVELU -20,00']));
      const omaKansio = join(oma, 'kuitit');
      mkdirSync(omaKansio);

      const virhe: unknown = await lueAineisto(omaTiliote, omaKansio, testiLukija()).catch(
        (e: unknown) => e,
      );
      expect(virhe).toBeInstanceOf(LukuVirhe);
      expect((virhe as LukuVirhe).koodi).toBe('EI_TIEDOSTOJA');
    } finally {
      rmSync(oma, { recursive: true, force: true });
    }
  });

  it('heittää EI_TIEDOSTOJA-virheen kun kansiossa on vain piilotiedostoja', async () => {
    const oma = mkdtempSync(join(tmpdir(), 'luku-aineisto-piilo-'));
    try {
      const omaTiliote = join(oma, 'Tapahtumat.pdf');
      writeFileSync(omaTiliote, luoTestiPdf(['4.4.2026 PILVIPALVELU -20,00']));
      const omaKansio = join(oma, 'kuitit');
      mkdirSync(omaKansio);
      writeFileSync(join(omaKansio, '.DS_Store'), 'roska');

      const virhe: unknown = await lueAineisto(omaTiliote, omaKansio, testiLukija()).catch(
        (e: unknown) => e,
      );
      expect(virhe).toBeInstanceOf(LukuVirhe);
      expect((virhe as LukuVirhe).koodi).toBe('EI_TIEDOSTOJA');
    } finally {
      rmSync(oma, { recursive: true, force: true });
    }
  });
});
