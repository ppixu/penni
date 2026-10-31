import { InProcessClient, type KpClient } from '@penni/asiakas';
import type { StoredTosite } from '@penni/engine';
import { Euro } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARKISTO_CSS } from './arkistoCss';
import { kausiTunnus, liiteTiedosto, tositeTiedosto } from './polut';
import { rakennaArkisto } from './rakennaArkisto';
import { laskeSha, tarkistaArkisto } from './tarkiste';
import { pura } from './zip';

const TULOS = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Yleinen' },
  rivit: [{ fi: 'Liikevaihto', L: '3', M: 'bold' }],
});
const TASE = JSON.stringify({
  nimi: { fi: 'Tase' },
  muoto: { fi: 'Yleinen' },
  rivit: [
    { fi: 'Vastaavaa', L: '1', M: 'bold' },
    { fi: 'Vastattavaa', L: '2', M: 'bold' },
  ],
});
const TILIT = [
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Alv-saatava' } },
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
  { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tulos' } },
  { numero: 2920, tyyppi: 'BV', nimi: { fi: 'Verovelka' } },
  { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
];
const ASETUKSET = {
  Nimi: 'Demo Oy',
  Ytunnus: '1234567-8',
  AlvVelvollinen: 'true',
  AlvAlkaa: '2025-01-01',
  AlvVelkaTili: '2939',
  'tulos/yleinen': TULOS,
  'tase/yleinen': TASE,
};
const ALKAA = '2025-01-01';
const NYT = () => new Date('2026-10-31T10:00:00Z');
const LIITETIEDOT = 'Yhtiö on pienyritys.\nHenkilöstöä ei ole.';

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9,
]);

type Vienti = StoredTosite['viennit'][number];
function vienti(tili: number, debet: number, kredit: number, pvm: string, alv = [0, 0]): Vienti {
  return {
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm,
    alvKoodi: alv[0] as number,
    alvProsentti: alv[1] as number,
  };
}

async function luoKirja(): Promise<{ client: KpClient; kirjatut: StoredTosite[] }> {
  const client = new InProcessClient(
    createMemoryStorage({
      tilit: TILIT,
      tilikaudet: [{ alkaa: '2025-01-01', loppuu: '2025-12-31' }],
      asetukset: ASETUKSET,
    }),
    () => '2026-01-15T00:00:00.000Z',
  );
  const kumppani = await client.tallennaKumppani({ nimi: 'Asiakas Oy' });
  const kirjatut: StoredTosite[] = [];
  const luo = async (pvm: string, sarja: string, viennit: Vienti[], lisa = {}) => {
    const t = await client.luoTosite({ pvm, tyyppi: 200, sarja, tila: 100, viennit, ...lisa });
    kirjatut.push(t);
    return t;
  };
  // Q1-myynti 100 € + 25,5 % alv → alv-tilitys.
  const myynti = await luo(
    '2025-02-10',
    '',
    [
      vienti(1900, 12_550, 0, '2025-02-10'),
      vienti(3000, 0, 10_000, '2025-02-10', [11, 25.5]),
      vienti(2939, 0, 2_550, '2025-02-10', [111, 25.5]),
    ],
    { kumppani: kumppani.id, otsikko: 'Myynti' },
  );
  const kahvi = await luo(
    '2025-04-02',
    '',
    [vienti(4000, 1_240, 0, '2025-04-02'), vienti(1900, 0, 1_240, '2025-04-02')],
    { tyyppi: 100, otsikko: 'Kahvi <&>' },
  );
  await luo(
    '2025-05-05',
    'M',
    [vienti(1900, 5_000, 0, '2025-05-05'), vienti(3000, 0, 5_000, '2025-05-05')],
    { otsikko: 'Muistio' },
  );
  await luo(
    '2025-06-06',
    'M',
    [vienti(1900, 2_000, 0, '2025-06-06'), vienti(3000, 0, 2_000, '2025-06-06')],
    { otsikko: 'Toinen muistio' },
  );
  // Sarjan nimessä tiedostonimeen kelpaamattomia merkkejä.
  const outo = await luo(
    '2025-07-07',
    'K 2/b',
    [vienti(1900, 300, 0, '2025-07-07'), vienti(3000, 0, 300, '2025-07-07')],
    { otsikko: 'Outo sarja' },
  );

  await client.lisaaLiite({
    tosite: myynti.id,
    nimi: 'lasku.pdf',
    tyyppi: 'application/pdf',
    sha: await laskeSha(PDF),
    luotu: '2025-02-10T00:00:00.000Z',
    data: PDF,
  });
  await client.lisaaLiite({
    tosite: kahvi.id,
    nimi: 'kuitti.pdf',
    tyyppi: 'application/pdf',
    luotu: '2025-04-02T00:00:00.000Z',
    data: PDF,
  });
  await client.lisaaLiite({
    tosite: kahvi.id,
    nimi: 'kuva.jpg',
    tyyppi: 'image/jpeg',
    luotu: '2025-04-02T00:00:00.000Z',
    data: JPEG,
  });
  await client.lisaaLiite({
    tosite: outo.id,
    nimi: 'liite',
    tyyppi: 'image/jpeg',
    luotu: '2025-07-07T00:00:00.000Z',
    data: JPEG,
  });

  kirjatut.push(await client.tallennaAlvTilitys({ alkupvm: '2025-01-01', loppupvm: '2025-03-31' }));
  await client.tallennaLiitetiedot({ loppupvm: '2025-12-31', teksti: LIITETIEDOT });
  await client.paataTilikausi(ALKAA);
  return { client, kirjatut };
}

const dekoodaa = new TextDecoder();
/** Kerätyn sovellus-CSS:n sijainen (tuotannossa Tailwind-preflight `@layer base` -kerroksessa). */
const SOVELLUS_CSS = '@layer base { h1 { font-size: inherit; } a { color: inherit; } }';

/** Suhteellinen osoite → polku zipissä (fragmentti ja %-koodaus pois). */
function ratkaise(tiedosto: string, href: string): string {
  const osat = tiedosto.split('/').slice(0, -1);
  for (const osa of href.split('#')[0]?.split('/') ?? []) {
    if (osa === '..') osat.pop();
    else if (osa !== '.' && osa !== '') osat.push(decodeURIComponent(osa));
  }
  return osat.join('/');
}

describe('rakennaArkisto', () => {
  // Arkisto renderöi act()-ympäristön ulkopuolella (ks. staattinen.test.tsx).
  const lippu = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
  let aiempi: boolean | undefined;
  beforeAll(() => {
    aiempi = lippu.IS_REACT_ACT_ENVIRONMENT;
    lippu.IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterAll(() => {
    lippu.IS_REACT_ACT_ENVIRONMENT = aiempi;
  });

  it('kokoaa lukitun tilikauden itsenäiseksi, tarkistettavaksi arkistoksi', async () => {
    const { client, kirjatut } = await luoKirja();
    const edistys: [number, number][] = [];
    const liitehaut = vi.spyOn(client, 'haeLiitteet');
    const tulos = await rakennaArkisto({
      client,
      alkaa: ALKAA,
      nyt: NYT,
      versio: 'testi',
      css: SOVELLUS_CSS,
      onEdistys: (valmis, yhteensa) => edistys.push([valmis, yhteensa]),
    });
    expect(tulos.tiedostonimi).toBe('Demo Oy-arkisto-2025.zip');
    expect(tulos.luotu).toBe('2026-10-31T10:00:00.000Z');
    // Liitteet haetaan vain tositteilta, joilla niitä listan mukaan on (myynti, kahvi, outo).
    const liitteelliset = [kirjatut[0], kirjatut[1], kirjatut[4]].map((t) => t?.id);
    expect(liitehaut.mock.calls.map(([id]) => id).sort()).toEqual(liitteelliset.sort());
    liitehaut.mockRestore();

    const zip = pura(tulos.zip);
    const polut = [...zip.keys()];
    expect(polut.every((p) => p.startsWith('2025/'))).toBe(true);
    const tiedostot = new Map(
      polut.map((p) => [p.slice('2025/'.length), zip.get(p) as Uint8Array]),
    );
    const teksti = (polku: string) => dekoodaa.decode(tiedostot.get(polku));

    // Tositteet ja liitteet.
    const kausi = kausiTunnus(ALKAA);
    let liitteita = 0;
    for (const t of kirjatut) {
      const tunnus = await client.haeTosite(t.id);
      if (!tunnus) throw new Error('tosite puuttuu');
      const sarja = tunnus.sarja.replace(/[^A-Za-z0-9_-]/g, '_');
      const runko = tositeTiedosto(kausi, sarja, tunnus.tunniste);
      expect(tiedostot.has(`tositteet/${runko}.html`), runko).toBe(true);
      const json = JSON.parse(teksti(`tositteet/${runko}.json`));
      expect(json.id).toBe(t.id);
      const metat = await client.haeLiitteet(t.id);
      expect(json.liitteet).toHaveLength(metat.length);
      for (const [i, meta] of metat.entries()) {
        const nimi = liiteTiedosto(kausi, sarja, tunnus.tunniste, i + 1, meta.nimi, meta.tyyppi);
        const liite = await client.haeLiite(meta.id);
        expect(tiedostot.get(`liitteet/${nimi}`)).toEqual(liite?.data);
        expect(json.liitteet[i].tiedosto).toBe(nimi);
        liitteita++;
      }
    }
    expect(liitteita).toBe(4);
    expect(tiedostot.has('tositteet/2025-K_2_b-00000001.html')).toBe(true);
    expect(tiedostot.has('liitteet/2025-K_2_b-00000001_01.jpeg')).toBe(true);
    expect(tiedostot.has('liitteet/2025--00000002_02.jpg')).toBe(true);
    expect(tulos.tositteita).toBe(kirjatut.length);
    expect(tulos.liitteita).toBe(4);
    expect(teksti('tositteet/2025--00000002.html')).toContain('Kahvi &lt;&amp;&gt;');

    // Arkiston tyylit tulevat sovelluksen CSS:n (ja sen preflightin) perään ja koskevat
    // käsin kirjoitettua sisältöä.
    expect(teksti('static/arkisto.css')).toBe(`${SOVELLUS_CSS}\n${ARKISTO_CSS}`);
    expect(teksti('index.html')).toContain('<main><div class="arkistoteksti"><h1');
    expect(teksti('arkistovarmenne.html')).toContain('<main><div class="arkistoteksti"><h1');
    expect(teksti('raportit/paivakirja.html')).toContain(
      '<main><header class="arkistoteksti"><h1>Päiväkirja</h1><p class="jakso">',
    );

    // Raportit, tilinpäätös ja alv.
    for (const r of [
      'paivakirja',
      'paakirja',
      'tositeluettelo',
      'tase',
      'tuloslaskelma',
      'taseerittely',
      'tililuettelo',
      'laskut',
      'tilinpaatos',
    ]) {
      expect(tiedostot.has(`raportit/${r}.html`), r).toBe(true);
    }
    expect(teksti('raportit/tilinpaatos.html')).toContain('Yhtiö on pienyritys.');
    // Laskut on tilanne kauden lopussa (avoimet), muut jaksoraportit koko kaudelta.
    expect(teksti('raportit/laskut.html')).toContain('<p class="jakso">Avoimet 31.12.2025</p>');
    expect(teksti('raportit/paivakirja.html')).toContain(
      '<p class="jakso">1.1.2025 – 31.12.2025</p>',
    );
    expect(teksti('raportit/tase.html')).toContain('<p class="jakso">31.12.2025</p>');
    expect(teksti('raportit/paakirja.html')).toContain('id="tili-1900"');
    expect(teksti('tositteet/2025--00000002.html')).toContain(
      'href="../raportit/paakirja.html#tili-1900"',
    );
    const alv = teksti('alv/alv-2025-01-01_2025-03-31.html');
    expect(alv).toContain('Arvonlisäverolaskelma');
    expect(alv).toContain('href="../tositteet/2025--00000001.html"');

    // Linkit: jokainen suhteellinen href/src osuu zipin tiedostoon; ei skriptejä, ei sovelluslinkkejä.
    for (const [polku, data] of tiedostot) {
      if (!polku.endsWith('.html')) continue;
      const html = dekoodaa.decode(data);
      expect(html, polku).not.toContain('href="/');
      expect(html, polku).not.toContain('<script');
      expect(html, polku).toContain('Arkistoitu 31.10.2026 Penni-versiolla testi');
      for (const [, osoite] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
        const href = (osoite as string).replace(/&amp;/g, '&');
        if (href.startsWith('#') || href.startsWith('http')) continue;
        expect(tiedostot.has(ratkaise(polku, href)), `${polku}: ${href}`).toBe(true);
      }
    }

    // Tarkisteet.
    const tarkistus = await tarkistaArkisto(tulos.zip);
    expect(tarkistus).toEqual({ ok: true, juuriTiiviste: tulos.juuriTiiviste, virheet: [] });
    const lista = tiedostot.get('arkisto.sha256') as Uint8Array;
    const juuri = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(lista))),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(juuri).toBe(tulos.juuriTiiviste);
    expect(teksti('index.html')).toContain(juuri);
    expect(teksti('arkistovarmenne.html')).toContain(juuri);
    const rivit = dekoodaa.decode(lista).split('\n').filter(Boolean);
    expect(rivit.length).toBe(tiedostot.size - 3);
    for (const rivi of rivit) {
      expect(rivi).toMatch(/^[0-9a-f]{64} \*\S/);
      const [sha, polku] = [rivi.slice(0, 64), rivi.slice(66)];
      expect(await laskeSha(tiedostot.get(polku) as Uint8Array), polku).toBe(sha);
    }

    const manifest = JSON.parse(teksti('manifest.json'));
    expect(manifest).toMatchObject({
      muoto: 'penni-arkisto',
      versio: 1,
      kirjanpito: { nimi: 'Demo Oy', ytunnus: '1234567-8' },
      tilikausi: { alkaa: '2025-01-01', loppuu: '2025-12-31' },
      luotu: tulos.luotu,
      ohjelma: 'Penni testi',
      tositteita: kirjatut.length,
      liitteita: 4,
    });
    expect(manifest.tiedostot.length).toBe(rivit.length - 1);
    expect(manifest.tiedostot).toContainEqual(
      expect.objectContaining({ polku: 'liitteet/2025--00000002_02.jpg', tyyppi: 'image/jpeg' }),
    );

    // Edistys etenee yksi sivu kerrallaan loppuun asti.
    const viimeinen = edistys.at(-1);
    expect(viimeinen?.[0]).toBe(viimeinen?.[1]);
    expect(edistys.map(([v]) => v)).toEqual(edistys.map((_, i) => i + 1));

    // Muutettu liite paljastuu.
    const muutettu = new Map(zip);
    const liitePolku = '2025/liitteet/2025--00000002_02.jpg';
    const tavut = new Uint8Array(muutettu.get(liitePolku) as Uint8Array);
    tavut[3] = (tavut[3] as number) ^ 0xff;
    muutettu.set(liitePolku, tavut);
    const rikki = await tarkistaArkisto(zipSync(Object.fromEntries(muutettu)));
    expect(rikki.ok).toBe(false);
    expect(rikki.virheet).toContain('muuttunut: liitteet/2025--00000002_02.jpg');
  });

  it('varoittaa etusivulla liitteestä, jonka tallennettu tarkiste ei täsmää', async () => {
    const client = new InProcessClient(
      createMemoryStorage({
        tilit: TILIT,
        tilikaudet: [{ alkaa: '2025-01-01', loppuu: '2025-12-31' }],
        asetukset: ASETUKSET,
      }),
      () => '2026-01-15T00:00:00.000Z',
    );
    const t = await client.luoTosite({
      pvm: '2025-03-01',
      tyyppi: 200,
      sarja: '',
      tila: 100,
      viennit: [vienti(1900, 100, 0, '2025-03-01'), vienti(3000, 0, 100, '2025-03-01')],
    });
    await client.lisaaLiite({
      tosite: t.id,
      nimi: 'kuitti.pdf',
      tyyppi: 'application/pdf',
      sha: '0'.repeat(64),
      luotu: '2025-03-01T00:00:00.000Z',
      data: PDF,
    });
    await client.paataTilikausi(ALKAA);
    const tulos = await rakennaArkisto({
      client,
      alkaa: ALKAA,
      nyt: NYT,
      versio: 'testi',
      css: '',
    });
    const index = dekoodaa.decode(pura(tulos.zip).get('2025/index.html'));
    expect(index).toContain('Liitteen 2025--00000001_01.pdf tarkiste ei täsmää tallennettuun');
    expect(index).not.toContain('Tilinpäätös vahvistettu');
    expect(index).toContain('Tilinpäätös vahvistamatta');
  });

  it('kieltäytyy arkistoimasta lukitsematonta tilikautta', async () => {
    const client = new InProcessClient(
      createMemoryStorage({
        tilit: TILIT,
        tilikaudet: [{ alkaa: '2025-01-01', loppuu: '2025-12-31' }],
        asetukset: ASETUKSET,
      }),
      () => '2026-01-15T00:00:00.000Z',
    );
    await expect(rakennaArkisto({ client, alkaa: ALKAA, css: '' })).rejects.toThrow(
      'Tilikausi ei ole lukittu',
    );
    await expect(rakennaArkisto({ client, alkaa: '2024-01-01', css: '' })).rejects.toThrow(
      'Tilikautta 2024-01-01 ei ole',
    );
  });
});
