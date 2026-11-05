import { laskeViite, tarkistaViite } from '@penni/validator';
import type { Toisto, UusiToisto } from '../laskutus/toisto.js';
import type { Tuote, UusiTuote } from '../laskutus/tuote.js';
import type { Vakioviite } from '../laskutus/vakioviite.js';
import { ResourceError, type Storage } from './storage.js';

// --- Tuotteet ---

export async function haeTuotteet(storage: Storage): Promise<Tuote[]> {
  return storage.getTuotteet();
}

export async function tallennaTuote(storage: Storage, tuote: UusiTuote): Promise<Tuote> {
  return storage.saveTuote(tuote);
}

export async function poistaTuote(storage: Storage, id: number): Promise<void> {
  await storage.deleteTuote(id);
}

// --- Vakioviitteet ---

/** Käsin annettava vakioviite: 4-7 numeroa, ei alkunollaa (vakioviitedlg.cpp:23). */
const KASIN_VIITE = /^[1-9]\d{3,6}$/;

/** Automaattinen numerointi alkaa 100:sta: ensimmäinen viite on 1009 (spec §8.2). */
const ALKUPOHJA = 99;

export interface VakioviiteSyote {
  /** Puuttuu => viite numeroidaan automaattisesti. */
  viite?: string;
  tili: number;
  kohdennus?: number;
  otsikko: string;
  /** Muokattavan viitteen nykyinen avain; jos eri kuin tallennettava viite, vanha avain poistetaan. */
  vanhaViite?: string;
}

function seuraavaViite(olemassa: Vakioviite[]): string {
  let suurin = ALKUPOHJA;
  for (const v of olemassa) {
    const pohja = Number(v.viite.slice(0, -1));
    if (Number.isFinite(pohja) && pohja > suurin) suurin = pohja;
  }
  return laskeViite(String(suurin + 1));
}

export async function haeVakioviitteet(storage: Storage): Promise<Vakioviite[]> {
  return storage.getVakioviitteet();
}

export async function tallennaVakioviite(
  storage: Storage,
  syote: VakioviiteSyote,
): Promise<Vakioviite> {
  const { viite: annettu, vanhaViite, ...kentat } = syote;
  if (typeof kentat.tili !== 'number' || !Number.isFinite(kentat.tili) || kentat.tili <= 0)
    throw new ResourceError('EITILIA', 'Vakioviitteelle täytyy valita tili');
  if (typeof kentat.otsikko !== 'string' || kentat.otsikko.trim() === '')
    throw new ResourceError('EIOTSIKKOA', 'Vakioviitteellä täytyy olla otsikko');

  const olemassa = await storage.getVakioviitteet();
  let viite: string;
  if (annettu === undefined) {
    viite = seuraavaViite(olemassa);
  } else {
    // Muoto ja tarkiste tarkistetaan vain, kun viite muuttuu: tuotu (Kitsas) vakioviite voi olla
    // Pennin muodon ulkopuolella, ja sen otsikkoa ja tiliä on voitava muokata.
    const ennallaan = annettu === vanhaViite && olemassa.some((v) => v.viite === annettu);
    if (!ennallaan && (!KASIN_VIITE.test(annettu) || !tarkistaViite(annettu)))
      throw new ResourceError('EIVIITE', 'Vakioviite on virheellinen');
    if (annettu !== vanhaViite && olemassa.some((v) => v.viite === annettu))
      throw new ResourceError('VIITEKAYTOSSA', 'Vakioviite on jo käytössä');
    viite = annettu;
  }

  const tallennettu = await storage.saveVakioviite({ ...kentat, viite });
  if (vanhaViite !== undefined && vanhaViite !== viite) await storage.deleteVakioviite(vanhaViite);
  return tallennettu;
}

export async function poistaVakioviite(storage: Storage, viite: string): Promise<void> {
  await storage.deleteVakioviite(viite);
}

// --- Toistot ---

export async function haeToistot(storage: Storage): Promise<Toisto[]> {
  return storage.getToistot();
}

export async function tallennaToisto(storage: Storage, toisto: UusiToisto): Promise<Toisto> {
  return storage.saveToisto(toisto);
}

export async function poistaToisto(storage: Storage, id: number): Promise<void> {
  await storage.deleteToisto(id);
}
