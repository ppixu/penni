// Pilvi-spiken mittaus (Q2 nopeus, Q3 numeroinnin samanaikaisuus, Q6 käyttölaskurit).
//
//   pnpm --filter @penni/pilvi mittaa -- --kirja <polku/kirja.penni> [--vain q2|q3|q6]
//   pnpm --filter @penni/pilvi mittaa -- --synteettinen            (ei oikeaa kirjaa)
//
// Käynnistää paikallisen `wrangler dev` -palvelimen (ei tiliyhteyttä, ei deployta), tuo kirjan
// kopion sen Book DO:hon kehitystuontireitillä, ajaa mittaukset ja kirjoittaa JSON + lyhyt
// markdown-yhteenveto git-ignoroituun hakemistoon (oletus mittaus/tulokset/). Tuloksiin tulee vain
// aikoja ja lukumääriä, ei kirjan sisältöä. Lue ohje: `mittaa -- --apua`.
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Istunto, luoClient, luoTyhjaKirja, rekisteroi } from './asiakas.js';
import { type KirjaTiedot, selvitaKirja } from './kirjaTiedot.js';
import { type Q2Asetukset, type Q2Tulos, Q2_P95_RAJA_MS, q2 } from './q2.js';
import { type Q3Tulos, q3 } from './q3.js';
import { OLETUS_Q6, type Q6Asetukset, type Q6Tulos, q6 } from './q6.js';
import {
  OLETUS_SYNTEETTINEN,
  type SynteettinenAsetukset,
  luoSynteettinenKirja,
} from './synteettinen.js';
import { type TuontiTulos, tuoKirja } from './tuonti.js';
import { type WranglerIstunto, kaynnistaWrangler } from './wrangler.js';

export type Kysymys = 'q2' | 'q3' | 'q6';
const KAIKKI: Kysymys[] = ['q2', 'q3', 'q6'];
const TAMA = dirname(fileURLToPath(import.meta.url));

export interface MittausAsetukset {
  /** Polku `.penni`-kirjaan (kopioidaan, alkuperäistä ei muuteta) tai synteettinen. */
  kirja: string | 'synteettinen';
  vain: Kysymys[];
  tulokset: string;
  q2: Q2Asetukset;
  q3Maara: number;
  q6: Q6Asetukset;
  synteettinen: SynteettinenAsetukset;
  alkupvm?: string;
  loppupvm?: string;
  /** Lokirivit stderriin (oletus: päällä). */
  puhu?: boolean;
}

export const OLETUS_ASETUKSET: Omit<MittausAsetukset, 'kirja'> = {
  vain: KAIKKI,
  tulokset: join(TAMA, 'tulokset'),
  q2: { toistot: 50, lamitys: 5 },
  q3Maara: 50,
  q6: OLETUS_Q6,
  synteettinen: OLETUS_SYNTEETTINEN,
};

const OHJE = `Käyttö:
  mittaa --kirja <polku.penni> [--vain q2|q3|q6] [valitsimet]
  mittaa --synteettinen [valitsimet]

Valitsimet:
  --kirja <polku>        Todellisen kirjan kopio (.penni). Luetaan temp-kopiosta; alkuperäinen ei muutu.
  --synteettinen         Käytä generoitua synteettistä kirjaa (ei oikeaa dataa).
  --vain q2|q3|q6        Aja vain tämä kysymys (toistettava tai pilkuilla: q2,q6).
  --tulokset <hakemisto> Tulosten hakemisto (oletus apps/pilvi/mittaus/tulokset, git-ignoroitu).
  --toistot <n>          Q2: mitattavia kutsuja per kutsutyyppi (oletus 50).
  --lamitys <n>          Q2: lämmittelykutsuja (oletus 5).
  --samanaikaisia <n>    Q3: rinnakkaisia kirjauksia (oletus 50).
  --alkupvm/--loppupvm   Mitattava jakso YYYY-MM-DD (oletus: uusimman kauden vilkkain neljännes).
  --tositteita <n>       Synteettinen: tositteita (oletus 3000), --liitteita <n> (150).
  --q6-tositteita <n>    Q6: kirjattavia tositteita/kuitteja (oletus 45).
  --apua                 Tämä ohje.`;

export function parsi(argv: string[]): MittausAsetukset | 'apua' {
  const a: MittausAsetukset = {
    kirja: 'synteettinen',
    ...OLETUS_ASETUKSET,
    q2: { ...OLETUS_ASETUKSET.q2 },
    q6: { ...OLETUS_Q6 },
    synteettinen: { ...OLETUS_SYNTEETTINEN },
    puhu: true,
  };
  let kirjaAnnettu = false;
  const args = argv.filter((x) => x !== '--');
  const arvo = (i: number): string => {
    const v = args[i + 1];
    if (v === undefined) throw new Error(`Valitsin ${args[i]} tarvitsee arvon`);
    return v;
  };
  const luku = (i: number): number => {
    const n = Number(arvo(i));
    if (!Number.isInteger(n) || n < 1)
      throw new Error(`${args[i]}: odotettiin positiivista kokonaislukua`);
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--apua':
      case '--help':
        return 'apua';
      case '--kirja':
        a.kirja = resolve(arvo(i++));
        kirjaAnnettu = true;
        break;
      case '--synteettinen':
        a.kirja = 'synteettinen';
        kirjaAnnettu = true;
        break;
      case '--vain': {
        const kysymykset = arvo(i++).split(',') as Kysymys[];
        if (kysymykset.some((k) => !KAIKKI.includes(k))) throw new Error('--vain: q2, q3 tai q6');
        a.vain = kysymykset;
        break;
      }
      case '--tulokset':
        a.tulokset = resolve(arvo(i++));
        break;
      case '--toistot':
        a.q2.toistot = luku(i++);
        break;
      case '--lamitys':
        a.q2.lamitys = luku(i++);
        break;
      case '--samanaikaisia':
        a.q3Maara = luku(i++);
        break;
      case '--alkupvm':
        a.alkupvm = arvo(i++);
        break;
      case '--loppupvm':
        a.loppupvm = arvo(i++);
        break;
      case '--tositteita':
        a.synteettinen.tositteita = luku(i++);
        break;
      case '--liitteita':
        a.synteettinen.liitteita = luku(i++);
        break;
      case '--q6-tositteita':
        a.q6.tositteita = luku(i++);
        break;
      default:
        throw new Error(`Tuntematon valitsin ${args[i]}\n\n${OHJE}`);
    }
  }
  if (!kirjaAnnettu) throw new Error(`Anna --kirja <polku> tai --synteettinen\n\n${OHJE}`);
  return a;
}

export interface MittausTulos {
  hakemisto: string;
  ymparisto: Record<string, unknown>;
  kirja: Record<string, unknown>;
  q2?: Q2Tulos | { virhe: string };
  q3?: Q3Tulos | { virhe: string };
  q6?: Q6Tulos | { virhe: string };
}

const virheTeksti = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 500);

function wranglerVersio(): string {
  try {
    const req = createRequire(join(TAMA, '..', 'package.json'));
    return (req('wrangler/package.json') as { version: string }).version;
  } catch {
    return 'tuntematon';
  }
}

/** Aja mittaus annetuilla asetuksilla; kirjoittaa tulokset ja palauttaa ne (testit käyttävät samaa). */
export async function mittaa(a: MittausAsetukset): Promise<MittausTulos> {
  const puhu = (s: string): void => {
    if (a.puhu !== false) process.stderr.write(`[mittaa] ${s}\n`);
  };
  const tyo = mkdtempSync(join(tmpdir(), 'penni-mittaus-tyo-'));
  const persist = join(tyo, 'wrangler-tila');
  mkdirSync(persist, { recursive: true });
  const aikaleima = new Date().toISOString().replace(/[:.]/g, '-');
  const hakemisto = join(a.tulokset, aikaleima);
  mkdirSync(hakemisto, { recursive: true });
  let wrangler: WranglerIstunto | undefined;
  try {
    // Lähdekirja: annettu tai synteettinen (temp-hakemistoon).
    let lahde: string;
    let synteettinenTiedot: Record<string, unknown> | undefined;
    if (a.kirja === 'synteettinen') {
      lahde = join(tyo, 'synteettinen.penni');
      puhu(`generoidaan synteettinen kirja (${a.synteettinen.tositteita} tositetta)…`);
      synteettinenTiedot = { ...(await luoSynteettinenKirja(lahde, a.synteettinen)) };
    } else {
      lahde = a.kirja;
    }

    const tulos: MittausTulos = {
      hakemisto,
      ymparisto: {
        aikaleima: new Date().toISOString(),
        node: process.version,
        wrangler: wranglerVersio(),
        alusta: `${platform()} ${release()} ${cpus()[0]?.model ?? ''} x${cpus().length}`,
        ajotapa: 'wrangler dev --local (workerd, DO SQLite, paikallinen R2); ei Cloudflare-tiliä',
      },
      kirja: {
        lahde: a.kirja === 'synteettinen' ? 'synteettinen' : 'kopio (nimeä ei kirjata)',
        tiedostoTavut: statSync(lahde).size,
        ...(synteettinenTiedot ? { synteettinen: synteettinenTiedot } : {}),
      },
    };

    wrangler = await kaynnistaWrangler({ persistHakemisto: persist });
    puhu(`wrangler dev käynnissä (pid ${wrangler.pid})`);
    const istunto: Istunto = await rekisteroi(wrangler.pohja);

    /** Tuo kirja tuoreeksi Book DO:ksi; palauttaa kirjaId:n ja perustiedot. */
    const tuoUusi = async (
      nimi: string,
    ): Promise<{ kirjaId: string; tuonti: TuontiTulos; tiedot: KirjaTiedot }> => {
      const kirjaId = await luoTyhjaKirja(istunto);
      puhu(`${nimi}: tuodaan kirja…`);
      const tuonti = await tuoKirja(istunto, kirjaId, lahde);
      puhu(
        `${nimi}: tuotu ${Object.entries(tuonti.rivit)
          .map(([t, n]) => `${t}=${n}`)
          .join(' ')} (${tuonti.liiteTavut} liitetavua, ${tuonti.kestoMs} ms)`,
      );
      const tiedot = await selvitaKirja(luoClient(istunto, kirjaId), {
        ...(a.alkupvm ? { alkupvm: a.alkupvm } : {}),
        ...(a.loppupvm ? { loppupvm: a.loppupvm } : {}),
      });
      return { kirjaId, tuonti, tiedot };
    };
    const kirjaYhteenveto = (t: TuontiTulos, tiedot: KirjaTiedot): Record<string, unknown> => ({
      ...tulos.kirja,
      tuonti: t,
      kausi: tiedot.kausi,
      kaudenTositteita: tiedot.kaudenTositteita,
      mitattuJakso: tiedot.neljannes,
    });

    if (a.vain.includes('q2')) {
      try {
        const { kirjaId, tuonti, tiedot } = await tuoUusi('q2');
        tulos.kirja = kirjaYhteenveto(tuonti, tiedot);
        // Kylmä mittaus: uudelleenkäynnistys samalla pysyvällä tilalla (Worker ja DO:t kylmiä).
        await wrangler.pysayta();
        wrangler = await kaynnistaWrangler({ persistHakemisto: persist });
        puhu('q2: wrangler käynnistetty uudelleen (kylmä mittaus), ajetaan…');
        istunto.pohja = wrangler.pohja; // uusi portti; token ja kirjat säilyvät persist-tilassa
        tulos.q2 = await q2(istunto, kirjaId, wrangler, tiedot, a.q2);
      } catch (e) {
        tulos.q2 = { virhe: virheTeksti(e) };
        puhu(`q2 epäonnistui: ${virheTeksti(e)}`);
      }
    }
    if (a.vain.includes('q3')) {
      try {
        const { kirjaId, tuonti, tiedot } = await tuoUusi('q3');
        if (!tulos.kirja.tuonti) tulos.kirja = kirjaYhteenveto(tuonti, tiedot);
        const q3Tulos = await q3(istunto, kirjaId, tiedot, a.q3Maara);
        // Sama koe tuoreessa tyhjässä kirjassa: numerot täsmälleen 1…N.
        const tyhjaId = await luoTyhjaKirja(istunto, true);
        const tyhjaTiedot = await selvitaKirja(luoClient(istunto, tyhjaId));
        q3Tulos.tyhjaKirja = await q3(istunto, tyhjaId, tyhjaTiedot, a.q3Maara);
        q3Tulos.lapaisee &&= q3Tulos.tyhjaKirja.lapaisee;
        tulos.q3 = q3Tulos;
      } catch (e) {
        tulos.q3 = { virhe: virheTeksti(e) };
        puhu(`q3 epäonnistui: ${virheTeksti(e)}`);
      }
    }
    if (a.vain.includes('q6')) {
      try {
        const { kirjaId, tuonti, tiedot } = await tuoUusi('q6');
        if (!tulos.kirja.tuonti) tulos.kirja = kirjaYhteenveto(tuonti, tiedot);
        tulos.q6 = await q6(istunto, kirjaId, wrangler, tiedot, a.q6);
      } catch (e) {
        tulos.q6 = { virhe: virheTeksti(e) };
        puhu(`q6 epäonnistui: ${virheTeksti(e)}`);
      }
    }

    await wrangler.pysayta();
    wrangler = undefined;
    kirjoitaTulokset(tulos);
    puhu(`tulokset: ${hakemisto}`);
    return tulos;
  } finally {
    if (wrangler) await wrangler.pysayta();
    rmSync(tyo, { recursive: true, force: true });
  }
}

function kirjoitaTulokset(t: MittausTulos): void {
  const kirjoita = (nimi: string, data: unknown): void =>
    writeFileSync(join(t.hakemisto, nimi), `${JSON.stringify(data, null, 2)}\n`);
  kirjoita('ymparisto.json', { ymparisto: t.ymparisto, kirja: t.kirja });
  if (t.q2) kirjoita('q2.json', t.q2);
  if (t.q3) kirjoita('q3.json', t.q3);
  if (t.q6) kirjoita('q6.json', t.q6);
  writeFileSync(join(t.hakemisto, 'yhteenveto.md'), yhteenvetoMd(t));
}

const ms = (x: number): string => `${x.toFixed(1)}`;

/** Lyhyt markdown-yhteenveto: vain aikoja ja lukumääriä. */
export function yhteenvetoMd(t: MittausTulos): string {
  const r: string[] = ['# Pilvi-spike: mittaustulokset', ''];
  r.push(`Ajettu ${String(t.ymparisto.aikaleima)}; ${String(t.ymparisto.ajotapa)}.`);
  r.push(
    `Alusta: ${String(t.ymparisto.alusta)}; node ${String(t.ymparisto.node)}; wrangler ${String(t.ymparisto.wrangler)}.`,
  );
  const tuonti = t.kirja.tuonti as TuontiTulos | undefined;
  if (tuonti) {
    r.push('', '## Kirja', '');
    r.push(
      `- Lähde: ${String(t.kirja.lahde)}, ${(Number(t.kirja.tiedostoTavut) / 1e6).toFixed(1)} MB`,
    );
    r.push(
      `- Rivit: ${Object.entries(tuonti.rivit)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')}`,
    );
    r.push(
      `- Liitteitä ${tuonti.liitteita} (${(tuonti.liiteTavut / 1e6).toFixed(1)} MB → R2); tuonti ${(tuonti.kestoMs / 1000).toFixed(1)} s; skeema ${tuonti.skeemaEnnen}→${tuonti.skeemaJalkeen}`,
    );
    if (tuonti.ohitetutTaulut.length)
      r.push(`- Ohitetut taulut: ${tuonti.ohitetutTaulut.join(', ')}`);
  }
  const q2t = t.q2;
  if (q2t) {
    r.push('', '## Q2: nopeus', '');
    if ('virhe' in q2t) r.push(`Epäonnistui: ${q2t.virhe}`);
    else {
      r.push(
        `Jakso ${q2t.jakso.alkupvm}…${q2t.jakso.loppupvm} (${q2t.jakso.tositteita} tositetta); ${q2t.asetukset.toistot} mitattua kutsua / tyyppi, ${q2t.asetukset.lamitys} lämmittelyä. Raja: lämmin p95 < ${Q2_P95_RAJA_MS} ms.`,
        '',
      );
      r.push(
        '| Kutsu | p50 ms | p95 ms | max ms | HTTP p95 ms | kylmä 1. ms | workerd CPU ms/kutsu | DO rowsRead | DO rowsWritten | läpi |',
      );
      r.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|:--:|');
      for (const [nimi, k] of Object.entries(q2t.kutsut)) {
        r.push(
          `| ${nimi} | ${ms(k.kutsu.p50Ms)} | ${ms(k.kutsu.p95Ms)} | ${ms(k.kutsu.maxMs)} | ${ms(k.http.p95Ms)} | ${ms(k.ensimmainenKylmaMs)} | ${ms(k.workerdCpuMsPerKutsu)} | ${k.doRowsReadPerKutsu ?? '-'} | ${k.doRowsWrittenPerKutsu ?? '-'} | ${k.lapaisee ? 'kyllä' : 'EI'} |`,
        );
      }
      r.push(
        '',
        `Q2 yhteensä: ${q2t.lapaisee ? 'LÄPI' : 'EI LÄPI'}. ${q2t.huomautukset.join(' ')}`,
      );
    }
  }
  const q3t = t.q3;
  if (q3t) {
    r.push('', '## Q3: numeroinnin samanaikaisuus', '');
    if ('virhe' in q3t) r.push(`Epäonnistui: ${q3t.virhe}`);
    else {
      for (const v of q3t.vaiheet) {
        r.push(
          `- ${v.nimi}: ${v.onnistui}/${v.samanaikaisia} onnistui; numerot ${v.saadutNumerot[0]}…${v.saadutNumerot[v.saadutNumerot.length - 1]} (odotettu ${v.odotettuAlue[0]}…${v.odotettuAlue[1]}); kaksoisnumeroita ${v.kaksoiskappaleita}, aukkoja ${v.aukkoja}; kirjattuja lokirivejä ${v.lokiRivejaKirjattu} (yhteensä ${v.lokiRivejaYhteensa}); erä ${ms(v.erankestoMs)} ms, pyyntö p95 ${ms(v.pyynnonAika.p95Ms)} ms → ${v.lapaisee ? 'LÄPI' : 'EI LÄPI'}`,
        );
      }
      for (const v of q3t.tyhjaKirja?.vaiheet ?? []) {
        r.push(
          `- tyhjä kirja, ${v.nimi}: ${v.onnistui}/${v.samanaikaisia} onnistui; numerot ${v.saadutNumerot[0]}…${v.saadutNumerot[v.saadutNumerot.length - 1]} (odotettu ${v.odotettuAlue[0]}…${v.odotettuAlue[1]}); kaksoisnumeroita ${v.kaksoiskappaleita}, aukkoja ${v.aukkoja}; kirjattuja lokirivejä ${v.lokiRivejaKirjattu}; erä ${ms(v.erankestoMs)} ms → ${v.lapaisee ? 'LÄPI' : 'EI LÄPI'}`,
        );
      }
      r.push('', `Q3 yhteensä: ${q3t.lapaisee ? 'LÄPI' : 'EI LÄPI'}`);
    }
  }
  const q6t = t.q6;
  if (q6t) {
    r.push('', '## Q6: käyttölaskurit (yksi neljännes)', '');
    if ('virhe' in q6t) r.push(`Epäonnistui: ${q6t.virhe}`);
    else {
      const y = q6t.yhteensa;
      r.push(
        `Oletukset: ${q6t.asetukset.istunnot} selausistuntoa, ${q6t.asetukset.tositteita} tositetta + kuittia (${q6t.asetukset.kuittiKoko[0] / 1000}–${q6t.asetukset.kuittiKoko[1] / 1000} kt), ${q6t.asetukset.tiliotteita} tiliotetta × ${q6t.asetukset.tapahtumiaTiliotteessa} tapahtumaa, alv + 2 raporttia.`,
        '',
      );
      r.push('| Laskuri | Yhteensä |', '|---|---:|');
      r.push(`| Pyynnöt Workerille | ${y.workerPyyntoja} |`);
      r.push(`| Book DO -kutsut | ${y.bookDoKutsuja} |`);
      r.push(`| Control DO -kutsut | ${y.controlDoKutsuja} |`);
      r.push(`| R2 head / put / get | ${y.r2.head} / ${y.r2.put} / ${y.r2.get} |`);
      r.push(`| R2 put-tavut | ${y.r2.putTavut} |`);
      r.push(
        `| DO SQL rowsRead / rowsWritten | ${y.doSqlRowsRead} / ${y.doSqlRowsWritten} (${y.doSqlLauseita} lausetta) |`,
      );
      r.push(`| workerd CPU (ps, ms) | ${y.workerdCpuMs} |`);
      r.push(`| Seinäaika (ms) | ${ms(y.seinaaikaMs)} |`);
      r.push(
        '',
        `Laskurit täsmäävät (asiakas = Worker = Book DO, ei evictionia): ${y.laskurit_tasmaavat ? 'kyllä' : 'EI'}`,
      );
      r.push(
        '',
        '| Vaihe | pyynnöt | Book DO | Control DO | R2 put | rowsRead | rowsWritten | ms |',
        '|---|---:|---:|---:|---:|---:|---:|---:|',
      );
      for (const v of q6t.vaiheet) {
        r.push(
          `| ${v.nimi} | ${v.laskurit.worker.pyynnot} | ${v.laskurit.worker.kirjaDoKutsut} | ${v.laskurit.worker.controlDoKutsut} | ${v.laskurit.kirja?.r2.put ?? '-'} | ${v.laskurit.kirja?.rowsRead ?? '-'} | ${v.laskurit.kirja?.rowsWritten ?? '-'} | ${ms(v.kestoMs)} |`,
        );
      }
    }
  }
  r.push(
    '',
    'Huom. kaikki luvut ovat paikallisesta workerdistä (loopback); hinnoittelua ei ole laskettu.',
    '',
  );
  return r.join('\n');
}

async function main(): Promise<void> {
  let a: MittausAsetukset | 'apua';
  try {
    a = parsi(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${virheTeksti(e)}\n`);
    process.exitCode = 2;
    return;
  }
  if (a === 'apua') {
    process.stdout.write(`${OHJE}\n`);
    return;
  }
  const t = await mittaa(a);
  const kaikki = [t.q2, t.q3, t.q6].filter((x) => x !== undefined);
  if (kaikki.some((x) => 'virhe' in x)) process.exitCode = 1;
  process.stdout.write(`${yhteenvetoMd(t)}\n`);
}

// Ajetaan vain suoraan (testit tuovat mittaa()-funktion).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(1);
  });
}
