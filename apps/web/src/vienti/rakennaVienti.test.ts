import { tarkistaArkisto } from '@/arkisto/tarkiste';
import { pura } from '@/arkisto/zip';
import { InProcessClient } from '@penni/asiakas';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { createMemoryStorage } from '@penni/storage-memory';
import { describe, expect, it } from 'vitest';
import { rakennaVienti } from './rakennaVienti';

const NYT = () => new Date(2026, 9, 31, 12, 0, 0);
const dekoodaa = new TextDecoder();

function vienti(tili: number, debet: number, kredit: number, pvm: string, selite?: string) {
  return {
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    ...(selite !== undefined ? { selite } : {}),
  };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x00, 0xff, 0x80]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

async function luoKirja(): Promise<{ client: KpClient; tositeIdt: number[] }> {
  const client = new InProcessClient(
    createMemoryStorage({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
        {
          numero: 3000,
          tyyppi: 'CL',
          nimi: { fi: 'Myynti; "tuotot"' },
          alvlaji: 1,
          alvprosentti: 25.5,
        },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { Nimi: 'Demo Oy / Ääkköset', AlvVelvollinen: 'false' },
    }),
    () => '2026-06-01T00:00:00.000Z',
  );
  const kumppani = await client.tallennaKumppani({
    nimi: 'Asiakas Oy',
    alvtunnus: 'FI12345678',
    iban: ['FI2112345600000785', 'FI4950009420028730'],
  });
  const a = await client.luoTosite({
    pvm: '2026-03-01',
    tyyppi: 200,
    sarja: '',
    tila: 100,
    otsikko: 'Myynti A',
    kumppani: kumppani.id,
    viennit: [
      vienti(1900, 123_450, 0, '2026-03-01', 'Tilitys; "kuun" myynti'),
      vienti(3000, 0, 123_450, '2026-03-01'),
    ],
  });
  const b = await client.luoTosite({
    pvm: '2026-04-15',
    tyyppi: 200,
    sarja: '',
    tila: 100,
    viennit: [vienti(1900, 5, 0, '2026-04-15'), vienti(3000, 0, 5, '2026-04-15')],
  });
  const luonnos = await client.luoTosite({
    pvm: '2026-05-01',
    tyyppi: 200,
    sarja: '',
    tila: 50,
    otsikko: 'Luonnos',
    viennit: [vienti(1900, 700, 0, '2026-05-01'), vienti(3000, 0, 700, '2026-05-01')],
  });
  const luotu = '2026-06-01T00:00:00.000Z';
  await client.lisaaLiite({
    tosite: a.id,
    nimi: 'kuitti.pdf',
    tyyppi: 'application/pdf',
    luotu,
    data: PDF,
  });
  await client.lisaaLiite({
    tosite: a.id,
    nimi: 'kuva ä:é.jpg',
    tyyppi: 'image/jpeg',
    luotu,
    data: JPG,
  });
  await client.lisaaLiite({
    tosite: luonnos.id,
    nimi: 'luonnos.pdf',
    tyyppi: 'application/pdf',
    luotu,
    data: PDF,
  });
  return { client, tositeIdt: [a.id, b.id, luonnos.id] };
}

/** Pieni RFC 4180 -jäsennin puolipisteerotteiselle CSV:lle (BOM pois). */
function jasennaCsv(tavut: Uint8Array): string[][] {
  const teksti = dekoodaa.decode(tavut).replace(/^﻿/, '');
  const rivit: string[][] = [];
  let rivi: string[] = [];
  let kentta = '';
  let lainattu = false;
  for (let i = 0; i < teksti.length; i++) {
    const c = teksti[i];
    if (lainattu) {
      if (c === '"' && teksti[i + 1] === '"') {
        kentta += '"';
        i++;
      } else if (c === '"') lainattu = false;
      else kentta += c;
    } else if (c === '"') lainattu = true;
    else if (c === ';') {
      rivi.push(kentta);
      kentta = '';
    } else if (c === '\r' && teksti[i + 1] === '\n') {
      rivi.push(kentta);
      rivit.push(rivi);
      rivi = [];
      kentta = '';
      i++;
    } else kentta += c;
  }
  return rivit;
}

/** "-1234,50" -> -123450 kokonaislukulaskennalla. */
function sentteina(s: string): number {
  const neg = s.startsWith('-');
  const [euroa = '0', sentit = '0'] = s.replace('-', '').split(',');
  const n = Number(euroa) * 100 + Number(sentit);
  return neg ? -n : n;
}

describe('rakennaVienti', () => {
  it('rakentaa zipin juurikansion ja tiedostonimen yrityksen nimestä ja päivästä', async () => {
    const { client } = await luoKirja();
    const { tiedostonimi, zip } = await rakennaVienti({ client, nyt: NYT });
    expect(tiedostonimi).toBe('Demo Oy _ Ääkköset-kirjanpito-2026-10-31.zip');
    const juuri = tiedostonimi.replace(/\.zip$/, '');
    const polut = [...pura(zip).keys()];
    for (const nimi of [
      'LUEMINUT.txt',
      'kirjanpito.json',
      'tilikartta.csv',
      'tilikaudet.csv',
      'kumppanit.csv',
      'tositteet.csv',
      'viennit.csv',
      'vienti.sha256',
    ]) {
      expect(polut).toContain(`${juuri}/${nimi}`);
    }
    expect(polut.every((p) => p.startsWith(`${juuri}/`))).toBe(true);
  });

  it('viennit.csv: rivit = kirjattujen viennit, debet = kredit sentteinä; luonnos vain JSONissa', async () => {
    const { client } = await luoKirja();
    const { zip } = await rakennaVienti({ client, nyt: NYT });
    const tiedostot = pura(zip);
    const hae = (n: string) => {
      const e = [...tiedostot].find(([p]) => p.endsWith(`/${n}`));
      if (!e) throw new Error(`puuttuu ${n}`);
      return e[1];
    };

    const kirjatut = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    expect(kirjatut).toHaveLength(2);
    const viennit = jasennaCsv(hae('viennit.csv'));
    const [otsikko, ...rivit] = viennit;
    expect(otsikko).toEqual([
      'tositeId',
      'tunnus',
      'pvm',
      'tili',
      'tilinNimi',
      'selite',
      'debet',
      'kredit',
      'alvkoodi',
      'alvprosentti',
      'kohdennus',
    ]);
    expect(rivit).toHaveLength(kirjatut.reduce((s, t) => s + t.viennit.length, 0));
    const debet = rivit.reduce((s, r) => s + sentteina(r[6] ?? ''), 0);
    const kredit = rivit.reduce((s, r) => s + sentteina(r[7] ?? ''), 0);
    expect(debet).toBe(123_455);
    expect(debet).toBe(kredit);
    const ensimmainen = rivit[0] ?? [];
    expect(ensimmainen[4]).toBe('Pankki');
    expect(ensimmainen[5]).toBe('Tilitys; "kuun" myynti');
    expect(ensimmainen[6]).toBe('1234,50');
    expect(rivit.some((r) => r[4] === 'Myynti; "tuotot"')).toBe(true);

    const tositteet = jasennaCsv(hae('tositteet.csv'));
    expect(tositteet).toHaveLength(1 + kirjatut.length);
    expect(tositteet[0]?.slice(0, 7)).toEqual([
      'id',
      'pvm',
      'tunnus',
      'sarja',
      'tunniste',
      'tyyppi',
      'tila',
    ]);

    const json = JSON.parse(dekoodaa.decode(hae('kirjanpito.json')));
    expect(json.muoto).toBe('penni-kirjanpito');
    expect(json.versio).toBe(1);
    expect(json.tositteet).toHaveLength(3);
    const luonnos = json.tositteet.find((t: { otsikko?: string }) => t.otsikko === 'Luonnos');
    expect(luonnos.tila).toBe(50);
    expect(luonnos.liitteet).toHaveLength(1);
    for (const t of json.tositteet) {
      expect(t).not.toHaveProperty('liitteita');
      for (const v of t.viennit) {
        expect(Number.isInteger(v.debet)).toBe(true);
        expect(Number.isInteger(v.kredit)).toBe(true);
      }
    }
    expect(json.tositteet[0].viennit[0].debet).toBe(123_450);
  });

  it('tilikartta-, tilikausi- ja kumppanitiedostot', async () => {
    const { client } = await luoKirja();
    const tiedostot = pura((await rakennaVienti({ client, nyt: NYT })).zip);
    const hae = (n: string) =>
      jasennaCsv([...tiedostot].find(([p]) => p.endsWith(`/${n}`))?.[1] ?? new Uint8Array());
    expect(hae('tilikartta.csv')).toEqual([
      ['numero', 'nimi', 'tyyppi', 'alvkoodi', 'alvprosentti'],
      ['1900', 'Pankki', 'ARP', '', ''],
      ['3000', 'Myynti; "tuotot"', 'CL', '1', '25.5'],
    ]);
    expect(hae('tilikaudet.csv')).toEqual([
      ['alkaa', 'loppuu'],
      ['2026-01-01', '2026-12-31'],
    ]);
    const kumppanit = hae('kumppanit.csv');
    expect(kumppanit[0]).toEqual([
      'id',
      'nimi',
      'alvtunnus',
      'maa',
      'osoite',
      'postinumero',
      'kaupunki',
      'email',
      'puhelin',
      'iban',
    ]);
    expect(kumppanit[1]?.[1]).toBe('Asiakas Oy');
    expect(kumppanit[1]?.[2]).toBe('FI12345678');
    expect(kumppanit[1]?.[9]).toBe('FI2112345600000785,FI4950009420028730');
  });

  it('liitteet ovat tavu tavulta samat kuin haeLiite, ja ne löytyvät JSONin poluista', async () => {
    const { client, tositeIdt } = await luoKirja();
    const { tiedostonimi, zip } = await rakennaVienti({ client, nyt: NYT });
    const juuri = tiedostonimi.replace(/\.zip$/, '');
    const tiedostot = pura(zip);
    const json = JSON.parse(
      dekoodaa.decode(tiedostot.get(`${juuri}/kirjanpito.json`) ?? new Uint8Array()),
    );
    let yhteensa = 0;
    for (const t of json.tositteet) {
      for (const l of t.liitteet) {
        const alkuperainen = await client.haeLiite(l.id);
        const vietyna = tiedostot.get(`${juuri}/${l.polku}`);
        expect(vietyna).toBeDefined();
        expect([...(vietyna as Uint8Array)]).toEqual([...(alkuperainen?.data as Uint8Array)]);
        expect(l.polku).toMatch(new RegExp(`^liitteet/${t.id}-${l.id}-[^/]+\\.(pdf|jpg)$`));
        yhteensa++;
      }
    }
    expect(yhteensa).toBe(3);
    const liitepolut = [...tiedostot.keys()].filter((p) => p.startsWith(`${juuri}/liitteet/`));
    expect(liitepolut).toHaveLength(3);
    expect(tositeIdt).toHaveLength(3);
    expect(liitepolut.some((p) => p.endsWith('/1-2-kuva ä__.jpg'))).toBe(true);
  });

  it('vienti.sha256 täsmää ja muuttunut tavu havaitaan', async () => {
    const { client } = await luoKirja();
    const { zip } = await rakennaVienti({ client, nyt: NYT });
    const tulos = await tarkistaArkisto(zip, 'vienti.sha256');
    expect(tulos.virheet).toEqual([]);
    expect(tulos.ok).toBe(true);

    const tiedostot = pura(zip);
    const polku = [...tiedostot.keys()].find((p) => p.endsWith('/viennit.csv')) as string;
    const muutettu = new Uint8Array(tiedostot.get(polku) as Uint8Array);
    muutettu[10] = (muutettu[10] ?? 0) ^ 1;
    const { pakkaa } = await import('@/arkisto/zip');
    tiedostot.set(polku, muutettu);
    const rikottu = pakkaa([...tiedostot].map(([p, data]) => ({ polku: p, data })));
    const huono = await tarkistaArkisto(rikottu, 'vienti.sha256');
    expect(huono.ok).toBe(false);
    expect(huono.virheet.join('\n')).toContain('muuttunut: viennit.csv');
  });

  it('tekstitiedostot (paitsi JSON ja tarkistelista) alkavat BOM:lla', async () => {
    const { client } = await luoKirja();
    const tiedostot = pura((await rakennaVienti({ client, nyt: NYT })).zip);
    for (const [polku, data] of tiedostot) {
      if (polku.endsWith('.csv') || polku.endsWith('.txt')) {
        expect([...data.slice(0, 3)], polku).toEqual([0xef, 0xbb, 0xbf]);
      }
    }
  });
});
