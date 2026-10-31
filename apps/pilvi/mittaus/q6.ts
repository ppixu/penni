import { createHash } from 'node:crypto';
import type { KpClient } from '@penni/asiakas';
import {
  type Tilitapahtuma,
  lataaKartta,
  lueTasmaysSaannot,
  muodostaTyolista,
  tasmayksenPankkitili,
} from '@penni/engine';
import type { Cents } from '@penni/euro';
import {
  type Istunto,
  type LaskuriVastaus,
  haeLaskurit,
  luoClient,
  uusiLaskuri,
} from './asiakas.js';
import { type KirjaTiedot, tallennaAvaten, testiTosite } from './kirjaTiedot.js';
import { pdfKuorma } from './synteettinen.js';
import { pyorista, satunnainen } from './tilasto.js';
import type { WranglerIstunto } from './wrangler.js';

/**
 * Yhden neljänneksen "tyypillisen käytön" oletukset. Kaikki ovat parametreja, jotta omistaja voi
 * säätää ne omaa käyttöään vastaaviksi; tulostiedosto kirjaa käytetyt arvot.
 */
export interface Q6Asetukset {
  /** Selausistuntoja neljänneksessä: jokainen = haeInit + tositelistaus (≈ yksi viikkoa kohti). */
  istunnot: number;
  /** Kirjattavia tositteita; jokaisesta avataan haeTosite ja liitetään kuitti-PDF. */
  tositteita: number;
  /** Kuitti-PDF:n koko tavuina [min, max]. */
  kuittiKoko: [number, number];
  /** Täsmättäviä tiliotteita ja niiden tapahtumamäärä. */
  tiliotteita: number;
  tapahtumiaTiliotteessa: number;
  siemen: number;
}

export const OLETUS_Q6: Q6Asetukset = {
  istunnot: 13,
  tositteita: 45,
  kuittiKoko: [20_000, 200_000],
  tiliotteita: 3,
  tapahtumiaTiliotteessa: 30,
  siemen: 6,
};

/** Yhden vaiheen laskurit (Worker + Book DO) ja asiakkaan puolen lukemat. */
export interface Q6Vaihe {
  nimi: string;
  /** Asiakkaan lähettämät HTTP-pyynnöt (HttpClient); täsmää Workerin `pyynnot`-laskuriin. */
  asiakasPyyntoja: number;
  kestoMs: number;
  workerdCpuMs: number;
  laskurit: LaskuriVastaus;
  /** DO-esiintymä vaihtui vaiheen aikana (eviction): DO-laskurit ovat tällöin vajaat. */
  doEsiintymaVaihtui: boolean;
}

export interface Q6Yhteenveto {
  workerPyyntoja: number;
  bookDoKutsuja: number;
  controlDoKutsuja: number;
  r2: { head: number; put: number; get: number; putTavut: number; getTavut: number };
  doSqlRowsRead: number;
  doSqlRowsWritten: number;
  doSqlLauseita: number;
  /** Summa käsittelijöiden performance.now()-ajoista DO:ssa (suuntaa-antava, ei laskutettu CPU). */
  doKasittelyMs: number;
  /** workerd-prosessien CPU-aika koko toistolle (ps, ≥10 ms resoluutio). */
  workerdCpuMs: number;
  seinaaikaMs: number;
  asiakasPyyntoja: number;
  liitetavutYhteensa: number;
  laskurit_tasmaavat: boolean;
}

export interface Q6Tulos {
  asetukset: Q6Asetukset;
  jakso: KirjaTiedot['neljannes'];
  vaiheet: Q6Vaihe[];
  yhteensa: Q6Yhteenveto;
  /** Täsmäytyksen sanity: jo kirjattuja rivejä / kaikki rivit (vain lukumäärä). */
  tasmaytysTyolistaRivit: number;
  avasiLukituksen: boolean;
  huomautukset: string[];
}

/** Synteettinen tiliote: osa riveistä täsmää juuri kirjattuihin summiin, loput ovat uusia. */
function tapahtumat(
  rnd: () => number,
  n: number,
  alku: string,
  kirjatut: readonly number[],
): Tilitapahtuma[] {
  const alkuMs = Date.parse(`${alku}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const kirjattu = i % 2 === 0 && kirjatut.length > 0;
    const sentit = kirjattu
      ? (kirjatut[Math.floor(rnd() * kirjatut.length)] as number)
      : 1000 + Math.floor(rnd() * 90_000);
    return {
      pvm: new Date(alkuMs + Math.floor(rnd() * 28) * 86_400_000).toISOString().slice(0, 10),
      nimi: `TESTI OY ${1 + Math.floor(rnd() * 20)}`,
      maara: (kirjattu ? -sentit : (rnd() < 0.5 ? -1 : 1) * sentit) as Cents,
      viite: String(1000 + i),
    } satisfies Tilitapahtuma;
  });
}

/**
 * Q6: käyttölaskurit yhden neljänneksen tyypillisestä käytöstä (spec §4 Q6, vain lukumäärät):
 * selausistunnot (init + listaus), tositteiden kirjaus (avaus + tallennus + kuitti-PDF R2:een),
 * alv-laskelma, kaksi raporttia ja kolme tiliotteen täsmäytystä (lukuja). Kaikki kulkee HttpClientin
 * kautta Workeriin, joka laskee pyynnöt ja DO-kutsut, ja Book DO laskee R2-operaatiot sekä SQL-rivit
 * (PILVI_KEHITYS_LASKURIT). Hinnoittelulaskua ei tehdä tässä.
 */
export async function q6(
  istunto: Istunto,
  kirjaId: string,
  wrangler: WranglerIstunto,
  tiedot: KirjaTiedot,
  a: Q6Asetukset = OLETUS_Q6,
): Promise<Q6Tulos> {
  const rnd = satunnainen(a.siemen);
  const laskuri = uusiLaskuri();
  const client: KpClient = luoClient(istunto, kirjaId, laskuri);
  const { kausi, neljannes } = tiedot;
  const vaiheet: Q6Vaihe[] = [];
  let avasiLukituksen = false;
  let liitetavut = 0;
  let tasmaytysRivit = 0;
  const kirjatutSentit: number[] = [];

  let esiintyma = (await haeLaskurit(istunto, kirjaId, true)).kirja?.esiintyma;
  const vaihe = async (nimi: string, ajo: () => Promise<void>): Promise<void> => {
    await haeLaskurit(istunto, kirjaId, true);
    const pyyntoja0 = laskuri.pyynnot;
    const cpu0 = wrangler.workerdCpuMs();
    const t0 = performance.now();
    await ajo();
    const kestoMs = performance.now() - t0;
    const cpu = wrangler.workerdCpuMs() - cpu0;
    const laskurit = await haeLaskurit(istunto, kirjaId, true);
    vaiheet.push({
      nimi,
      asiakasPyyntoja: laskuri.pyynnot - pyyntoja0,
      kestoMs: pyorista(kestoMs),
      workerdCpuMs: cpu,
      laskurit,
      doEsiintymaVaihtui: laskurit.kirja?.esiintyma !== esiintyma,
    });
    esiintyma = laskurit.kirja?.esiintyma;
  };

  // 1) Selaus: istunnon alussa init-paketti ja neljänneksen tositelistaus.
  await vaihe('selaus', async () => {
    for (let i = 0; i < a.istunnot; i++) {
      await client.haeInit();
      await client.listaaTositteet({ alkupvm: neljannes.alkupvm, loppupvm: neljannes.loppupvm });
    }
  });

  // 2) Kirjaus: tosite tallennetaan, avataan ja sille liitetään kuitti-PDF (R2).
  await vaihe('kirjaus-ja-kuitit', async () => {
    for (let i = 0; i < a.tositteita; i++) {
      const sentit = 1500 + Math.floor(rnd() * 80_000);
      const { tosite, avasiLukituksen: avasi } = await tallennaAvaten(
        client,
        tiedot,
        testiTosite(tiedot, neljannes.loppupvm, sentit, 'kulu'),
      );
      avasiLukituksen ||= avasi;
      kirjatutSentit.push(sentit);
      await client.haeTosite(tosite.id);
      const koko = Math.floor(a.kuittiKoko[0] + rnd() * (a.kuittiKoko[1] - a.kuittiKoko[0]));
      const data = pdfKuorma(koko, a.siemen * 100_000 + i);
      await client.tallennaLiite({
        tosite: tosite.id,
        nimi: `kuitti-${i + 1}.pdf`,
        tyyppi: 'application/pdf',
        sha: createHash('sha256').update(data).digest('hex'),
        luotu: new Date().toISOString(),
        data,
      });
      liitetavut += koko;
    }
  });

  // 3) Alv-laskelma ja kaksi raporttia.
  await vaihe('alv-ja-raportit', async () => {
    await client.haeAlvLaskelma({ alkupvm: neljannes.alkupvm, loppupvm: neljannes.loppupvm });
    await client.laadiRaportti({ muoto: 'tulos/yleinen', pvm: kausi.loppuu, alkupvm: kausi.alkaa });
    await client.laadiRaportti({ muoto: 'tase/yleinen', pvm: kausi.loppuu });
  });

  // 4) Tiliotteiden täsmäytys (lukupolku: init + tositteet + kumppanit + saldot, kuten työpöydän
  //    Täsmäytys-näkymä ja CLI:n tiliote-työkalu).
  await vaihe('tasmaytys', async () => {
    for (let i = 0; i < a.tiliotteita; i++) {
      const init = await client.haeInit();
      const chart = lataaKartta(init.tilit);
      const saannot = lueTasmaysSaannot(init.asetukset);
      const pankkitili = tasmayksenPankkitili(init.asetukset, chart) ?? tiedot.tilit.pankki;
      const kk = new Date(Date.parse(`${neljannes.alkupvm}T00:00:00Z`));
      kk.setUTCMonth(kk.getUTCMonth() + i);
      const alkuPvm = kk.toISOString().slice(0, 10);
      const tyolista = await muodostaTyolista(
        client,
        { tapahtumat: tapahtumat(rnd, a.tapahtumiaTiliotteessa, alkuPvm, kirjatutSentit) },
        [],
        { pankkitili, chart, saannot },
      );
      tasmaytysRivit += tyolista.rivit.length;
    }
  });

  const summa = (f: (v: Q6Vaihe) => number): number => vaiheet.reduce((s, v) => s + f(v), 0);
  const r2 = (avain: 'head' | 'put' | 'get' | 'putTavut' | 'getTavut'): number =>
    summa((v) => v.laskurit.kirja?.r2[avain] ?? 0);
  const yhteensa: Q6Yhteenveto = {
    workerPyyntoja: summa((v) => v.laskurit.worker.pyynnot),
    bookDoKutsuja: summa((v) => v.laskurit.worker.kirjaDoKutsut),
    controlDoKutsuja: summa((v) => v.laskurit.worker.controlDoKutsut),
    r2: {
      head: r2('head'),
      put: r2('put'),
      get: r2('get'),
      putTavut: r2('putTavut'),
      getTavut: r2('getTavut'),
    },
    doSqlRowsRead: summa((v) => v.laskurit.kirja?.rowsRead ?? 0),
    doSqlRowsWritten: summa((v) => v.laskurit.kirja?.rowsWritten ?? 0),
    doSqlLauseita: summa((v) => v.laskurit.kirja?.sqlLauseita ?? 0),
    doKasittelyMs: pyorista(summa((v) => v.laskurit.kirja?.kasittelyMs ?? 0)),
    workerdCpuMs: summa((v) => v.workerdCpuMs),
    seinaaikaMs: pyorista(summa((v) => v.kestoMs)),
    asiakasPyyntoja: summa((v) => v.asiakasPyyntoja),
    liitetavutYhteensa: liitetavut,
    laskurit_tasmaavat: false,
  };
  yhteensa.laskurit_tasmaavat =
    yhteensa.asiakasPyyntoja === yhteensa.workerPyyntoja &&
    yhteensa.bookDoKutsuja === yhteensa.workerPyyntoja &&
    vaiheet.every((v) => !v.doEsiintymaVaihtui);

  return {
    asetukset: a,
    jakso: neljannes,
    vaiheet,
    yhteensa,
    tasmaytysTyolistaRivit: tasmaytysRivit,
    avasiLukituksen,
    huomautukset: [
      'Aineisto on synteettistä (tositteet, kuitit, tiliote); määrät ovat kirjan mittakaavassa, ei sisältöä.',
      'Worker laskee pyynnöt ja DO-kutsut moduulin tilassa (yksi isolaatti paikallisessa devissä); Book DO ' +
        'laskee R2-operaatiot ja SQL-rivit muistissa (doEsiintymaVaihtui kertoo evictionin).',
      'Jokainen pyyntö tekee 3 Control DO -kutsua (haeSessio, haeKayttajaTiedot, onJasen) eikä ' +
        'tuloksia välimuistita; se on mitattu eikä optimoitu.',
      'rowsRead/rowsWritten ovat DO SQLiten kursorin lukemat (laskutusyksiköt); sisältävät myös last_insert_rowid-kyselyt.',
      'workerdCpuMs: ps-CPU (10 ms resoluutio) workerd-prosesseille; ei pyyntökohtainen CPU-aika eikä DO:n laskutettu kesto.',
    ],
  };
}
