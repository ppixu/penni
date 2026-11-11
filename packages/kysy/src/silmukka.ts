import type { KpClient } from '@penni/asiakas';
import { ResourceError } from '@penni/engine';
import { TyokaluVirhe, haeTyokalu, lueTyokalut } from '@penni/tyokalut';
import { Kehavahti } from './kehavahti.js';
import { rakennaKysyKehote } from './kehote.js';
import { lueTyokalutOllamalle } from './tyokaluMuunnos.js';
import {
  type KysyAsetukset,
  type KysyTapahtuma,
  KysyVirhe,
  type KysyVirheKoodi,
  type MalliKutsu,
  OLETUS_ASETUKSET,
  type OllamaTyokalu,
  type OllamaVastaus,
  type OllamaViesti,
} from './tyypit.js';

export interface KysySyote {
  kysymys: string;
  asetukset?: Partial<KysyAsetukset>;
  kutsuFn: MalliKutsu;
  keskeyta?: AbortSignal; // kirjan vaihto / käyttäjän peruutus
  aika?: () => string; // kellon injektointi TyokaluEnv:lle, oletus seinäkello
}

const KORJAUSVIESTI = 'Vastaa kysymykseen työkalujen tulosten perusteella tai sano "en tiedä".';
const LOPULLINEN_KEHOTUS = 'Vastaa nyt lopullisesti saamiesi tietojen perusteella.';

function peruttuTapahtuma(): KysyTapahtuma {
  return { tyyppi: 'virhe', koodi: 'peruttu', viesti: 'Kysely peruutettiin.' };
}

function virheKysyVirheesta(e: KysyVirhe): KysyTapahtuma {
  return {
    tyyppi: 'virhe',
    koodi: e.koodi,
    viesti: e.message,
    ...(e.korjaus !== undefined ? { korjaus: e.korjaus } : {}),
  };
}

/** Sisältö tyhjä = ei mitään käyttökelpoista tekstiä (pelkkä whitespace lasketaan tyhjäksi). */
function onTyhja(sisalto: string): boolean {
  return sisalto.trim() === '';
}

/**
 * Suorittaa yhden työkalukutsun turvarajoitteiden läpi:
 * - tuntematon nimi → TUNTEMATON_TYOKALU
 * - kirjoittava tai muuten lue-rekisterin ulkopuolinen työkalu → EIKAYTOSSA (ei koskaan suoriteta)
 * - suorituksen virheet kartoitetaan tunnettuihin virhemuotoihin, ei koskaan heitetä silmukkaan
 */
async function suoritaTyokalu(
  client: KpClient,
  nimi: string,
  raakaSyote: unknown,
  aikaFn: () => string,
): Promise<unknown> {
  const tyokalu = haeTyokalu(nimi);
  if (!tyokalu) {
    return { virhe: 'TUNTEMATON_TYOKALU', viesti: `Työkalua ${nimi} ei tunneta.` };
  }
  if (tyokalu.kirjoittava || !lueTyokalut.includes(tyokalu)) {
    return { virhe: 'EIKAYTOSSA', viesti: 'Työkalu ei ole käytettävissä.' };
  }
  try {
    return await tyokalu.suorita(client, raakaSyote, { aika: aikaFn() });
  } catch (e) {
    if (e instanceof ResourceError) return { virhe: e.message, koodi: e.code };
    if (e instanceof TyokaluVirhe) return { virhe: e.message, koodi: e.koodi };
    if (e instanceof Error && 'issues' in e) return { virhe: 'kelvoton syöte', koodi: 'SYOTE' };
    throw e;
  }
}

/**
 * Yksi mallikutsu, jonka ajattelu välitetään `ajatus`-tapahtumina sitä mukaa kuin se striimautuu.
 * Kuuntelija on synkroninen takaisinkutsu, generaattori ei — jono yhdistää ne: kutsun aikana
 * kertyneet palat tuotetaan yhtenä tapahtumana (vähemmän IPC-viestejä kuin token kerrallaan).
 * Ilman ajattelua kuuntelijaa ei anneta, jolloin kuljetus ei striimaa lainkaan.
 */
async function* mallikutsu(
  kutsuFn: MalliKutsu,
  viestit: OllamaViesti[],
  tyokalut: OllamaTyokalu[] | undefined,
  asetukset: KysyAsetukset,
  keskeyta: AbortSignal | undefined,
  laskuri: Laskuri,
): AsyncGenerator<KysyTapahtuma, OllamaVastaus> {
  if (!asetukset.ajattelu) {
    return await kutsuFn(viestit, tyokalut, asetukset, keskeyta ? { signal: keskeyta } : {});
  }

  laskuri.ajatukset += 1;
  const ajatusId = laskuri.ajatukset;
  // Toistosilmukka katkaistaan heti tunnistettaessa eikä vasta tokenrajalla — mutta vain kun
  // varatie on päällä: katkaistu kutsu palautetaan tokenrajaan päättyneenä, ja varatie hoitaa sen.
  const vahti = asetukset.ajattelunVaratie ? new Kehavahti() : undefined;
  const oma = new AbortController();
  const signal = keskeyta !== undefined ? AbortSignal.any([keskeyta, oma.signal]) : oma.signal;
  let ajatus = '';
  const jono: string[] = [];
  let heratys: (() => void) | undefined;
  const herata = () => {
    heratys?.();
    heratys = undefined;
  };
  let valmis = false;
  const kesken = kutsuFn(viestit, tyokalut, asetukset, {
    signal,
    ajatus: (osa) => {
      if (oma.signal.aborted) return;
      ajatus += osa;
      jono.push(osa);
      if (vahti?.lisaa(osa)) oma.abort();
      herata();
    },
  }).finally(() => {
    valmis = true;
    herata();
  });
  kesken.catch(() => {}); // hylkäys käsitellään alla awaitissa; estää unhandled-varoituksen
  for (;;) {
    if (jono.length > 0) yield { tyyppi: 'ajatus', ajatusId, osa: jono.splice(0).join('') };
    else if (valmis) break;
    else
      await new Promise<void>((r) => {
        heratys = r;
      });
  }
  try {
    return await kesken;
  } catch (e) {
    if (oma.signal.aborted && !keskeyta?.aborted) {
      return { message: { content: '', thinking: ajatus }, done_reason: 'length' };
    }
    throw e;
  }
}

interface Laskuri {
  kutsut: number;
  ajatukset: number;
}

/** Mitä yritys palauttaa kutsujalleen: valmis (tapahtumat on jo tuotettu) vai varatie. */
type YrityksenLoppu = 'valmis' | 'varatie';

export async function* kysy(client: KpClient, syote: KysySyote): AsyncGenerator<KysyTapahtuma> {
  const asetukset: KysyAsetukset = { ...OLETUS_ASETUKSET, ...syote.asetukset };
  const aikaFn = syote.aika ?? (() => new Date().toISOString());

  if (syote.keskeyta?.aborted) {
    yield peruttuTapahtuma();
    return;
  }

  const perustiedotTyokalu = haeTyokalu('perustiedot');
  if (!perustiedotTyokalu) throw new Error('perustiedot-työkalua ei löydy rekisteristä');
  const perustiedot = await perustiedotTyokalu.suorita(client, {}, { aika: aikaFn() });
  // Yhteinen yrityksille, jotta kutsuId:t ja ajatusId:t eivät törmää varatien jälkeen.
  const laskuri: Laskuri = { kutsut: 0, ajatukset: 0 };

  const loppu = yield* yritys(client, syote, asetukset, perustiedot, aikaFn, laskuri);
  if (loppu !== 'varatie') return;
  if (syote.keskeyta?.aborted) {
    yield peruttuTapahtuma();
    return;
  }
  // Ajatteleva yritys jäi silmukkaan tai ei tuottanut vastausta: sama kysymys alusta ilman
  // ajattelua. Ilman ajattelua yritys ei koskaan palauta 'varatie', joten kierroksia on enintään kaksi.
  yield { tyyppi: 'varatie' };
  yield* yritys(client, syote, { ...asetukset, ajattelu: false }, perustiedot, aikaFn, laskuri);
}

async function* yritys(
  client: KpClient,
  syote: KysySyote,
  asetukset: KysyAsetukset,
  perustiedot: unknown,
  aikaFn: () => string,
  laskuri: Laskuri,
): AsyncGenerator<KysyTapahtuma, YrityksenLoppu> {
  const varatie = asetukset.ajattelu && asetukset.ajattelunVaratie;
  const viestit: OllamaViesti[] = [
    { role: 'system', content: rakennaKysyKehote(perustiedot) },
    { role: 'user', content: syote.kysymys },
  ];

  let korjattu = false;

  for (let kierros = 0; kierros < asetukset.maxKierrokset; kierros++) {
    if (syote.keskeyta?.aborted) {
      yield peruttuTapahtuma();
      return 'valmis';
    }

    const tyokalut = lueTyokalutOllamalle();
    let vastaus: OllamaVastaus;
    try {
      vastaus = yield* mallikutsu(
        syote.kutsuFn,
        viestit,
        tyokalut,
        asetukset,
        syote.keskeyta,
        laskuri,
      );
    } catch (e) {
      if (e instanceof KysyVirhe) {
        // Peruutus katkaisee kesken olevan kutsun: se on peruutus, ei yhteysvirhe.
        yield syote.keskeyta?.aborted ? peruttuTapahtuma() : virheKysyVirheesta(e);
        return 'valmis';
      }
      throw e;
    }

    const kutsut = vastaus.message.tool_calls ?? [];
    if (kutsut.length > 0) {
      viestit.push({
        role: 'assistant',
        content: vastaus.message.content,
        ...(vastaus.message.tool_calls !== undefined
          ? { tool_calls: vastaus.message.tool_calls }
          : {}),
      });
      for (const kutsu of kutsut) {
        if (syote.keskeyta?.aborted) {
          yield peruttuTapahtuma();
          return 'valmis';
        }
        laskuri.kutsut += 1;
        const kutsuId = laskuri.kutsut;
        const nimi = kutsu.function.name;
        yield { tyyppi: 'tyokalu_alkoi', kutsuId, nimi, syote: kutsu.function.arguments };
        const tulos = await suoritaTyokalu(client, nimi, kutsu.function.arguments, aikaFn);
        yield { tyyppi: 'tyokalu_valmis', kutsuId, nimi, tulos };
        viestit.push({ role: 'tool', tool_name: nimi, content: JSON.stringify(tulos) });
      }
      continue;
    }

    const sisalto = vastaus.message.content;
    if (!onTyhja(sisalto)) {
      yield { tyyppi: 'vastaus', teksti: sisalto };
      return 'valmis';
    }

    // Tokenrajaan katkennut ajattelu on käytännössä aina toistosilmukka; korjausviesti vain
    // toistaisi sen toisen budjetin verran. Suoraan varatielle.
    if (varatie && vastaus.done_reason === 'length') return 'varatie';

    if (!korjattu) {
      korjattu = true;
      viestit.push({ role: 'user', content: KORJAUSVIESTI });
      continue;
    }

    const ajatus = vastaus.message.thinking ?? '';
    const koodi: KysyVirheKoodi =
      !onTyhja(ajatus) || vastaus.done_reason === 'length' ? 'budjetti' : 'tyhja';
    if (varatie && koodi === 'budjetti') return 'varatie';
    yield {
      tyyppi: 'virhe',
      koodi,
      viesti:
        koodi === 'budjetti'
          ? 'Malli käytti tokenibudjetin loppuun eikä ehtinyt vastata.'
          : 'Malli ei palauttanut vastausta.',
    };
    return 'valmis';
  }

  if (syote.keskeyta?.aborted) {
    yield peruttuTapahtuma();
    return 'valmis';
  }

  viestit.push({ role: 'user', content: LOPULLINEN_KEHOTUS });
  let lopullinen: OllamaVastaus;
  try {
    lopullinen = yield* mallikutsu(
      syote.kutsuFn,
      viestit,
      undefined,
      asetukset,
      syote.keskeyta,
      laskuri,
    );
  } catch (e) {
    if (e instanceof KysyVirhe) {
      yield syote.keskeyta?.aborted ? peruttuTapahtuma() : virheKysyVirheesta(e);
      return 'valmis';
    }
    throw e;
  }

  if (!onTyhja(lopullinen.message.content)) {
    yield { tyyppi: 'vastaus', teksti: lopullinen.message.content };
    return 'valmis';
  }
  yield { tyyppi: 'virhe', koodi: 'kierrokset', viesti: 'En saanut vastausta selville.' };
  return 'valmis';
}
