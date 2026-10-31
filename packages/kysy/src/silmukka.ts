import type { KpClient } from '@penni/asiakas';
import { ResourceError } from '@penni/engine';
import { TyokaluVirhe, haeTyokalu, lueTyokalut } from '@penni/tyokalut';
import { rakennaKysyKehote } from './kehote.js';
import { lueTyokalutOllamalle } from './tyokaluMuunnos.js';
import {
  type KysyAsetukset,
  type KysyTapahtuma,
  KysyVirhe,
  type KysyVirheKoodi,
  type MalliKutsu,
  OLETUS_ASETUKSET,
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

  const viestit: OllamaViesti[] = [
    { role: 'system', content: rakennaKysyKehote(perustiedot) },
    { role: 'user', content: syote.kysymys },
  ];

  let kutsuLaskuri = 0;
  let korjattu = false;

  for (let kierros = 0; kierros < asetukset.maxKierrokset; kierros++) {
    if (syote.keskeyta?.aborted) {
      yield peruttuTapahtuma();
      return;
    }

    const tyokalut = lueTyokalutOllamalle();
    let vastaus: OllamaVastaus;
    try {
      vastaus = await syote.kutsuFn(viestit, tyokalut, asetukset);
    } catch (e) {
      if (e instanceof KysyVirhe) {
        yield virheKysyVirheesta(e);
        return;
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
          return;
        }
        kutsuLaskuri += 1;
        const kutsuId = kutsuLaskuri;
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
      return;
    }

    if (!korjattu) {
      korjattu = true;
      viestit.push({ role: 'user', content: KORJAUSVIESTI });
      continue;
    }

    const ajatus = vastaus.message.thinking ?? '';
    const koodi: KysyVirheKoodi =
      !onTyhja(ajatus) || vastaus.done_reason === 'length' ? 'budjetti' : 'tyhja';
    yield {
      tyyppi: 'virhe',
      koodi,
      viesti:
        koodi === 'budjetti'
          ? 'Malli käytti tokenibudjetin loppuun eikä ehtinyt vastata.'
          : 'Malli ei palauttanut vastausta.',
    };
    return;
  }

  if (syote.keskeyta?.aborted) {
    yield peruttuTapahtuma();
    return;
  }

  viestit.push({ role: 'user', content: LOPULLINEN_KEHOTUS });
  let lopullinen: OllamaVastaus;
  try {
    lopullinen = await syote.kutsuFn(viestit, undefined, asetukset);
  } catch (e) {
    if (e instanceof KysyVirhe) {
      yield virheKysyVirheesta(e);
      return;
    }
    throw e;
  }

  if (!onTyhja(lopullinen.message.content)) {
    yield { tyyppi: 'vastaus', teksti: lopullinen.message.content };
    return;
  }
  yield { tyyppi: 'virhe', koodi: 'kierrokset', viesti: 'En saanut vastausta selville.' };
}
