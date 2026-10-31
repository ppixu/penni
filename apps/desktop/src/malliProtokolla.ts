import { randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { LUKUMALLI } from '@penni/engine';

export interface MalliProtokollaRiippuvuudet {
  /** Välimuistin juuri (userData/mallit). */
  juuri: string;
  hae: (url: string, init?: RequestInit) => Promise<Response>;
  /** Onko käyttäjä antanut luvan mallin lataukseen; ilman lupaa verkkoon ei mennä lainkaan. */
  lupa: () => boolean;
}

const CORS = {
  'access-control-allow-origin': '*',
  // transformers.js lukee tunnustelun content-rangesta tiedoston koon.
  'access-control-expose-headers': 'content-range, accept-ranges',
};
const ESILENTO = {
  ...CORS,
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'range',
};
const ETUOSA = `${LUKUMALLI.id}/resolve/${LUKUMALLI.revisio}/`;
const TIEDOSTO = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const VALMIS = Promise.resolve();
const lataukset = new Map<string, Promise<void>>();
const alustetut = new Set<string>();

/** Juuren alla yksikään olemassa oleva polun osa ei saa olla symbolinen linkki. */
function turvallinen(juuri: string, polku: string): boolean {
  const osat = relative(juuri, polku);
  if (isAbsolute(osat) || osat === '..' || osat.startsWith(`..${sep}`)) return false;
  let nykyinen = juuri;
  const todellinenJuuri = realpathSync(juuri);
  for (const osa of ['', ...osat.split(sep).filter(Boolean)]) {
    nykyinen = join(nykyinen, osa);
    const tieto = lstatSync(nykyinen, { throwIfNoEntry: false });
    if (!tieto) return true;
    if (tieto.isSymbolicLink()) return false;
    const sijainti = relative(todellinenJuuri, realpathSync(nykyinen));
    if (isAbsolute(sijainti) || sijainti === '..' || sijainti.startsWith(`..${sep}`)) return false;
  }
  return true;
}

function alusta(juuri: string): void {
  mkdirSync(juuri, { recursive: true });
  const tmp = join(juuri, '.tmp');
  if (!turvallinen(juuri, tmp)) throw new Error('Turvaton mallivälimuisti');
  mkdirSync(tmp, { recursive: true });
  if (alustetut.has(juuri)) return;
  // Prosessin ensimmäinen pyyntö: edellisen ajon keskeneräiset lataukset pois.
  for (const nimi of readdirSync(tmp)) rmSync(join(tmp, nimi), { force: true, recursive: true });
  alustetut.add(juuri);
}

function tila(status: number): { vastaus: Response; tallennus: Promise<void> } {
  return { vastaus: new Response(null, { status, headers: CORS }), tallennus: VALMIS };
}

/**
 * Yhden tavualueen `bytes=a-b` / `bytes=a-` / `bytes=-n` rajat tiedostolle, jonka koko on `koko`.
 * null = otsaketta ei tueta (esim. useampi alue), jolloin se ohitetaan ja palvellaan koko tiedosto;
 * 'ohi' = alue ei osu tiedostoon (416).
 */
function tavualue(alue: string, koko: number): { alku: number; loppu: number } | 'ohi' | null {
  const osuma = /^bytes=(\d*)-(\d*)$/.exec(alue.trim());
  if (!osuma) return null;
  const [, a = '', b = ''] = osuma;
  if (a === '' && b === '') return null;
  if (a === '') {
    const pituus = Number(b);
    if (pituus === 0 || koko === 0) return 'ohi';
    return { alku: Math.max(0, koko - pituus), loppu: koko - 1 };
  }
  const alku = Number(a);
  if (b !== '' && Number(b) < alku) return null;
  if (alku >= koko) return 'ohi';
  return { alku, loppu: b === '' ? koko - 1 : Math.min(Number(b), koko - 1) };
}

/** Pakkaamattoman vastauksen content-length; pakatun pituus ei kuvaa purettuja tavuja. */
function pakkaamatonPituus(vastaus: Response): string | null {
  const koodaus = vastaus.headers.get('content-encoding');
  return !koodaus || koodaus.trim().toLowerCase() === 'identity'
    ? vastaus.headers.get('content-length')
    : null;
}

function sisaltotyyppi(tiedosto: string): string {
  return tiedosto.endsWith('.json') ? 'application/json' : 'application/octet-stream';
}

/** Pyynnön tiedostopolku kiinnitetyn mallin sisällä, tai null jos pyyntö ei ole sallittu. */
function sallittuTiedosto(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.host !== 'hf') return null;
  let polku: string;
  try {
    polku = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!polku.startsWith(ETUOSA)) return null;
  const tiedosto = polku.slice(ETUOSA.length);
  if (!TIEDOSTO.test(tiedosto)) return null;
  const kielletty = (osa: string) => osa === '..' || osa === '.';
  if (tiedosto.split('/').some(kielletty)) return null;
  return tiedosto;
}

/**
 * `penni-malli://hf/<repo>/resolve/<revisio>/<tiedosto>` → kiinnitetyn lukumallin tiedosto.
 * Levyllä oleva palvellaan suoraan; puuttuva haetaan Hugging Facesta ja virrataan samalla sekä
 * sivulle että levylle (erillinen `.tmp` → valmis nimi vasta kokonaisena). Muut repot, revisiot ja
 * polut → 403, jottei sivu voi käyttää pääprosessia yleisenä välityspalvelimena. Verkkoon mennään
 * vain käyttäjän luvalla. `alue` on pyynnön Range-otsake (transformers.js tunnustelee tiedostot
 * `bytes=0-0`-pyynnöllä): levyltä palvellaan pyydetty osa, puuttuvan tiedoston alue välitetään
 * Hugging Faceen sellaisenaan — se ei koskaan käynnistä täyttä latausta eikä odota sellaista.
 */
export async function kasitteleMallipyynto(
  url: string,
  metodi: string,
  r: MalliProtokollaRiippuvuudet,
  alue: string | null = null,
): Promise<{ vastaus: Response; tallennus: Promise<void> }> {
  if (metodi === 'OPTIONS')
    return { vastaus: new Response(null, { status: 204, headers: ESILENTO }), tallennus: VALMIS };
  if (metodi !== 'GET' && metodi !== 'HEAD') return tila(405);
  const tiedosto = sallittuTiedosto(url);
  if (tiedosto === null) return tila(403);
  const juuri = resolve(r.juuri);
  const levy = join(juuri, LUKUMALLI.id, LUKUMALLI.revisio, ...tiedosto.split('/'));
  try {
    alusta(juuri);
    if (!turvallinen(juuri, levy)) return tila(403);
  } catch {
    return tila(403);
  }
  // Tyhjä tai pelkkää tyhjää oleva Range-otsake on sama kuin puuttuva: normaali koko tiedoston haku.
  const tarkistettuAlue = alue?.trim() ? alue : null;
  if (tarkistettuAlue !== null) return await aluePyynto(levy, tiedosto, metodi, tarkistettuAlue, r);
  const kesken = lataukset.get(levy);
  if (kesken) {
    // Keskeneräiseen lataukseen liitytään vain luvalla, kuten uuden latauksen aloitukseen.
    if (!r.lupa()) return tila(403);
    await kesken;
    if (!turvallinen(juuri, levy)) return tila(403);
    if (!lstatSync(levy, { throwIfNoEntry: false })?.isFile()) return tila(502);
  }
  const otsakkeet = { ...CORS, 'content-type': sisaltotyyppi(tiedosto) };
  const kohde = lstatSync(levy, { throwIfNoEntry: false });
  if (kohde) {
    if (!kohde.isFile()) return tila(403);
    const runko =
      metodi === 'HEAD'
        ? null
        : (Readable.toWeb(createReadStream(levy)) as unknown as ReadableStream);
    return {
      vastaus: new Response(runko, {
        headers: { ...otsakkeet, 'accept-ranges': 'bytes', 'content-length': String(kohde.size) },
      }),
      tallennus: VALMIS,
    };
  }
  if (!r.lupa()) return tila(403);

  let vapauta = () => {};
  const odotus = new Promise<void>((valmis) => {
    vapauta = valmis;
  });
  if (metodi === 'GET') lataukset.set(levy, odotus);
  const lopeta = () => {
    if (lataukset.get(levy) === odotus) lataukset.delete(levy);
    vapauta();
  };
  try {
    const verkko = await r.hae(`https://huggingface.co/${ETUOSA}${tiedosto}`, { method: metodi });
    // net.fetch purkaa pakatun rungon; vain identity-pituus kuvaa tallennettavia tavuja.
    const pituus = pakkaamatonPituus(verkko);
    const vastausOtsakkeet = pituus ? { ...otsakkeet, 'content-length': pituus } : otsakkeet;
    if (!verkko.ok || metodi === 'HEAD' || !verkko.body) {
      lopeta();
      return {
        vastaus: new Response(metodi === 'HEAD' ? null : verkko.body, {
          status: verkko.status,
          headers: vastausOtsakkeet,
        }),
        tallennus: VALMIS,
      };
    }
    const [sivulle, levylle] = verkko.body.tee();
    const osittainen = join(juuri, '.tmp', randomUUID());
    const tallennus = (async () => {
      try {
        if (!turvallinen(juuri, osittainen) || !turvallinen(juuri, levy))
          throw new Error('Turvaton mallivälimuisti');
        mkdirSync(dirname(levy), { recursive: true });
        await pipeline(
          Readable.fromWeb(levylle as unknown as NodeReadableStream),
          createWriteStream(osittainen, { flags: 'wx' }),
        );
        if (
          pituus !== null &&
          (!/^\d+$/.test(pituus) || BigInt(pituus) !== BigInt(statSync(osittainen).size))
        ) {
          throw new Error('Mallin pituus ei vastaa content-length-otsaketta');
        }
        if (!turvallinen(juuri, osittainen) || !turvallinen(juuri, levy))
          throw new Error('Turvaton mallivälimuisti');
        renameSync(osittainen, levy);
      } catch (virhe) {
        console.warn(
          `Mallin tallennus epäonnistui: ${tiedosto} (${virhe instanceof Error ? virhe.message : 'tuntematon virhe'})`,
        );
        try {
          if (turvallinen(juuri, dirname(osittainen))) rmSync(osittainen, { force: true });
        } catch {
          // Seuraava käynnistys siivoaa mahdollisen jäännöksen.
        }
      }
    })().finally(lopeta);
    return {
      vastaus: new Response(sivulle, { status: 200, headers: vastausOtsakkeet }),
      tallennus,
    };
  } catch (virhe) {
    lopeta();
    throw virhe;
  }
}

/**
 * Range-pyyntö: levyllä oleva tiedosto → pyydetty osa (206/416); puuttuva → sama Range-pyyntö
 * Hugging Faceen ja sen vastaus sellaisenaan, ilman tallennusta ja ohi keskeneräisten latausten.
 */
async function aluePyynto(
  levy: string,
  tiedosto: string,
  metodi: string,
  alue: string,
  r: MalliProtokollaRiippuvuudet,
): Promise<{ vastaus: Response; tallennus: Promise<void> }> {
  const otsakkeet = { ...CORS, 'content-type': sisaltotyyppi(tiedosto) };
  const kohde = lstatSync(levy, { throwIfNoEntry: false });
  if (kohde) {
    if (!kohde.isFile()) return tila(403);
    const rajat = tavualue(alue, kohde.size);
    if (rajat === 'ohi')
      return {
        vastaus: new Response(null, {
          status: 416,
          headers: { ...CORS, 'content-range': `bytes */${kohde.size}` },
        }),
        tallennus: VALMIS,
      };
    const { alku, loppu } = rajat ?? { alku: 0, loppu: kohde.size - 1 };
    const runko =
      metodi === 'HEAD' || kohde.size === 0
        ? null
        : (Readable.toWeb(
            createReadStream(levy, { start: alku, end: loppu }),
          ) as unknown as ReadableStream);
    const osa = rajat !== null;
    return {
      vastaus: new Response(runko, {
        status: osa ? 206 : 200,
        headers: {
          ...otsakkeet,
          'accept-ranges': 'bytes',
          'content-length': String(kohde.size === 0 ? 0 : loppu - alku + 1),
          ...(osa ? { 'content-range': `bytes ${alku}-${loppu}/${kohde.size}` } : {}),
        },
      }),
      tallennus: VALMIS,
    };
  }
  if (!r.lupa()) return tila(403);
  const verkko = await r.hae(`https://huggingface.co/${ETUOSA}${tiedosto}`, {
    method: metodi,
    headers: { range: alue },
  });
  const pituus = pakkaamatonPituus(verkko);
  const rajat = verkko.headers.get('content-range');
  return {
    vastaus: new Response(metodi === 'HEAD' ? null : verkko.body, {
      status: verkko.status,
      headers: {
        ...otsakkeet,
        ...(pituus ? { 'content-length': pituus } : {}),
        ...(rajat ? { 'content-range': rajat } : {}),
      },
    }),
    tallennus: VALMIS,
  };
}
