import type { KpClient } from '@penni/asiakas';
import {
  type Istunto,
  type PyyntoLaskuri,
  haeLaskurit,
  luoClient,
  uusiLaskuri,
} from './asiakas.js';
import { type KirjaTiedot, tallennaAvaten, testiTosite } from './kirjaTiedot.js';
import { type Jakauma, jakauma, pyorista } from './tilasto.js';
import type { WranglerIstunto } from './wrangler.js';

/** Läpäisyraja (spec §4 Q2): lämmin p95 alle tämän jokaisella kutsulla. */
export const Q2_P95_RAJA_MS = 100;

export interface Q2Asetukset {
  /** Mitattavia kutsuja per kutsutyyppi lämpimässä vaiheessa. */
  toistot: number;
  /** Lämmittelykutsuja per kutsutyyppi (ei mukaan tilastoon). */
  lamitys: number;
}

export interface Q2Kutsu {
  /** HttpClient-kutsu kokonaisuudessaan (pyyntö + vastauksen purku rikkaiksi tyypeiksi). */
  kutsu: Jakauma;
  /** Pelkkä HTTP-pyyntö (haku + vastauksen luku), summa jos kutsu teki useamman pyynnön. */
  http: Jakauma;
  /** Ensimmäinen kutsu uudelleenkäynnistyksen jälkeen (kylmä Worker + DO:t). */
  ensimmainenKylmaMs: number;
  /** Vastauksen rivien/tietueiden määrä (vain lukumäärä). */
  vastausRiveja: number | null;
  /** workerd-prosessien CPU-aika / kutsu (ps, 10 ms resoluutio, jaettu kutsumäärällä). */
  workerdCpuMsPerKutsu: number;
  /** DO:n sisältä: SQL-rivejä luettu/kirjoitettu ja käsittelijän kellonaika per kutsu. */
  doRowsReadPerKutsu: number | null;
  doRowsWrittenPerKutsu: number | null;
  doKasittelyMsPerKutsu: number | null;
  /** p95 < 100 ms. */
  lapaisee: boolean;
}

export interface Q2Tulos {
  asetukset: Q2Asetukset;
  jakso: KirjaTiedot['neljannes'];
  kausi: KirjaTiedot['kausi'];
  avasiLukituksen: boolean;
  kutsut: Record<string, Q2Kutsu>;
  /** Tyhjäkäynnin CPU: workerd-prosessien ps-CPU 2 s idle -jaksolta (kohinataso). */
  workerdCpuIdleMsPer2s: number;
  /** Tulkintahuomautukset (CPU-mittauksen rajat, loopback). */
  huomautukset: string[];
  lapaisee: boolean;
}

interface KutsuMaaritys {
  nimi: string;
  aja(client: KpClient): Promise<unknown>;
}

const odota = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Q2: onko oikean kokoinen kirja riittävän nopea? Ajaa (uudelleenkäynnistyksen jälkeen, eli
 * kylmältä Workerilta ja DO:ilta) kunkin kutsun ensin kerran kylmänä ja sen jälkeen
 * `lamitys` + `toistot` kertaa peräkkäin lämpimänä, ja laskee p50/p95. Kutsut ovat samat, joita
 * työpöytä tekee HttpClientin kautta: tositteet (yksi neljännes), saldot (tilikauden loppuun),
 * alv-laskelma (neljännes), raportit tulos/yleinen ja tase/yleinen sekä tositteen tallennus.
 */
export async function q2(
  istunto: Istunto,
  kirjaId: string,
  wrangler: WranglerIstunto,
  tiedot: KirjaTiedot,
  a: Q2Asetukset,
): Promise<Q2Tulos> {
  const laskuri: PyyntoLaskuri = uusiLaskuri();
  const client = luoClient(istunto, kirjaId, laskuri);
  const { kausi, neljannes } = tiedot;
  let avasiLukituksen = false;
  let sarjaNro = 0;

  const kutsut: KutsuMaaritys[] = [
    {
      nimi: 'tositteet',
      aja: (c) => c.listaaTositteet({ alkupvm: neljannes.alkupvm, loppupvm: neljannes.loppupvm }),
    },
    { nimi: 'saldot', aja: (c) => c.haeSaldot({ pvm: kausi.loppuu }) },
    {
      nimi: 'alv',
      aja: (c) => c.haeAlvLaskelma({ alkupvm: neljannes.alkupvm, loppupvm: neljannes.loppupvm }),
    },
    {
      nimi: 'raportti-tulos',
      aja: (c) =>
        c.laadiRaportti({ muoto: 'tulos/yleinen', pvm: kausi.loppuu, alkupvm: kausi.alkaa }),
    },
    {
      nimi: 'raportti-tase',
      aja: (c) => c.laadiRaportti({ muoto: 'tase/yleinen', pvm: kausi.loppuu }),
    },
    {
      nimi: 'tositteen-tallennus',
      aja: async (c) => {
        const r = await tallennaAvaten(
          c,
          tiedot,
          testiTosite(tiedot, neljannes.loppupvm, 10_000 + ++sarjaNro),
        );
        avasiLukituksen ||= r.avasiLukituksen;
        return r.tosite;
      },
    },
  ];

  const maara = (tulos: unknown): number | null => {
    if (Array.isArray(tulos)) return tulos.length;
    if (tulos instanceof Map) return tulos.size;
    if (tulos && typeof tulos === 'object' && 'koodit' in tulos) {
      return (tulos as { koodit: Map<unknown, unknown> }).koodit.size;
    }
    return null;
  };

  // 1) Kylmä vaihe: ensimmäinen kutsu uudelleenkäynnistyksen jälkeen kullekin tyypille.
  const kylmat: Record<string, number> = {};
  for (const k of kutsut) {
    const alku = performance.now();
    await k.aja(client);
    kylmat[k.nimi] = pyorista(performance.now() - alku);
  }

  // 2) Tyhjäkäynti: workerdin CPU-kohinataso (ps-resoluutio 10 ms).
  const idleAlku = wrangler.workerdCpuMs();
  await odota(2000);
  const idle = wrangler.workerdCpuMs() - idleAlku;

  // 3) Lämmin vaihe kutsutyypeittäin.
  const tulos: Record<string, Q2Kutsu> = {};
  for (const k of kutsut) {
    for (let i = 0; i < a.lamitys; i++) await k.aja(client);
    await haeLaskurit(istunto, kirjaId, true); // nollaa DO-laskurit tämän kutsutyypin ajaksi
    const kutsuMs: number[] = [];
    const httpMs: number[] = [];
    let rivit: number | null = null;
    const cpuAlku = wrangler.workerdCpuMs();
    for (let i = 0; i < a.toistot; i++) {
      const pyyntoja = laskuri.mitat.length;
      const alku = performance.now();
      const vastaus = await k.aja(client);
      kutsuMs.push(performance.now() - alku);
      httpMs.push(laskuri.mitat.slice(pyyntoja).reduce((s, m) => s + m.ms, 0));
      rivit ??= maara(vastaus);
    }
    const cpu = wrangler.workerdCpuMs() - cpuAlku;
    const doLaskurit = (await haeLaskurit(istunto, kirjaId, true)).kirja;
    const kutsuJakauma = jakauma(kutsuMs);
    tulos[k.nimi] = {
      kutsu: kutsuJakauma,
      http: jakauma(httpMs),
      ensimmainenKylmaMs: kylmat[k.nimi] as number,
      vastausRiveja: rivit,
      workerdCpuMsPerKutsu: pyorista(cpu / a.toistot),
      doRowsReadPerKutsu: doLaskurit ? Math.round(doLaskurit.rowsRead / a.toistot) : null,
      doRowsWrittenPerKutsu: doLaskurit ? Math.round(doLaskurit.rowsWritten / a.toistot) : null,
      doKasittelyMsPerKutsu: doLaskurit ? pyorista(doLaskurit.kasittelyMs / a.toistot) : null,
      lapaisee: kutsuJakauma.p95Ms < Q2_P95_RAJA_MS,
    };
  }

  return {
    asetukset: a,
    jakso: neljannes,
    kausi,
    avasiLukituksen,
    kutsut: tulos,
    workerdCpuIdleMsPer2s: idle,
    huomautukset: [
      'CPU: wrangler dev ei kerro pyyntökohtaista CPU-aikaa; workerdCpuMsPerKutsu on workerd-prosessien ' +
        'ps-CPU-aika (10 ms resoluutio) jaettuna kutsumäärällä, ja sisältää Workerin, Control DO:n ' +
        '(tunnistus + jäsenyys) ja Book DO:n työn sekä HTTP-käsittelyn. Ylärajaarvio tuotannon CPU:lle.',
      'doKasittelyMsPerKutsu: performance.now()-erotus DO:n käsittelijän ympäriltä. Paikallisessa ' +
        'workerdissä kello etenee, tuotannossa se on Spectre-suojauksen vuoksi kvantisoitu/jäädytetty ' +
        'I/O-rajojen välillä; suuntaa-antava arvio käsittelijän (lähes puhtaasti synkronisen) työstä, ' +
        'ei laskutettu CPU-aika.',
      'Seinäaika sisältää paikallisen HTTP-kierron (loopback) eikä EU-verkkoviivettä.',
    ],
    lapaisee: Object.values(tulos).every((k) => k.lapaisee),
  };
}
