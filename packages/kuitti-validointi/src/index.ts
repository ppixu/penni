import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Aliasryhma,
  type Kuitti,
  type Tilitapahtuma,
  type TositeAsetukset,
  poimiKuittiTekstista,
  tasmaytaTiliote,
} from '@penni/engine';
import { type KitsasLiite, type KitsasTositeRivi, avaaKitsas } from './kitsasLuku.js';
import { generoiTosite } from './naytto.js';
import { ajaPolkuB, rakennaKuittilahteet, tilioteDiagnostiikka } from './polkuB.js';
import {
  type Ajo,
  type Kattavuus,
  type TilioteDiagnostiikka,
  muodostaRaportti,
} from './raportti.js';
import { type Kuva, rasteroi } from './rasterointi.js';
import { kylmaAsetukset, lamminAsetukset, opiSaannot } from './seed.js';
import { hankiTeksti, ocrTeksti } from './tekstinLuku.js';
import { pdfTiliote } from './tiliote.js';
import { type Totuus, poimiTotuus } from './totuus.js';
import { type VertailuTulos, epaonnistunutTulos, vertaa } from './vertaa.js';
import {
  OLETUS_URL,
  type VisioAsetukset,
  VisioVirhe,
  varmistaOllama,
  visioKuitti,
  visioTeksti,
} from './vision.js';

/** Pick the receipt attachment: first untagged pdf/image (skip role-tagged alv/poistolaskelma/etc.). */
function valitseKuittiLiite(rivi: KitsasTositeRivi): KitsasLiite | undefined {
  return rivi.liitteet.find(
    (l) => l.roolinimi === '' && (l.mime.includes('pdf') || l.mime.startsWith('image/')),
  );
}

interface Skannattu {
  totuus: Totuus;
  kuitti: Kuitti;
}

/** Yksi luentatapa (esim. tekstikerros, tesseract, visio) kaikkien tositteiden yli. */
interface Variantti {
  nimi: string;
  skannatut: Skannattu[];
  kaatuneet: VertailuTulos[];
}

const uusiVariantti = (nimi: string): Variantti => ({ nimi, skannatut: [], kaatuneet: [] });

/**
 * Kirjaa yhden luennan varianttiin. Puuttuva tai nollasumma on luentavirhe, ei onnistunut
 * kuitti: `luoTositeMatchista` tekisi nollasummasta TULOn MENOn sijaan, joten tällainen rivi
 * lasketaan aina tarkkuutta vastaan.
 */
function lisaaLuenta(v: Variantti, totuus: Totuus, kuitti: Kuitti | undefined): void {
  if (!kuitti || kuitti.bruttoSumma === undefined || kuitti.bruttoSumma <= 0) {
    v.kaatuneet.push({
      tositeId: totuus.tositeId,
      kentat: [{ nimi: 'luku', ok: false, odotettu: 'kuitti', saatu: '—' }],
      taysinTasmaa: false,
    });
    return;
  }
  v.skannatut.push({ totuus, kuitti });
}

/** Pankkitapahtuman ja tositteen sallittu päiväysero (päivinä) sekä matchauksessa että diagnostiikassa. */
const PVM_VARA = 10;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      out: { type: 'string', default: './kuitti-raportti' },
      limit: { type: 'string' },
      tiliote: { type: 'string', multiple: true },
      omistaja: { type: 'string', multiple: true },
      alias: { type: 'string', multiple: true },
      visio: { type: 'boolean', default: false },
      malli: { type: 'string', default: 'qwen3.5:2b' },
      ajattelu: { type: 'boolean', default: false },
      rasteroi: { type: 'boolean', default: false },
      'visio-cache': { type: 'string' },
    },
  });
  if (!values.db) {
    console.error(
      'Käyttö: pnpm validoi --db <polku.kitsas> [--tiliote <tiliote.pdf> ...] [--omistaja <nimi> ...] [--alias <a,b> ...] [--out <hakemisto>] [--visio] [--malli qwen3.5:2b] [--ajattelu] [--rasteroi] [--visio-cache <hakemisto>] [--limit N]',
    );
    process.exitCode = 1;
    return;
  }
  // --visio ilman --rasteroi tuottaisi rakenteellisesti nollan T-tesseract-sarakkeen: tesseract
  // ei osaa lukea PDF:ää lainkaan (ocrTeksti nielee virheen tyhjäksi merkkijonoksi), ja
  // visiomalli saisi raa'at PDF-tavut "kuvana" — spec §7 kieltää juuri tämän. Vaadi molemmat
  // eksplisiittisesti sen sijaan että --rasteroi implikoitaisiin hiljaa (loppukatselmus finding #5).
  if (values.visio && !values.rasteroi) {
    console.error(
      '--visio vaatii --rasteroi: tesseract ei osaa lukea PDF:ää natiivina (tyhjä teksti nielaistaan ' +
        'hiljaa), ja visiomalli saisi raa\'at PDF-tavut "kuvana" ilman rasterointia — T-tesseract-sarake ' +
        'olisi rakenteellisesti 0 % kaikilla PDF-liitteillä eikä vertailu olisi luotettava (spec §7). ' +
        'Aja uudelleen lisäten --rasteroi.',
    );
    process.exitCode = 1;
    return;
  }

  const { chart, ostotositteet } = avaaKitsas(values.db);

  const visioAsetukset: VisioAsetukset | undefined = values.visio
    ? {
        malli: values.malli ?? 'qwen3.5:2b',
        ajattelu: values.ajattelu ?? false,
        url: OLETUS_URL,
        ...(values['visio-cache'] === undefined ? {} : { cacheDir: values['visio-cache'] }),
      }
    : undefined;
  if (visioAsetukset) await varmistaOllama(visioAsetukset);

  // Path B: load bank statement(s) up front, then restrict the run to their period so
  // path A and path B are scored on the same voucher subset (apples-to-apples).
  const tiliotepolut = values.tiliote ?? [];
  const tapahtumat: Tilitapahtuma[] = [];
  for (const polku of tiliotepolut) {
    const rivit = await pdfTiliote(new Uint8Array(readFileSync(polku))).lueTiliote();
    tapahtumat.push(...rivit);
  }
  let rivilahde = ostotositteet;
  if (tapahtumat.length > 0) {
    const pvms = tapahtumat.map((t) => t.pvm).sort();
    const alku = pvms[0] ?? '';
    const loppu = pvms[pvms.length - 1] ?? '';
    rivilahde = ostotositteet.filter((r) => r.pvm >= alku && r.pvm <= loppu);
  }
  const raja = values.limit ? Number(values.limit) : rivilahde.length;

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
  const vA = uusiVariantti('A');
  const vT = uusiVariantti('T-tesseract');
  const vVp = uusiVariantti('V-poiminta');
  const vVo = uusiVariantti('V-ocr');

  for (const rivi of rivilahde.slice(0, raja)) {
    const liite = valitseKuittiLiite(rivi);
    if (!liite) {
      kattavuus.eiKuitti += 1;
      continue;
    }
    const totuusTulos = poimiTotuus(rivi.tositeId, rivi.pvm, rivi.myyja, rivi.legit, chart);
    if ('poissulku' in totuusTulos) {
      kattavuus[totuusTulos.poissulku === 'ei-kuitti' ? 'eiKuitti' : 'monimutkainen'] += 1;
      continue;
    }
    const totuus = totuusTulos.totuus;

    const { teksti, lahde } = await hankiTeksti(liite);
    if (lahde === 'pdf') kattavuus.tekstiPdf += 1;
    else kattavuus.ocr += 1;
    const j = poimiKuittiTekstista(teksti);
    lisaaLuenta(vA, totuus, j.ok ? j.kuitti : undefined);

    if (!visioAsetukset) continue;

    let kuva: Kuva;
    try {
      kuva = values.rasteroi
        ? rasteroi(liite.data, liite.mime)
        : { tavut: liite.data, mime: liite.mime };
    } catch (e) {
      console.error(`rasterointi epäonnistui (tosite ${rivi.tositeId}):`, e);
      throw e; // rasterointi ei ole valinnainen: hiljainen ohitus vääristäisi vertailun
    }

    const tess = poimiKuittiTekstista(ocrTeksti(kuva.tavut, kuva.mime));
    lisaaLuenta(vT, totuus, tess.ok ? tess.kuitti : undefined);

    // Neljä erillistä epäonnistumisluokkaa (loppukatselmus finding #3): budjetti (malli katkesi
    // ajatteluun), tyhja (aidosti tyhjä vastaus), jasennys (malli vastasi mutta JSON ei jäsentynyt
    // korjausyrityksenkään jälkeen), kutsu/muu (HTTP tai verkkovirhe) → visioVirhe.
    const kirjaaVirhe = (e: unknown): undefined => {
      if (e instanceof VisioVirhe && e.syy === 'budjetti') kattavuus.visioBudjetti += 1;
      else if (e instanceof VisioVirhe && e.syy === 'tyhja') kattavuus.visioTyhja += 1;
      else if (e instanceof VisioVirhe && e.syy === 'jasennys') kattavuus.visioJasennys += 1;
      else kattavuus.visioVirhe += 1;
      return undefined;
    };

    const vpKuitti = await visioKuitti(kuva, visioAsetukset).catch(kirjaaVirhe);
    // `format: 'json'` + jasennaKuitti's permissive validation means the model can answer with a
    // structurally valid but empty JSON object (e.g. `{}`) and visioKuitti resolves normally — no
    // VisioVirhe is thrown, so none of the counters above fire. lisaaLuenta below still correctly
    // scores this as a read failure (no bruttoSumma), but without this counter that failure mode
    // is indistinguishable from "engine simply didn't attempt N vouchers" (loppukatselmus finding #4).
    if (
      vpKuitti !== undefined &&
      (vpKuitti.bruttoSumma === undefined || vpKuitti.bruttoSumma <= 0)
    ) {
      kattavuus.visioVajaa += 1;
    }
    lisaaLuenta(vVp, totuus, vpKuitti);

    const ocrRaaka = await visioTeksti(kuva, visioAsetukset).catch((e: unknown) => {
      kirjaaVirhe(e);
      return '';
    });
    const vo = poimiKuittiTekstista(ocrRaaka);
    lisaaLuenta(vVo, totuus, vo.ok ? vo.kuitti : undefined);
  }

  const skannatut = vA.skannatut;
  const luennastaKaatuneet = vA.kaatuneet;

  const kaikkiTotuudet = skannatut.map((s) => s.totuus);

  const aja = (
    rivit: readonly Skannattu[],
    asetuksetFor: (tositeId: number) => TositeAsetukset,
  ): VertailuTulos[] =>
    rivit.map((s) => {
      try {
        return vertaa(
          s.totuus,
          generoiTosite(s.kuitti, chart, asetuksetFor(s.totuus.tositeId)),
          chart,
        );
      } catch (e) {
        return epaonnistunutTulos(s.totuus.tositeId, e);
      }
    });

  const ajaKylma = (): VertailuTulos[] => aja(skannatut, () => kylmaAsetukset(chart));
  const ajaLammin = (): VertailuTulos[] =>
    aja(skannatut, (id) => lamminAsetukset(chart, opiSaannot(kaikkiTotuudet, id)));

  const ajot: Ajo[] = [
    {
      nimi: tapahtumat.length ? 'A-kylmä' : 'kylma',
      tulokset: [...ajaKylma(), ...luennastaKaatuneet],
    },
    {
      nimi: tapahtumat.length ? 'A-lämmin' : 'lammin',
      tulokset: [...ajaLammin(), ...luennastaKaatuneet],
    },
  ];

  // Lämmin siementäminen käyttää kaikissa sarakkeissa polku A:n totuusjoukkoa, jotta
  // sarakkeet eroavat vain luentatavan osalta eivätkä opitun säännöstön osalta.
  for (const v of [vT, vVp, vVo]) {
    if (v.skannatut.length === 0 && v.kaatuneet.length === 0) continue;
    ajot.push(
      {
        nimi: `${v.nimi}-kylmä`,
        tulokset: [...aja(v.skannatut, () => kylmaAsetukset(chart)), ...v.kaatuneet],
      },
      {
        nimi: `${v.nimi}-lämmin`,
        tulokset: [
          ...aja(v.skannatut, (id) => lamminAsetukset(chart, opiSaannot(kaikkiTotuudet, id))),
          ...v.kaatuneet,
        ],
      },
    );
  }

  let diagnostiikka: TilioteDiagnostiikka | undefined;
  if (tapahtumat.length > 0) {
    const { kuitit, totuusPerTiedosto } = rakennaKuittilahteet(skannatut);
    const omistajat = values.omistaja ?? ['meikalainen matti', 'matti juhani meikalainen'];
    const aliasryhmat: Aliasryhma[] = (values.alias ?? ['cursor,anysphere']).map((g) =>
      g.split(',').map((s) => s.trim().toLowerCase()),
    );
    const tasmays = tasmaytaTiliote(tapahtumat, kuitit, {
      omistajanNimet: omistajat,
      pvmVara: PVM_VARA,
      vendorAliakset: aliasryhmat,
    });
    const bKylma = ajaPolkuB(tasmays, totuusPerTiedosto, chart, () => kylmaAsetukset(chart));
    const bLammin = ajaPolkuB(tasmays, totuusPerTiedosto, chart, (id) =>
      lamminAsetukset(chart, opiSaannot(kaikkiTotuudet, id)),
    );
    ajot.push({ nimi: 'B-kylmä', tulokset: bKylma }, { nimi: 'B-lämmin', tulokset: bLammin });
    diagnostiikka = tilioteDiagnostiikka(tasmays, tapahtumat, totuusPerTiedosto, PVM_VARA);
  }

  const raportti = muodostaRaportti(ajot, kattavuus, diagnostiikka);
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, 'report.md'), raportti.md);
  writeFileSync(join(values.out, 'report.json'), JSON.stringify(raportti.json, null, 2));
  console.log(raportti.konsoli);
  console.log(`\nRaportit: ${join(values.out, 'report.md')} / report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
