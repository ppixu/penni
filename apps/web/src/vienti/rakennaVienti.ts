import { liitePaate, turvallinenNimi } from '@/arkisto/polut';
import { sha256Lista } from '@/arkisto/tarkiste';
import { pakkaa } from '@/arkisto/zip';
import { tositeTunniste } from '@/raportit/kirjaRivit';
import type { KpClient } from '@penni/asiakas';
import {
  type Kumppani,
  type ListattuTosite,
  type TositeBucket,
  lataaKartta,
  nimi,
} from '@penni/engine';
import { csvSentit, csvTiedosto } from './csv';

/** Tositteet, jotka viedään JSON:iin (kaikki muut paitsi poistetut). */
const JSON_KORIT: readonly TositeBucket[] = ['kirjanpidossa', 'luonnos', 'saapuneet', 'malli'];

const BOM = '﻿';
const enkoodaa = new TextEncoder();

interface ViedynLiitteenTiedot {
  id: number;
  tosite: number;
  nimi: string;
  roolinimi?: string;
  tyyppi: string;
  sha?: string;
  luotu: string;
  polku: string;
}

/** Vientitiedoston paikalliskalenteripäivä muodossa yyyy-mm-dd. */
function paivaIso(d: Date): string {
  const kk = String(d.getMonth() + 1).padStart(2, '0');
  const pv = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${kk}-${pv}`;
}

/** Liitteen polku zipin juuresta: `liitteet/<tositeId>-<liiteId>-<siivottu nimi>.<pääte>`. */
function liitePolku(tositeId: number, liiteId: number, liiteNimi: string, tyyppi: string): string {
  const paate = liitePaate(liiteNimi, tyyppi);
  const piste = liiteNimi.lastIndexOf('.');
  const runko =
    piste >= 0 && liiteNimi.slice(piste + 1).length <= 8 ? liiteNimi.slice(0, piste) : liiteNimi;
  return `liitteet/${tositeId}-${liiteId}-${turvallinenNimi(runko)}.${paate}`;
}

function lueminut(): string {
  return `${BOM}Penni - koko kirjanpidon vienti
============================

Tämä paketti sisältää koko kirjanpidon avoimessa muodossa, jotta sen voi siirtää toiseen
ohjelmaan tai säilyttää sellaisenaan.

Tiedostot
---------
kirjanpito.json   Täydellinen vienti yhtenä JSON-tiedostona: asetukset, tilikartta, tilikaudet,
                  tositesarjat, kumppanit ja kaikki tositteet (myös luonnokset, saapuneet ja
                  mallit; poistetut eivät ole mukana) liitteiden tietoineen. Rahamäärät ovat
                  JSONissa kokonaislukusentteinä (1234 = 12,34 euroa), ei desimaalilukuina.
tilikartta.csv    numero;nimi;tyyppi;alvkoodi;alvprosentti
tilikaudet.csv    alkaa;loppuu
kumppanit.csv     id;nimi;alvtunnus;maa;osoite;postinumero;kaupunki;email;puhelin;iban
                  (useampi IBAN erotettu pilkulla)
tositteet.csv     id;pvm;tunnus;sarja;tunniste;tyyppi;tila;otsikko;kumppani;viite;laskupvm;
                  erapvm;numero   - vain kirjanpitoon viedyt tositteet. "kumppani" on
                  kumppanit.csv:n id.
viennit.csv       tositeId;tunnus;pvm;tili;tilinNimi;selite;debet;kredit;alvkoodi;
                  alvprosentti;kohdennus   - kirjanpitoon viedyt viennit. Debetien summa
                  on yhtä suuri kuin kreditien summa.
liitteet/         Tositteiden liitteet alkuperäisinä tiedostoina. Nimi on muotoa
                  <tositeId>-<liiteId>-<nimi>.
vienti.sha256     Kaikkien muiden tiedostojen SHA-256-tarkisteet (sha256sum-muoto), joilla
                  voi varmistaa, ettei mikään tiedosto ole muuttunut.

CSV-tiedostojen muoto
---------------------
Merkistö UTF-8 (tavujärjestysmerkillä), kenttien erotin puolipiste, rivinvaihto CRLF.
Kentät, joissa on puolipiste, lainausmerkki tai rivinvaihto, ovat lainausmerkeissä ja sisäiset
lainausmerkit kahdennettu (RFC 4180). Päivämäärät ovat muotoa VVVV-KK-PP. Rahamäärät ovat
desimaalipilkulla ja kahdella desimaalilla ilman tuhaterotinta (esim. -1234,50).
Taulukkolaskentaohjelman kaavoilta suojaamiseksi kaavamerkillä (=, +, @, -) alkava teksti
alkaa CSV:ssä heittomerkillä; tarkka teksti on kirjanpito.json:ssa.
`;
}

function kumppaniRivi(k: Kumppani): (string | number)[] {
  return [
    k.id,
    k.nimi,
    k.alvtunnus ?? '',
    k.maa ?? '',
    k.osoite ?? '',
    k.postinumero ?? '',
    k.kaupunki ?? '',
    k.email ?? '',
    k.puhelin ?? '',
    (k.iban ?? []).join(','),
  ];
}

/**
 * Rakentaa koko kirjanpidon viennin: zip, jossa avoimet CSV-tiedostot, täydellinen JSON, kaikki
 * liitteet ja `vienti.sha256`-tarkistelista (spec "Whole-book export").
 */
export async function rakennaVienti(p: {
  client: KpClient;
  nyt?: () => Date;
}): Promise<{ tiedostonimi: string; zip: Uint8Array }> {
  const { client } = p;
  const nyt = p.nyt ? p.nyt() : new Date();

  const [init, kumppanit, ...korit] = await Promise.all([
    client.haeInit(),
    client.haeKumppanit(),
    ...JSON_KORIT.map((bucket) => client.listaaTositteet({ bucket })),
  ]);
  const kaikki: ListattuTosite[] = korit.flat().sort((a, b) => a.id - b.id);
  const kirjatut = korit[0] ?? [];
  const kirjatutJarjestyksessa = [...kirjatut].sort((a, b) => a.id - b.id);

  const tilit = lataaKartta(init.tilit);
  const tilinNimi = new Map(tilit.map((t) => [t.numero, nimi(t)]));

  // Liitteet: meta + tavut jokaiselle tositteelle, jolla niitä on.
  const liitetiedostot: { polku: string; data: Uint8Array; pakkaa: false }[] = [];
  const tositteetJson: unknown[] = [];
  for (const t of kaikki) {
    const { liitteita, alkupera: _alkupera, ...tallennettu } = t;
    const liitteet: ViedynLiitteenTiedot[] = [];
    if (liitteita > 0) {
      for (const meta of await client.haeLiitteet(t.id)) {
        const liite = await client.haeLiite(meta.id);
        if (!liite) throw new Error(`Liitettä ${meta.id} (tosite ${t.id}) ei löytynyt`);
        const polku = liitePolku(t.id, meta.id, meta.nimi, meta.tyyppi);
        liitetiedostot.push({ polku, data: liite.data, pakkaa: false });
        liitteet.push({ ...meta, polku });
      }
    }
    tositteetJson.push({ ...tallennettu, liitteet });
  }

  const json = {
    muoto: 'penni-kirjanpito',
    versio: 1,
    luotu: nyt.toISOString(),
    asetukset: init.asetukset,
    tilit: init.tilit,
    tilikaudet: init.tilikaudet,
    tositesarjat: init.tositesarjat,
    kumppanit,
    tositteet: tositteetJson,
  };

  const tositteetCsv = csvTiedosto(
    [
      'id',
      'pvm',
      'tunnus',
      'sarja',
      'tunniste',
      'tyyppi',
      'tila',
      'otsikko',
      'kumppani',
      'viite',
      'laskupvm',
      'erapvm',
      'numero',
    ],
    kirjatutJarjestyksessa.map((t) => [
      t.id,
      t.pvm,
      tositeTunniste(t),
      t.sarja,
      t.tunniste,
      t.tyyppi,
      t.tila,
      t.otsikko,
      t.kumppani,
      t.viite,
      t.laskupvm,
      t.erapvm,
      t.numero,
    ]),
  );

  const viennitCsv = csvTiedosto(
    [
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
    ],
    kirjatutJarjestyksessa.flatMap((t) =>
      t.viennit.map((v) => [
        t.id,
        tositeTunniste(t),
        v.pvm,
        v.tili,
        tilinNimi.get(v.tili) ?? '',
        v.selite,
        csvSentit(v.debet),
        csvSentit(v.kredit),
        v.alvKoodi,
        v.alvProsentti,
        v.kohdennus,
      ]),
    ),
  );

  const tilikarttaCsv = csvTiedosto(
    ['numero', 'nimi', 'tyyppi', 'alvkoodi', 'alvprosentti'],
    tilit.map((t) => [
      t.numero,
      nimi(t),
      t.tyyppiKoodi,
      t.data.alvlaji as number | string | undefined,
      t.data.alvprosentti as number | string | undefined,
    ]),
  );

  const tilikaudetCsv = csvTiedosto(
    ['alkaa', 'loppuu'],
    init.tilikaudet.map((k) => [k.alkaa, k.loppuu]),
  );

  const kumppanitCsv = csvTiedosto(
    [
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
    ],
    kumppanit.map(kumppaniRivi),
  );

  const tiedostot: { polku: string; data: Uint8Array; pakkaa?: boolean }[] = [
    { polku: 'LUEMINUT.txt', data: enkoodaa.encode(lueminut()) },
    { polku: 'kirjanpito.json', data: enkoodaa.encode(JSON.stringify(json, null, 2)) },
    { polku: 'tilikartta.csv', data: tilikarttaCsv },
    { polku: 'tilikaudet.csv', data: tilikaudetCsv },
    { polku: 'kumppanit.csv', data: kumppanitCsv },
    { polku: 'tositteet.csv', data: tositteetCsv },
    { polku: 'viennit.csv', data: viennitCsv },
    ...liitetiedostot,
  ];
  tiedostot.push({
    polku: 'vienti.sha256',
    data: enkoodaa.encode(await sha256Lista(tiedostot)),
  });

  const juuri = `${turvallinenNimi(init.asetukset.Nimi ?? '')}-kirjanpito-${paivaIso(nyt)}`;
  const zip = pakkaa(tiedostot.map((t) => ({ ...t, polku: `${juuri}/${t.polku}` })));
  return { tiedostonimi: `${juuri}.zip`, zip };
}
