import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Asetusvarasto } from './asetusvarasto.js';

const hakemisto = mkdtempSync(join(tmpdir(), 'penni-asetukset-'));
afterAll(() => rmSync(hakemisto, { recursive: true, force: true }));

function varasto(nimi: string): Asetusvarasto {
  return new Asetusvarasto(join(hakemisto, nimi));
}

describe('Asetusvarasto', () => {
  it('palauttaa tyhjän listan kun tiedostoa ei ole', () => {
    expect(varasto('tyhja.json').viimeisimmat()).toEqual([]);
  });

  it('tallentaa ja lukee viimeisimmät kirjat', () => {
    const v = varasto('a.json');
    v.lisaaViimeisin('/kirjat/eka.penni');
    v.lisaaViimeisin('/kirjat/toka.penni');
    expect(varasto('a.json').viimeisimmat()).toEqual(['/kirjat/toka.penni', '/kirjat/eka.penni']);
  });

  it('siirtää uudelleen avatun kirjan kärkeen ilman kaksoiskappaletta', () => {
    const v = varasto('b.json');
    v.lisaaViimeisin('/kirjat/eka.penni');
    v.lisaaViimeisin('/kirjat/toka.penni');
    v.lisaaViimeisin('/kirjat/eka.penni');
    expect(v.viimeisimmat()).toEqual(['/kirjat/eka.penni', '/kirjat/toka.penni']);
  });

  it('poistaa kirjan viimeisimmistä', () => {
    const v = varasto('poisto.json');
    v.lisaaViimeisin('/kirjat/eka.penni');
    v.lisaaViimeisin('/kirjat/toka.penni');
    v.poistaViimeisin('/kirjat/eka.penni');
    expect(varasto('poisto.json').viimeisimmat()).toEqual(['/kirjat/toka.penni']);
  });

  it('säilyttää enintään kymmenen kirjaa', () => {
    const v = varasto('c.json');
    for (let i = 0; i < 15; i++) v.lisaaViimeisin(`/kirjat/${i}.penni`);
    expect(v.viimeisimmat()).toHaveLength(10);
    expect(v.viimeisimmat()[0]).toBe('/kirjat/14.penni');
  });

  it('sietää rikkinäisen asetustiedoston', () => {
    const v = varasto('rikki.json');
    v.lisaaViimeisin('/kirjat/eka.penni');
    // Ylikirjoitetaan roskalla ja varmistetaan ettei luku kaadu.
    writeFileSync(join(hakemisto, 'rikki.json'), '{ ei jsonia');
    expect(varasto('rikki.json').viimeisimmat()).toEqual([]);
  });

  it('palauttaa null avoimeksi kirjaksi kun tiedostoa ei ole', () => {
    expect(varasto('avoin-tyhja.json').avoin()).toBeNull();
  });

  it('tallentaa ja lukee avoimen kirjan', () => {
    const v = varasto('avoin.json');
    v.asetaAvoin('/kirjat/eka.penni');
    expect(varasto('avoin.json').avoin()).toBe('/kirjat/eka.penni');
  });

  it('tyhjentää avoimen kirjan kun asetaAvoin saa nullin', () => {
    const v = varasto('avoin-tyhjennys.json');
    v.asetaAvoin('/kirjat/eka.penni');
    v.asetaAvoin(null);
    expect(varasto('avoin-tyhjennys.json').avoin()).toBeNull();
  });

  it('säilyttää viimeisimmät kun avoin asetetaan, ja avoimen kun viimeisin lisätään', () => {
    const v = varasto('yhdessa.json');
    v.lisaaViimeisin('/kirjat/eka.penni');
    v.asetaAvoin('/kirjat/toka.penni');
    v.lisaaViimeisin('/kirjat/kolmas.penni');
    const luettu = varasto('yhdessa.json');
    expect(luettu.viimeisimmat()).toEqual(['/kirjat/kolmas.penni', '/kirjat/eka.penni']);
    expect(luettu.avoin()).toBe('/kirjat/toka.penni');
  });

  it('lukee epäkelvon avoin-kentän nulliksi mutta säilyttää viimeisimmät', () => {
    writeFileSync(
      join(hakemisto, 'avoin-roska.json'),
      JSON.stringify({ viimeisimmat: ['/kirjat/eka.penni'], avoin: 42 }),
    );
    const v = varasto('avoin-roska.json');
    expect(v.avoin()).toBeNull();
    expect(v.viimeisimmat()).toEqual(['/kirjat/eka.penni']);
  });

  it('muistaa kuitinlukumallin luvan eikä hävitä muita asetuksia', () => {
    const v = varasto('malli-lupa.json');
    v.lisaaViimeisin('/a.penni');
    expect(v.malliLupa()).toBe(false);
    v.annaMalliLupa();
    expect(varasto('malli-lupa.json').malliLupa()).toBe(true);
    expect(varasto('malli-lupa.json').viimeisimmat()).toEqual(['/a.penni']);
    v.asetaAvoin('/a.penni');
    expect(varasto('malli-lupa.json').malliLupa()).toBe(true);
  });

  it('muistaa näkymien suodatinvalinnat kirjasta riippumatta eikä hävitä muita asetuksia', () => {
    const v = varasto('suodattimet.json');
    expect(v.suodattimet()).toEqual({});
    v.lisaaViimeisin('/a.penni');
    v.tallennaSuodatin('tositteet', { bucket: 'luonnos', jarj: 'summa', suunta: 'nouseva' });
    v.tallennaSuodatin('raportit', ['x']);
    v.asetaAvoin('/a.penni');
    v.annaMalliLupa();
    const luettu = varasto('suodattimet.json');
    expect(luettu.suodattimet()).toEqual({
      tositteet: { bucket: 'luonnos', jarj: 'summa', suunta: 'nouseva' },
      raportit: ['x'],
    });
    expect(luettu.viimeisimmat()).toEqual(['/a.penni']);
    expect(luettu.avoin()).toBe('/a.penni');
    expect(luettu.malliLupa()).toBe(true);
    v.tallennaSuodatin('tositteet', { bucket: 'kirjanpidossa' });
    expect(varasto('suodattimet.json').suodattimet().tositteet).toEqual({
      bucket: 'kirjanpidossa',
    });
  });

  it('lukee epäkelvon suodattimet-kentän tyhjäksi mutta säilyttää muut asetukset', () => {
    for (const roska of [42, 'x', ['a'], null]) {
      writeFileSync(
        join(hakemisto, 'suodattimet-roska.json'),
        JSON.stringify({ viimeisimmat: ['/kirjat/eka.penni'], suodattimet: roska }),
      );
      const v = varasto('suodattimet-roska.json');
      expect(v.suodattimet()).toEqual({});
      expect(v.viimeisimmat()).toEqual(['/kirjat/eka.penni']);
    }
  });

  it('hylkää kelvottoman näkymäavaimen ja liian suuren arvon', () => {
    const v = varasto('suodattimet-rajat.json');
    for (const avain of [
      '',
      '__proto__',
      'constructor',
      'a/b',
      'x'.repeat(65),
      42 as unknown as string,
    ])
      expect(() => v.tallennaSuodatin(avain, {})).toThrow();
    expect(() => v.tallennaSuodatin('tositteet', 'x'.repeat(20_000))).toThrow();
    expect(() => v.tallennaSuodatin('tositteet', undefined)).toThrow();
    expect(v.suodattimet()).toEqual({});
    expect(Object.getPrototypeOf(v.suodattimet())).toBe(Object.prototype);
  });

  it('kirjoittaa atomisesti: väliaikainen tiedosto samaan hakemistoon ja uudelleennimeäminen', () => {
    const alihakemisto = join(hakemisto, 'atominen');
    mkdirSync(alihakemisto);
    const polku = join(alihakemisto, 'asetukset.json');
    const v = new Asetusvarasto(polku);
    v.lisaaViimeisin('/a.penni');
    v.tallennaSuodatin('tositteet', { bucket: 'luonnos' });
    v.asetaAvoin('/a.penni');
    v.annaMalliLupa();
    // Onnistuneen kirjoituksen jälkeen hakemistossa on vain itse asetustiedosto.
    expect(readdirSync(alihakemisto)).toEqual(['asetukset.json']);

    // Keskeytynyt kirjoitus (tässä: väliaikaistiedostoa ei voi kirjoittaa) ei saa katkaista
    // olemassa olevaa tiedostoa.
    const ennen = readFileSync(polku, 'utf8');
    mkdirSync(`${polku}.tmp`);
    expect(() => v.tallennaSuodatin('tositteet', { bucket: 'poistetut' })).toThrow();
    expect(readFileSync(polku, 'utf8')).toBe(ennen);
    expect(new Asetusvarasto(polku).suodattimet()).toEqual({ tositteet: { bucket: 'luonnos' } });
    expect(new Asetusvarasto(polku).malliLupa()).toBe(true);
  });
});
