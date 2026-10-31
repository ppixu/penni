/**
 * SPIKE (2026-10-27, ei commitoitu): voiko pieni kielimalli päätellä kirjauksen (otsikko, menotili,
 * ALV-käsittely) kirjan historiasta paremmin kuin nykyiset säännöt? Lukeminen on tässä ratkaistu
 * (pdf.js-tekstikerros), täsmäys tiliotteeseen on deterministinen; mallille annetaan kuitin teksti,
 * pankkirivi, historia ja kulutilit, ja se vastaa JSONilla. Vertailu kirjattuun.
 *
 *   pnpm exec tsx src/q3ehdotus.ts --db <kopio.penni> --cache <hak> --malli 'ollama|http://localhost:11434|qwen3.5:2b-q4_K_M'
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Kuitti,
  type Tili,
  type Tilitapahtuma,
  lataaKartta,
  luoTositeMatchista,
  merkitsevatSanat,
  nimetTasmaavat,
  poimiKuittiTekstista,
  tasmaytaTiliote,
} from '@penni/engine';
import { lueTiliotePdf, pdfTeksti } from '@penni/luku';
import Database from 'better-sqlite3';
import { luokitteleLegit } from './legit.js';
import { lamminAsetukset, opiSaannot } from './seed.js';
import { type Totuus, poimiTotuus } from './totuus.js';
import { vaadi } from './vaadi.js';

interface Rivi {
  id: number;
  pvm: string;
  tyyppi: number;
  otsikko: string;
  legit: { tili: number; debet: number; kredit: number; alvKoodi: number; alvProsentti: number }[];
  liite?: { nimi: string; mime: string; data: Uint8Array };
}

function avaa(polku: string): { chart: Tili[]; rivit: Rivi[]; tilinimet: Map<number, string> } {
  const db = new Database(polku, { readonly: true, fileMustExist: true });
  try {
    const raa = db.prepare('SELECT numero, tyyppi, json FROM tili WHERE taso = 0').all() as {
      numero: number;
      tyyppi: string;
      json: string;
    }[];
    const chart = lataaKartta(
      raa.map((r) => ({ ...JSON.parse(r.json), numero: r.numero, tyyppi: r.tyyppi })),
    );
    const tilinimet = new Map<number, string>();
    for (const r of raa) {
      if (!r.tyyppi.startsWith('D')) continue;
      const n = (JSON.parse(r.json) as { nimi?: { fi?: string } }).nimi?.fi;
      if (n) tilinimet.set(r.numero, n);
    }
    const liite = db.prepare('SELECT nimi, tyyppi, data FROM liite WHERE tosite = ? ORDER BY id');
    const rivit = (
      db
        .prepare('SELECT id, pvm, tyyppi, json FROM tosite WHERE tila >= 100 ORDER BY pvm, id')
        .all() as {
        id: number;
        pvm: string;
        tyyppi: number;
        json: string;
      }[]
    ).map((r) => {
      const j = JSON.parse(r.json) as {
        otsikko?: string;
        viennit?: {
          tili: number;
          debet: number;
          kredit: number;
          alvKoodi?: number;
          alvProsentti?: number;
        }[];
      };
      const l = liite.get(r.id) as { nimi: string; tyyppi: string; data: Buffer } | undefined;
      return {
        id: r.id,
        pvm: r.pvm,
        tyyppi: r.tyyppi,
        otsikko: j.otsikko ?? '',
        legit: (j.viennit ?? []).map((v) => ({
          tili: v.tili,
          debet: v.debet,
          kredit: v.kredit,
          alvKoodi: v.alvKoodi ?? 0,
          alvProsentti: v.alvProsentti ?? 0,
        })),
        ...(l ? { liite: { nimi: l.nimi, mime: l.tyyppi, data: new Uint8Array(l.data) } } : {}),
      };
    });
    return { chart, rivit, tilinimet };
  } finally {
    db.close();
  }
}

/** ALV-käsittely kolmeen luokkaan: mitä kirjanpitäjä oikeasti valitsee. */
type Alv = 'ei' | 'kotimainen' | 'kaannetty';
const alvLuokka = (koodi: number): Alv =>
  koodi === 0 ? 'ei' : [21, 22, 28].includes(koodi % 100) ? 'kotimainen' : 'kaannetty';

interface Ehdotus {
  otsikko: string;
  tili: number;
  alv: Alv;
}

async function kutsu(spec: string, kehote: string, ajattelu: boolean): Promise<string> {
  const [tausta, url, malli] = spec.split('|') as ['ollama' | 'openai', string, string];
  const body =
    tausta === 'ollama'
      ? {
          model: malli,
          stream: false,
          think: ajattelu,
          format: 'json',
          options: { temperature: 0, num_predict: ajattelu ? 4000 : 300, num_ctx: 16384 },
          messages: [{ role: 'user', content: kehote }],
        }
      : {
          model: malli,
          stream: false,
          temperature: 0,
          max_tokens: ajattelu ? 4000 : 300,
          messages: [{ role: 'user', content: kehote }],
        };
  const r = await fetch(tausta === 'ollama' ? `${url}/api/chat` : `${url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const d = (await r.json()) as {
    message?: { content?: string };
    choices?: { message?: { content?: string } }[];
  };
  return (tausta === 'ollama' ? d.message?.content : d.choices?.[0]?.message?.content) ?? '';
}

function jasenna(raaka: string): Ehdotus | undefined {
  const m = /\{[\s\S]*\}/.exec(raaka);
  if (!m) return undefined;
  try {
    const j = JSON.parse(m[0]) as { otsikko?: unknown; tili?: unknown; alv?: unknown };
    const tili = Number(j.tili);
    const alv = String(j.alv ?? '').toLowerCase();
    return {
      otsikko: String(j.otsikko ?? ''),
      tili: Number.isFinite(tili) ? tili : 0,
      alv: alv.startsWith('kot')
        ? 'kotimainen'
        : alv.startsWith('kaa') || alv.startsWith('kää')
          ? 'kaannetty'
          : 'ei',
    };
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      cache: { type: 'string', default: '/tmp/q3-ehdotus' },
      malli: { type: 'string', multiple: true },
      ajattelu: { type: 'boolean', default: false },
      rajattu: { type: 'boolean', default: false },
      liukuva: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  mkdirSync(vaadi(values.cache), { recursive: true });
  const { chart, rivit, tilinimet } = avaa(vaadi(values.db));
  const alku = '2026-07-01';
  const loppu = '2026-09-30';
  const meno = (r: Rivi) => r.tyyppi >= 100 && r.tyyppi < 200;
  const totuus = (r: Rivi): Totuus | undefined => {
    const t = poimiTotuus(r.id, r.pvm, r.otsikko, r.legit, chart);
    return 'totuus' in t ? t.totuus : undefined;
  };

  // Historia: viimeisimmät ensin, yksi rivi per (otsikko, tili, alv) — kuten kirjanpitäjä sen muistaa.
  // Hakusanoiksi otsikon lisäksi liitekuitin myyjänimi: sovellus muistaa millä nimellä kuitti tuli.
  const kuittinimi = new Map<number, string>();
  for (const r of rivit.filter((r) => meno(r) && r.liite?.mime === 'application/pdf')) {
    const j = poimiKuittiTekstista(
      await pdfTeksti(new Uint8Array(vaadi(r.liite).data)).catch(() => ''),
    );
    if (j.ok && j.kuitti.myyja) kuittinimi.set(r.id, j.kuitti.myyja);
  }
  type Ryhma = {
    otsikko: string;
    tili: number;
    alv: Alv;
    n: number;
    viimeksi: string;
    sanat: Set<string>;
  };
  const ryhmittele = (lista: readonly Rivi[]): Ryhma[] => {
    const ryhmat = new Map<string, Ryhma>();
    for (const r of lista) {
      const { menot } = luokitteleLegit(r.legit, chart);
      const m = menot[0];
      if (!m) continue;
      const alv = alvLuokka(m.alvKoodi);
      const avain = `${r.otsikko}|${m.tili}|${alv}`;
      const g = ryhmat.get(avain) ?? {
        otsikko: r.otsikko,
        tili: m.tili,
        alv,
        n: 0,
        viimeksi: '',
        sanat: new Set<string>(),
      };
      g.n += 1;
      if (r.pvm > g.viimeksi) g.viimeksi = r.pvm;
      for (const w of merkitsevatSanat(`${r.otsikko} ${kuittinimi.get(r.id) ?? ''}`))
        g.sanat.add(w);
      ryhmat.set(avain, g);
    }
    return [...ryhmat.values()].sort((a, b) => b.viimeksi.localeCompare(a.viimeksi));
  };
  const hist = rivit.filter((r) => meno(r) && r.pvm < alku);
  const ryhmaLista = ryhmittele(hist);
  const ryhmaRivi = (g: Ryhma) =>
    `${g.viimeksi} | ${g.otsikko.replace(/\n/g, ' ')} | ${g.tili} ${tilinimet.get(g.tili) ?? ''} | alv ${g.alv} | ${g.n} kpl`;
  /** Historiahaku: ryhmät joiden otsikko tai kuittinimi jakaa merkitsevän sanan pankkinimen/myyjän kanssa.
   *  Liukuva = kaikki ennen tätä tositetta kirjattu (käyttäjä on hyväksynyt edelliset). */
  const haeHistoriasta = (nimet: string[], ennen: Rivi) => {
    const sanat = new Set(nimet.flatMap((n) => merkitsevatSanat(n)));
    const lahde = values.liukuva
      ? ryhmittele(
          rivit.filter(
            (r) => meno(r) && (r.pvm < ennen.pvm || (r.pvm === ennen.pvm && r.id < ennen.id)),
          ),
        )
      : ryhmaLista;
    return lahde.filter((g) => [...g.sanat].some((w) => sanat.has(w)));
  };
  const historia = ryhmaLista
    .slice(0, 80)
    .map(
      (g) =>
        `${g.viimeksi} | ${g.otsikko.replace(/\n/g, ' ')} | ${g.tili} ${tilinimet.get(g.tili) ?? ''} | alv ${g.alv} | ${g.n} kpl`,
    );
  const tilit = [...tilinimet.entries()].map(([n, nimi]) => `${n} ${nimi}`);

  const kiintea = [
    'You are a Finnish bookkeeper. Book one purchase receipt that was paid from the company bank account.',
    'Decide: otsikko (short voucher title, reuse the exact title from history when it is the same vendor/product), tili (expense account number from the chart below), alv (one of "ei", "kotimainen", "kaannetty").',
    'Rules: follow how this company booked the same vendor in the history; when the history has several choices, prefer the most recent one. For a vendor not in the history, pick the account whose name best fits what was bought. alv "kotimainen" only when the receipt shows Finnish VAT (ALV, e.g. 25.5%) that the company can deduct; follow the history for foreign vendors.',
    'Answer with JSON only: {"otsikko": "...", "tili": 1234, "alv": "ei"}',
    '',
    '## Expense accounts',
    ...tilit,
    ...(values.rajattu
      ? []
      : ['', '## Booking history (date | title | account | alv | count)', ...historia]),
  ].join('\n');

  // Kohteet ja täsmäys: sama kuin q3spike (pdf.js-teksti).
  const jakso = rivit.filter((r) => r.pvm >= alku && r.pvm <= loppu);
  const tapahtumat: Tilitapahtuma[] = [];
  for (const r of jakso.filter((r) => r.tyyppi === 400 && r.liite))
    tapahtumat.push(...(await lueTiliotePdf(new Uint8Array(vaadi(r.liite).data))).tapahtumat);
  const kohteet: { r: Rivi; tot: Totuus; teksti: string; kuitti: Kuitti }[] = [];
  for (const r of jakso.filter((r) => meno(r) && r.liite)) {
    const tot = totuus(r);
    if (!tot) continue;
    const teksti = await pdfTeksti(new Uint8Array(vaadi(r.liite).data));
    const j = poimiKuittiTekstista(teksti);
    if (j.ok) kohteet.push({ r, tot, teksti, kuitti: j.kuitti });
  }
  const tasmays = tasmaytaTiliote(
    tapahtumat,
    kohteet.map((k) => ({ tiedosto: String(k.r.id), kuitti: k.kuitti })),
    {
      omistajanNimet: ['meikalainen matti', 'matti juhani meikalainen'],
      pvmVara: 10,
      vendorAliakset: [['cursor', 'anysphere']],
    },
  );
  const tapahtumaFor = new Map<string, Tilitapahtuma>();
  for (const t of tasmays.tapahtumat)
    if (t.kuitti) tapahtumaFor.set(t.kuitti.tiedosto, t.tapahtuma);
  const saannot = opiSaannot(
    hist.map(totuus).filter((x): x is Totuus => !!x),
    -1,
  );

  const pisteet: Record<
    string,
    { otsikko: number; tili: number; alv: number; kaikki: number; s: number; n: number }
  > = {};
  const lisaa = (nimi: string, tot: Totuus, e: Ehdotus | undefined, s: number, rivi: string[]) => {
    pisteet[nimi] ??= { otsikko: 0, tili: 0, alv: 0, kaikki: 0, s: 0, n: 0 };
    const p = vaadi(pisteet[nimi]);
    const m = vaadi(tot.menot[0]);
    const ok = {
      otsikko: !!e && (e.otsikko === tot.myyja || nimetTasmaavat(tot.myyja, e.otsikko, [])),
      tili: e?.tili === m.tili,
      alv: e?.alv === alvLuokka(m.alvKoodi),
    };
    p.n += 1;
    p.s += s;
    p.otsikko += +ok.otsikko;
    p.tili += +ok.tili;
    p.alv += +ok.alv;
    p.kaikki += +(ok.otsikko && ok.tili && ok.alv);
    rivi.push(
      `${nimi}: ${e ? `${ok.otsikko ? '✓' : '✗'}"${e.otsikko}" ${ok.tili ? '✓' : '✗'}${e.tili} ${ok.alv ? '✓' : '✗'}${e.alv}` : 'ei vastausta'}`,
    );
  };

  const raportti: string[] = [];
  for (const k of kohteet) {
    const tap = tapahtumaFor.get(String(k.r.id));
    const m = vaadi(k.tot.menot[0]);
    const rivi = [
      `- **${vaadi(k.r.liite).nimi}** kirjattu "${k.tot.myyja}" ${m.tili} alv ${alvLuokka(m.alvKoodi)} — pankki: ${tap ? `${tap.pvm} ${tap.nimi} ${(tap.maara / 100).toFixed(2)}` : 'ei täsmännyt'}`,
    ];
    // Nykyiset säännöt (luoTositeMatchista + opitut myyjä→tili-säännöt).
    let saantoEhdotus: Ehdotus | undefined;
    if (tap) {
      const t = luoTositeMatchista(tap, k.kuitti, chart, lamminAsetukset(chart, saannot));
      const menot = luokitteleLegit(
        t.viennit.map((v) => ({
          tili: v.tili,
          debet: v.debet,
          kredit: v.kredit,
          alvKoodi: v.alvKoodi,
          alvProsentti: v.alvProsentti,
        })),
        chart,
      ).menot;
      saantoEhdotus = {
        otsikko: t.otsikko ?? '',
        tili: menot[0]?.tili ?? 0,
        alv: alvLuokka(menot[0]?.alvKoodi ?? 0),
      };
      lisaa('säännöt', k.tot, saantoEhdotus, 0, rivi);
    } else lisaa('säännöt', k.tot, undefined, 0, rivi);

    const osumat = haeHistoriasta([tap?.nimi ?? '', k.kuitti.myyja ?? ''], k.r);
    if (osumat[0])
      lisaa(
        'historiahaku',
        k.tot,
        { otsikko: osumat[0].otsikko, tili: osumat[0].tili, alv: osumat[0].alv },
        0,
        rivi,
      );
    else lisaa('historiahaku', k.tot, saantoEhdotus, 0, rivi);
    const historiaOsio = values.rajattu
      ? `\n\n## This vendor in the booking history (date | title | account | alv | count)\n${osumat.slice(0, 6).map(ryhmaRivi).join('\n') || 'none: new vendor, pick the account from the chart by what was bought'}`
      : '';
    const kuittiteksti = k.teksti.length > 3000 ? `${k.teksti.slice(0, 3000)}…` : k.teksti;
    const kehote = `${kiintea}${historiaOsio}\n\n## Receipt text\n${kuittiteksti}\n\n## Bank transaction\n${tap ? `${tap.pvm} ${tap.nimi} ${(tap.maara / 100).toFixed(2)} EUR` : 'not matched'}\n\nJSON:`;
    for (const spec of values.malli ?? []) {
      const nimi = `${spec.split('|')[2]}${values.rajattu ? ' rajattu' : ''}${values.liukuva ? ' liukuva' : ''}${values.ajattelu ? ' +think' : ''}`;
      const avain = createHash('sha256')
        .update(`${spec}\0${values.ajattelu}\0${kehote}`)
        .digest('hex')
        .slice(0, 32);
      const polku = join(vaadi(values.cache), `${avain}.json`);
      let raaka: string;
      let s: number;
      if (existsSync(polku)) ({ raaka, s } = JSON.parse(readFileSync(polku, 'utf8')));
      else {
        const a = performance.now();
        raaka = await kutsu(spec, kehote, vaadi(values.ajattelu)).catch(
          (e: unknown) => `VIRHE ${e}`,
        );
        s = (performance.now() - a) / 1000;
        writeFileSync(polku, JSON.stringify({ raaka, s }));
      }
      lisaa(nimi, k.tot, jasenna(raaka), s, rivi);
    }
    raportti.push(rivi.join('\n  - '));
  }
  const n = kohteet.length;
  const taulu = [
    '| ehdottaja | otsikko | tili | alv | kaikki oikein | s/kuitti |',
    '|---|---|---|---|---|---|',
    ...Object.entries(pisteet).map(
      ([nimi, p]) =>
        `| ${nimi} | ${p.otsikko}/${n} | ${p.tili}/${n} | ${p.alv}/${n} | ${p.kaikki}/${n} | ${(p.s / n).toFixed(2)} |`,
    ),
  ].join('\n');
  const md = `# Kirjausehdotus Q3 (${n} kuittia), kehote ~${Math.round(kiintea.length / 4)} tokenia\n\n${taulu}\n\n${raportti.join('\n')}\n`;
  if (values.out) writeFileSync(values.out, md);
  console.log(taulu);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
