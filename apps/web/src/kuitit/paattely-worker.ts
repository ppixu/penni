/// <reference lib="webworker" />
/*
 * INTEGRAATIOKOODIA — varmennetaan selaimessa, ei yksikkötestattavissa.
 * HUOM: asennetussa @huggingface/transformers-versiossa (4.x) pipeline()-funktiolla ei ole
 * "image-text-to-text"-tehtävää — SmolVLM/Idefics3-perheen mallit ajetaan suoraan
 * AutoProcessor + AutoModelForImageTextToText -yhdistelmällä (ks. node_modules/@huggingface/
 * transformers/types sekä kirjaston viralliset smolvlm-webgpu-esimerkit). Kehote muunnetaan
 * tekstiksi tokenisoijan apply_chat_template-metodilla (tokenize: false), prosessori liittää
 * kuvan tekstiin, ja generoinnin jälkeen kehotteen pituus leikataan pois tunnistetokeneista
 * ennen dekoodausta, jotta tulos on pelkkä mallin vastaus.
 */
import type {
  Message,
  PreTrainedModel,
  Processor,
  ProgressInfo,
  Tensor,
  TextGenerationPipeline,
} from '@huggingface/transformers';
import {
  AutoModelForImageTextToText,
  AutoProcessor,
  RawImage,
  env,
  pipeline,
} from '@huggingface/transformers';
import { KUVAN_MAKS_SIVU, rakennaTekstiKehote } from '@penni/engine';
import { luoEdistymisLaskuri } from './edistyminen.js';
import { MALLI_DTYPE, MALLI_ID, MALLI_LAITE, MALLI_REVISIO } from './malli.js';
import { type MallinHaku, kytkeMallinHaku } from './mallinOsoite.js';
import type { MallinLatausAsetukset } from './paattely.js';
import { TEKSTI_MALLI_DTYPE, TEKSTI_MALLI_ID, TEKSTI_MALLI_LAITE } from './teksti-malli.js';
import { poimiVastaus } from './vastaus.js';

const oma = self as unknown as {
  postMessage: (v: unknown) => void;
  addEventListener: (t: string, k: (e: MessageEvent) => void) => void;
};

interface LadattuMalli {
  prosessori: Processor;
  malli: PreTrainedModel;
}

let ladattu: LadattuMalli | undefined;
let tekstiGeneraattori: TextGenerationPipeline | undefined;

function onkoWebGpu(): boolean {
  return typeof (navigator as unknown as { gpu?: unknown }).gpu !== 'undefined';
}

/**
 * Latauksen edistyminen yhtenä palkkina: prosessori saa palkin alun, mallin painot (kirjaston
 * `progress_total`-ilmoitukset) loppuosan (uusi laskuri jokaiselle lataukselle).
 */
function edistymisenIlmoittaja(): (tieto: ProgressInfo) => void {
  return luoEdistymisLaskuri((osuus) => oma.postMessage({ tyyppi: 'edistyi', osuus }));
}

let lataus: Promise<void> | undefined;

/** Kirjaston oma haku ennen ohjausta: lukumallin osoitteet ohjataan sen päälle. */
const perusHaku = env.fetch as MallinHaku;

/**
 * Lataa näkömallin kerran; rinnakkaiset ja myöhemmät kutsut odottavat samaa latausta.
 * `env.remoteHost` pysyy https:nä (kirjasto tunnustelee tiedostot vain http(s)-osoitteista);
 * lukumallin haut kiinnitetään revisioon ja ohjataan tarvittaessa `kautta`-isännälle.
 */
function lataa(asetukset: MallinLatausAsetukset): Promise<void> {
  lataus ??= (async () => {
    kytkeMallinHaku(env, asetukset, perusHaku);
    const ilmoitaEdistyminen = edistymisenIlmoittaja();
    const prosessori = await AutoProcessor.from_pretrained(MALLI_ID, {
      revision: MALLI_REVISIO,
      progress_callback: ilmoitaEdistyminen,
    });
    const malli = await AutoModelForImageTextToText.from_pretrained(MALLI_ID, {
      revision: MALLI_REVISIO,
      device: MALLI_LAITE,
      dtype: MALLI_DTYPE,
      progress_callback: ilmoitaEdistyminen,
    });
    ladattu = { prosessori, malli };
  })().catch((virhe: unknown) => {
    lataus = undefined; // seuraava yritys saa ladata uudelleen
    throw virhe;
  });
  return lataus;
}

/** Poimii syötteen input_ids-tensorin pituuden eli kehotteen pituuden ennen generointia. */
function kehotteenPituus(syotteet: unknown): number {
  if (!syotteet || typeof syotteet !== 'object' || !('input_ids' in syotteet)) return 0;
  const ids = (syotteet as { input_ids: unknown }).input_ids;
  if (!ids || typeof ids !== 'object' || !('dims' in ids)) return 0;
  const dims = (ids as { dims: unknown }).dims;
  const pituus = Array.isArray(dims) ? dims.at(-1) : undefined;
  return typeof pituus === 'number' ? pituus : 0;
}

/** generate() palauttaa asetuksista riippuen joko suoraan tensorin tai { sequences, ... } -olion. */
function poimiSekvenssit(tulos: unknown): Tensor {
  const sekvenssit =
    tulos && typeof tulos === 'object' && 'sequences' in tulos
      ? (tulos as { sequences: unknown }).sequences
      : tulos;
  return sekvenssit as Tensor;
}

async function tulkitse(kuva: Blob, kehote: string, maksTokenit: number): Promise<string> {
  if (!ladattu) throw new Error('Mallia ei ole ladattu.');
  const { prosessori, malli } = ladattu;
  const tokenisoija = prosessori.tokenizer;
  if (!tokenisoija) throw new Error('Mallin tokenisoijaa ei löytynyt.');

  // Pienennetään iso kuva ennen päättelyä: täysikokoinen kuva tuottaa valtavan määrän
  // näkötokeneita ja voi jäädyttää välilehden. Rajoitetaan pisin sivu KUVAN_MAKS_SIVU-pikseliin.
  let kuvaData = await RawImage.fromBlob(kuva);
  if (kuvaData.width > KUVAN_MAKS_SIVU || kuvaData.height > KUVAN_MAKS_SIVU) {
    const suhde = Math.min(KUVAN_MAKS_SIVU / kuvaData.width, KUVAN_MAKS_SIVU / kuvaData.height);
    kuvaData = await kuvaData.resize(
      Math.round(kuvaData.width * suhde),
      Math.round(kuvaData.height * suhde),
    );
  }
  const kuvat = [kuvaData];
  const viestit: Message[] = [
    {
      role: 'user',
      content: [{ type: 'image' }, { type: 'text', text: kehote }],
    },
  ];
  const teksti = tokenisoija.apply_chat_template(viestit, {
    add_generation_prompt: true,
    tokenize: false,
  });

  const syotteet: unknown = await prosessori(teksti, kuvat);
  const kehotePituus = kehotteenPituus(syotteet);

  const raakaTulos = await malli.generate({
    ...(syotteet as Record<string, unknown>),
    max_new_tokens: maksTokenit,
    do_sample: false,
    repetition_penalty: 1.1,
  });

  const sekvenssit = poimiSekvenssit(raakaTulos);
  const vastausSekvenssi = sekvenssit.slice(null, [
    kehotePituus,
    sekvenssit.dims.at(-1) ?? kehotePituus,
  ]);
  const [dekoodattu] = tokenisoija.batch_decode(vastausSekvenssi, {
    skip_special_tokens: true,
  });
  return poimiVastaus({ generated_text: dekoodattu ?? '' });
}

/** Lataa pienen tekstimallin (Qwen2.5) PDF→teksti-polkua varten. Laiska lataus samaan tapaan kuin näkömalli. */
async function lataaTeksti(): Promise<void> {
  tekstiGeneraattori = await pipeline('text-generation', TEKSTI_MALLI_ID, {
    device: TEKSTI_MALLI_LAITE,
    dtype: TEKSTI_MALLI_DTYPE,
    progress_callback: edistymisenIlmoittaja(),
  });
}

/** Aja tekstimallin päättely: dokumenttiteksti → Kuitti-kehote (kehote.ts) → mallin raakateksti. */
async function tulkitseTeksti(teksti: string, maksTokenit: number): Promise<string> {
  if (!tekstiGeneraattori) throw new Error('Tekstimallia ei ole ladattu.');
  const viestit: Message[] = [{ role: 'user', content: rakennaTekstiKehote(teksti) }];
  const tulos = await tekstiGeneraattori(viestit, {
    max_new_tokens: maksTokenit,
    do_sample: false,
  });
  return poimiVastaus(tulos);
}

const kasittelijat: Record<string, (args: readonly unknown[]) => unknown> = {
  saatavilla: () => onkoWebGpu(),
  lataa: (args) =>
    lataa((args[0] as MallinLatausAsetukset | undefined) ?? { selainValimuisti: true }),
  tulkitse: (args) => tulkitse(args[0] as Blob, args[1] as string, args[2] as number),
  lataaTeksti: () => lataaTeksti(),
  tulkitseTeksti: (args) => tulkitseTeksti(args[0] as string, args[1] as number),
};

oma.addEventListener('message', (e: MessageEvent) => {
  const { id, metodi, args } = e.data as {
    id: number;
    metodi: string;
    args: readonly unknown[];
  };
  const fn = kasittelijat[metodi];
  if (!fn) {
    oma.postMessage({ id, ok: false, virhe: `Tuntematon metodi: ${metodi}` });
    return;
  }
  void Promise.resolve()
    .then(() => fn(args ?? []))
    .then((arvo) => oma.postMessage({ id, ok: true, arvo }))
    .catch((err: unknown) =>
      oma.postMessage({
        id,
        ok: false,
        virhe: err instanceof Error ? err.message : String(err),
      }),
    );
});
