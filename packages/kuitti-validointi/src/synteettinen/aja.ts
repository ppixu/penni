/**
 * Q5: synteettinen pisteytysajo. Sarakkeet: Tesseract (kuvat normalisoituina ja ilman), Workers AI
 * (yksi tai kaksi mallia, `ocr`-kehote → poimiKuittiTekstista) sekä paikallinen Ollama
 * `qwen3.5:2b` jos se vastaa. Vain synteettiset fikstuurit; oikeita kuitteja ei lueta.
 *
 *   pnpm --filter @penni/kuitti-validointi worker          # toisessa terminaalissa (wrangler dev)
 *   pnpm --filter @penni/kuitti-validointi synteettinen --malli @cf/qwen/qwen3.8-27b
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Kuitti, poimiKuittiTekstista } from '@penni/engine';
import { type Ajo, type Kattavuus, muodostaRaportti } from '../raportti.js';
import { type Kuva, rasteroi } from '../rasterointi.js';
import { ocrTeksti } from '../tekstinLuku.js';
import {
  OLETUS_URL,
  type VisioAsetukset,
  VisioVirhe,
  varmistaOllama,
  visioTeksti,
} from '../vision.js';
import { AI_KUTSURAJA, WORKERS_AI_OLETUS_URL, workersAiTeksti } from '../workersAi.js';
import type { SyntTotuus } from './fikstuurit.js';
import { type Pisteet, pisteyta } from './pisteyta.js';
import { AI_LASKURI_POLKU, PAKETTIHAKEMISTO, alustaLaskuri, fikstuuriPolku } from './polut.js';

const mimeTiedostolle = (nimi: string): string =>
  nimi.endsWith('.pdf') ? 'application/pdf' : nimi.endsWith('.jpg') ? 'image/jpeg' : 'image/png';

interface Sarake {
  nimi: string;
  /** Yksi fikstuuri → litteraatti (tyhjä merkkijono = luku epäonnistui). */
  lue: (t: SyntTotuus, kuva: Kuva, raaka: Kuva) => Promise<string>;
}

export interface SarakeTulos {
  nimi: string;
  pisteet: Pisteet[];
}

/** Sarakkeen tulokset yhteen: avainmittarit + kenttäosumat. Pure. */
export function yhteenveto(
  tulokset: readonly SarakeTulos[],
  totuudet: readonly SyntTotuus[],
): string {
  const rivit: string[] = [
    '| sarake | luettu | pvm | myyjä | brutto | alv | keksitty brutto (ei hintaa) | keksitty ALV (tyhjä rivi) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const eiHintaa = totuudet.filter((t) => t.brutto === null).length;
  const tyhjaAlv = totuudet.filter((t) => t.alv === null).length;
  for (const s of tulokset) {
    const n = s.pisteet.length;
    const osuus = (nimi: string): string => {
      const ok = s.pisteet.filter(
        (p) => p.tulos.kentat.find((k) => k.nimi === nimi)?.ok === true,
      ).length;
      return `${ok}/${n}`;
    };
    rivit.push(
      [
        s.nimi,
        `${s.pisteet.filter((p) => p.luettu).length}/${n}`,
        osuus('pvm'),
        osuus('myyja'),
        osuus('brutto'),
        osuus('alv'),
        `**${s.pisteet.filter((p) => p.keksittyBrutto).length}**/${eiHintaa}`,
        `**${s.pisteet.filter((p) => p.keksittyAlv).length}**/${tyhjaAlv}`,
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    );
  }
  return rivit.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      malli: { type: 'string', multiple: true },
      out: { type: 'string', default: join(PAKETTIHAKEMISTO, 'tulokset') },
      url: { type: 'string', default: WORKERS_AI_OLETUS_URL },
      ollama: { type: 'string', default: 'qwen3.5:2b' },
      'ei-ollama': { type: 'boolean', default: false },
      vain: { type: 'string', multiple: true },
    },
  });
  const out = values.out ?? join(PAKETTIHAKEMISTO, 'tulokset');
  const mallit = values.malli ?? [];
  mkdirSync(out, { recursive: true });
  // Yksi kiinteä laskuri (ei `--out`in alla): katto 60 on koko spiken yhteinen. Vanhat
  // out-kohtaiset laskurit migroidaan maksimina; jos laskuri puuttuu mutta kutsuja on jo
  // kulutettu (välimuisti), alustaLaskuri kieltäytyy.
  const laskuri = alustaLaskuri(
    AI_LASKURI_POLKU,
    [join(out, 'ai-laskuri.json'), join(PAKETTIHAKEMISTO, 'tulokset', 'ai-laskuri.json')],
    [join(out, 'cache-ai'), join(PAKETTIHAKEMISTO, 'tulokset', 'cache-ai')],
  );

  const kaikki = JSON.parse(readFileSync(fikstuuriPolku('totuus.json'), 'utf8')) as SyntTotuus[];
  // --vain 01 --vain saas: ajaa vain nimeltä täsmäävät fikstuurit (debuggaus kuluttamatta kiintiötä).
  const totuudet = kaikki.filter(
    (t) => values.vain === undefined || values.vain.some((v) => t.tiedosto.includes(v)),
  );
  const kuvat = totuudet.map((t) => {
    const tavut = new Uint8Array(readFileSync(fikstuuriPolku(t.tiedosto)));
    const mime = mimeTiedostolle(t.tiedosto);
    // `raaka` = ilman EXIF/skaalauskorjausta (PDF:t rasteroidaan aina); vertailusarake Tesseractille.
    const normalisoitu = rasteroi(tavut, mime);
    const raaka: Kuva = mime.includes('pdf') ? normalisoitu : { tavut, mime };
    return { t, kuva: normalisoitu, raaka };
  });

  const sarakkeet: Sarake[] = [
    { nimi: 'T-tesseract', lue: async (_t, kuva) => ocrTeksti(kuva.tavut, kuva.mime) },
    { nimi: 'T-tesseract-raaka', lue: async (_t, _k, raaka) => ocrTeksti(raaka.tavut, raaka.mime) },
  ];
  const huomautukset: string[] = [];

  if (!values['ei-ollama']) {
    const asetukset: VisioAsetukset = {
      malli: values.ollama ?? 'qwen3.5:2b',
      ajattelu: false,
      url: OLETUS_URL,
      cacheDir: join(out, 'cache-ollama'),
    };
    try {
      await varmistaOllama(asetukset);
      sarakkeet.push({
        nimi: `V-ocr ${asetukset.malli}`,
        lue: (_t, kuva) => visioTeksti(kuva, asetukset),
      });
    } catch (e) {
      huomautukset.push(
        `Ollama ${asetukset.malli} ohitettu: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  for (const malli of mallit) {
    const asetukset = {
      malli,
      url: values.url ?? WORKERS_AI_OLETUS_URL,
      cacheDir: join(out, 'cache-ai'),
    };
    sarakkeet.push({
      nimi: `W-${malli.split('/').pop()}`,
      lue: (_t, kuva) => workersAiTeksti(kuva, asetukset, laskuri),
    });
  }

  const kattavuus: Kattavuus = {
    tekstiPdf: 0,
    ocr: 0,
    eiKuitti: 0,
    monimutkainen: 0,
    visioBudjetti: 0,
    visioTyhja: 0,
    visioVirhe: 0,
    visioJasennys: 0,
    visioVajaa: 0,
  };
  const tulokset: SarakeTulos[] = [];
  const lisaa = (e: unknown): void => {
    if (e instanceof VisioVirhe && e.syy === 'budjetti') kattavuus.visioBudjetti += 1;
    else if (e instanceof VisioVirhe && e.syy === 'tyhja') kattavuus.visioTyhja += 1;
    else kattavuus.visioVirhe += 1;
    console.error(`  virhe: ${e instanceof Error ? e.message : String(e)}`);
  };

  for (const s of sarakkeet) {
    console.log(`Sarake ${s.nimi}`);
    const pisteet: Pisteet[] = [];
    mkdirSync(join(out, 'transkriptit', s.nimi.replace(/[^a-z0-9.-]+/gi, '_')), {
      recursive: true,
    });
    for (const [i, { t, kuva, raaka }] of kuvat.entries()) {
      let teksti = '';
      try {
        teksti = await s.lue(t, kuva, raaka);
      } catch (e) {
        if (e instanceof Error && e.message.includes('kutsukatto')) throw e; // katto on kova pysäytys
        lisaa(e);
      }
      writeFileSync(
        join(out, 'transkriptit', s.nimi.replace(/[^a-z0-9.-]+/gi, '_'), `${t.tiedosto}.txt`),
        teksti,
      );
      const j = poimiKuittiTekstista(teksti);
      const kuitti: Kuitti | undefined = j.ok ? j.kuitti : undefined;
      pisteet.push(pisteyta(i + 1, t, kuitti));
    }
    tulokset.push({ nimi: s.nimi, pisteet });
  }

  const ajot: Ajo[] = tulokset.map((s) => ({
    nimi: s.nimi,
    tulokset: s.pisteet.map((p) => p.tulos),
  }));
  const raportti = muodostaRaportti(ajot, kattavuus);
  writeFileSync(join(out, 'report.md'), raportti.md);
  writeFileSync(join(out, 'report.json'), JSON.stringify(raportti.json, null, 2));

  const kutsuja = laskuri.luku();
  const tiivis = [
    '# Q5 synteettinen pisteytys',
    '',
    `Fikstuureja: ${totuudet.length} (ei hintaa: ${totuudet.filter((t) => t.brutto === null).length}, tyhjä ALV: ${totuudet.filter((t) => t.alv === null).length})`,
    '',
    yhteenveto(tulokset, totuudet),
    '',
    `Workers AI -kutsuja yhteensä: ${kutsuja}/${AI_KUTSURAJA}`,
    ...huomautukset.map((h) => `- ${h}`),
  ].join('\n');
  writeFileSync(join(out, 'scorecard.md'), `${tiivis}\n`);
  console.log(`\n${tiivis}\n\nRaportit: ${join(out, 'scorecard.md')}, report.md, report.json`);
}

if (process.argv[1]?.endsWith('aja.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
