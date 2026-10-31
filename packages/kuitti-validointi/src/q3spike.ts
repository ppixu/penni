/**
 * SPIKE (2026-10-27, ei commitoitu): Q3/2026-kuitit oikeasta .penni-kirjasta lukijavarianteittain
 * → tiliotetäsmäys (polku B) → tosite → vertailu kirjattuun. Lukijat: pdf.js-tekstikerros sekä
 * näkömallit (Ollama tai OpenAI-yhteensopiva, esim. mlx_vlm.server) litterointi- ja poimintatilassa.
 *
 *   pnpm exec tsx src/q3spike.ts --db <kopio.penni> --cache <hak> \
 *     --lukija teksti --lukija ollama|qwen3.5:2b|ocr --lukija openai|http://localhost:8282/v1|mlx-community/Qwen3.5-2B-4bit|ocr
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Kuitti,
  OCR_KEHOTE,
  type Tili,
  type Tilitapahtuma,
  jasennaKuitti,
  lataaKartta,
  poimiKuittiTekstista,
  rakennaKuittiKehote,
  tasmaytaTiliote,
} from '@penni/engine';
import { lueTiliotePdf, pdfTeksti } from '@penni/luku';
import Database from 'better-sqlite3';
import type { Leg } from './legit.js';
import { ajaPolkuB, rakennaKuittilahteet } from './polkuB.js';
import { rasteroi } from './rasterointi.js';
import { lamminAsetukset, opiSaannot } from './seed.js';
import { type Totuus, poimiTotuus } from './totuus.js';
import { vaadi } from './vaadi.js';

interface Tosite {
  id: number;
  pvm: string;
  tyyppi: number;
  otsikko: string;
  legit: Leg[];
  liite?: { nimi: string; mime: string; data: Uint8Array };
}

function avaaPenni(polku: string): { chart: Tili[]; tositteet: Tosite[] } {
  const db = new Database(polku, { readonly: true, fileMustExist: true });
  try {
    const chart = lataaKartta(
      (
        db.prepare('SELECT numero, tyyppi, json FROM tili WHERE taso = 0').all() as {
          numero: number;
          tyyppi: string;
          json: string;
        }[]
      ).map((r) => ({ ...JSON.parse(r.json), numero: r.numero, tyyppi: r.tyyppi })),
    );
    const liite = db.prepare('SELECT nimi, tyyppi, data FROM liite WHERE tosite = ? ORDER BY id');
    const tositteet = (
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
    return { chart, tositteet };
  } finally {
    db.close();
  }
}

type Tila = 'ocr' | 'poiminta';
interface Lukija {
  nimi: string;
  lue(t: Tosite): Promise<{ kuitti?: Kuitti; raaka: string; sekunnit: number }>;
}

async function malliKutsu(
  tausta: 'ollama' | 'openai',
  url: string,
  malli: string,
  png: Uint8Array,
  kehote: string,
): Promise<string> {
  const b64 = Buffer.from(png).toString('base64');
  const body =
    tausta === 'ollama'
      ? {
          model: malli,
          stream: false,
          think: false,
          options: { temperature: 0, num_predict: 1500 },
          messages: [{ role: 'user', content: kehote, images: [b64] }],
        }
      : {
          model: malli,
          stream: false,
          temperature: 0,
          max_tokens: 1500,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
                { type: 'text', text: kehote },
              ],
            },
          ],
        };
  const osoite = tausta === 'ollama' ? `${url}/api/chat` : `${url}/chat/completions`;
  const r = await fetch(osoite, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const d = (await r.json()) as {
    message?: { content?: string };
    choices?: { message?: { content?: string } }[];
  };
  return (tausta === 'ollama' ? d.message?.content : d.choices?.[0]?.message?.content) ?? '';
}

function malliLukija(spec: string, cache: string): Lukija {
  const [tausta, url, malli, tila] = spec.split('|') as ['ollama' | 'openai', string, string, Tila];
  const kehote = tila === 'ocr' ? OCR_KEHOTE : rakennaKuittiKehote();
  return {
    nimi: `${malli.replace(/^mlx-community\//, 'mlx:')} ${tila}`,
    async lue(t) {
      const kuva = rasteroi(vaadi(t.liite).data, vaadi(t.liite).mime);
      const avain = createHash('sha256')
        .update(kuva.tavut)
        .update(`\0${spec}\0${kehote}`)
        .digest('hex')
        .slice(0, 32);
      const polku = join(cache, `${avain}.json`);
      let raaka: string;
      let sekunnit: number;
      if (existsSync(polku)) ({ raaka, sekunnit } = JSON.parse(readFileSync(polku, 'utf8')));
      else {
        const alku = performance.now();
        raaka = await malliKutsu(tausta, url, malli, kuva.tavut, kehote);
        sekunnit = (performance.now() - alku) / 1000;
        writeFileSync(polku, JSON.stringify({ raaka, sekunnit }));
      }
      if (tila === 'ocr') {
        const j = poimiKuittiTekstista(raaka);
        return { ...(j.ok ? { kuitti: j.kuitti } : {}), raaka, sekunnit };
      }
      const j = jasennaKuitti(raaka.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      return { ...(j.ok ? { kuitti: j.kuitti } : {}), raaka, sekunnit };
    },
  };
}

const tekstiLukija: Lukija = {
  nimi: 'pdf.js-teksti',
  async lue(t) {
    const alku = performance.now();
    const raaka = await pdfTeksti(new Uint8Array(vaadi(t.liite).data));
    const j = poimiKuittiTekstista(raaka);
    return {
      ...(j.ok ? { kuitti: j.kuitti } : {}),
      raaka,
      sekunnit: (performance.now() - alku) / 1000,
    };
  },
};

const KENTAT = [
  'luettu',
  'täsmätty',
  'pvm',
  'myyja',
  'brutto',
  'alv',
  'menotili',
  'TÄYSIN',
] as const;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      cache: { type: 'string', default: '/tmp/q3-cache' },
      lukija: { type: 'string', multiple: true },
      out: { type: 'string' },
      alku: { type: 'string', default: '2026-07-01' },
      loppu: { type: 'string', default: '2026-09-30' },
    },
  });
  if (!values.db) throw new Error('--db puuttuu');
  mkdirSync(vaadi(values.cache), { recursive: true });
  const { chart, tositteet } = avaaPenni(values.db);
  const alku = vaadi(values.alku);
  const loppu = vaadi(values.loppu);

  // Historia ennen jaksoa = mistä sovellus oppisi myyjä→tili-säännöt.
  const totuus = (t: Tosite): Totuus | undefined => {
    const r = poimiTotuus(t.id, t.pvm, t.otsikko, t.legit, chart);
    return 'totuus' in r ? r.totuus : undefined;
  };
  const meno = (t: Tosite) => t.tyyppi >= 100 && t.tyyppi < 200;
  const historia = tositteet
    .filter((t) => meno(t) && t.pvm < alku)
    .map(totuus)
    .filter((x): x is Totuus => !!x);
  const saannot = opiSaannot(historia, -1);

  const jakso = tositteet.filter((t) => t.pvm >= alku && t.pvm <= loppu);
  const kuitit = jakso.filter((t) => meno(t) && t.liite && /pdf|image/.test(t.liite.mime));
  const kohteet = kuitit
    .map((t) => ({ t, totuus: totuus(t) }))
    .filter((x): x is { t: Tosite; totuus: Totuus } => !!x.totuus);
  const tapahtumat: Tilitapahtuma[] = [];
  for (const t of jakso.filter((t) => t.tyyppi === 400 && t.liite))
    tapahtumat.push(...(await lueTiliotePdf(new Uint8Array(vaadi(t.liite).data))).tapahtumat);
  console.log(
    `historia ${historia.length} tositetta → ${saannot.length} sääntöä; jakso: ${kuitit.length} kuittitositetta, ` +
      `${kohteet.length} pisteytettävää, ${tapahtumat.length} tilitapahtumaa`,
  );

  const lukijat: Lukija[] = (values.lukija ?? ['teksti']).map((s) =>
    s === 'teksti' ? tekstiLukija : malliLukija(s, vaadi(values.cache)),
  );
  const yhteenveto: Record<string, Record<string, number | string>> = {};
  const yksityiskohdat: string[] = [];
  for (const lukija of lukijat) {
    const luetut: { totuus: Totuus; kuitti: Kuitti }[] = [];
    let aika = 0;
    for (const { t, totuus: tot } of kohteet) {
      const r = await lukija.lue(t).catch((e: unknown) => ({ raaka: `VIRHE ${e}`, sekunnit: 0 }));
      aika += r.sekunnit;
      if ('kuitti' in r && r.kuitti) luetut.push({ totuus: tot, kuitti: r.kuitti });
      const k = 'kuitti' in r ? r.kuitti : undefined;
      yksityiskohdat.push(
        `| ${lukija.nimi} | ${vaadi(t.liite).nimi} | ${tot.pvm} ${tot.myyja} ${(tot.brutto / 100).toFixed(2)} | ` +
          `${k ? `${k.pvm ?? '?'} ${k.myyja ?? '?'} ${k.bruttoSumma !== undefined ? (k.bruttoSumma / 100).toFixed(2) : '?'} ${k.valuutta ?? ''}` : 'ei luettu'} |`,
      );
    }
    const { kuitit: lahteet, totuusPerTiedosto } = rakennaKuittilahteet(luetut);
    const tasmays = tasmaytaTiliote(tapahtumat, lahteet, {
      omistajanNimet: ['meikalainen matti', 'matti juhani meikalainen'],
      pvmVara: 10,
      vendorAliakset: [['cursor', 'anysphere']],
    });
    const tulokset = ajaPolkuB(tasmays, totuusPerTiedosto, chart, () =>
      lamminAsetukset(chart, saannot),
    );
    const n = kohteet.length;
    const ok = (f: (k: { nimi: string; ok: boolean }[]) => boolean) =>
      tulokset.filter((r) => f(r.kentat)).length;
    const kentta = (nimi: string) => ok((ks) => ks.some((k) => k.nimi.startsWith(nimi) && k.ok));
    const rivi: Record<string, number | string> = {
      luettu: luetut.length,
      täsmätty: tulokset.length,
      pvm: kentta('pvm'),
      myyja: kentta('myyja'),
      brutto: kentta('brutto'),
      alv: kentta('alv'),
      menotili: ok((ks) => ks.filter((k) => k.nimi.startsWith('menotili')).every((k) => k.ok)),
      TÄYSIN: tulokset.filter((r) => r.taysinTasmaa).length,
      's/kuitti': (aika / n).toFixed(2),
    };
    yhteenveto[lukija.nimi] = rivi;
    for (const r of tulokset.filter((r) => !r.taysinTasmaa))
      yksityiskohdat.push(
        `| ${lukija.nimi} | tosite ${r.tositeId} | ${r.kentat
          .filter((k) => !k.ok)
          .map((k) => `${k.nimi}: odotettu ${k.odotettu}, saatu ${k.saatu}`)
          .join('; ')} | |`,
      );
    console.log(lukija.nimi, JSON.stringify(rivi));
  }

  const n = kohteet.length;
  const otsake = `| lukija | ${[...KENTAT, 's/kuitti'].join(' | ')} |`;
  const md = [
    `# Q3-kuitit → kirjanpito (${n} kuittia, ${tapahtumat.length} tilitapahtumaa)`,
    '',
    otsake,
    `|${'---|'.repeat(KENTAT.length + 2)}`,
    ...Object.entries(yhteenveto).map(
      ([nimi, r]) =>
        `| ${nimi} | ${[...KENTAT, 's/kuitti'].map((k) => (k === 's/kuitti' ? r[k] : `${r[k]}/${n}`)).join(' | ')} |`,
    ),
    '',
    '## Yksityiskohdat',
    '| lukija | kuitti | kirjattu | luettu |',
    '|---|---|---|---|',
    ...yksityiskohdat,
  ].join('\n');
  if (values.out) writeFileSync(values.out, md);
  console.log(`\n${md.split('\n## ')[0]}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
