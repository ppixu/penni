import type {
  ErantyneetToistot,
  Toisto,
  ToistoLaskustaSyote,
  Tuote,
  UusiToisto,
  UusiTuote,
  Vakioviite,
  VakioviiteSyote,
} from '@penni/engine';
import { type WireRivi, decodeRivi, encodeRivi } from './rivi.js';

/** Poimii id:n numeroksi; puuttuva id jätetään pois, jotta tallennus antaa uuden tunnisteen. */
function idPois(w: Record<string, unknown>): { id?: number; rest: Record<string, unknown> } {
  const { id, ...rest } = w;
  return id != null ? { id: typeof id === 'number' ? id : Number(id), rest } : { rest };
}

// --- Tuote: aNetto kulkee numerona (euroa), ei Raha-merkkijonona ---

export function decodeTuote(w: Record<string, unknown>): Tuote {
  const { id, rest } = idPois(w);
  const t = {
    ...rest,
    nimike: typeof w.nimike === 'string' ? w.nimike : String(w.nimike ?? ''),
    aNetto: Number(w.aNetto),
    alvKoodi: Number(w.alvKoodi),
    alvProsentti: Number(w.alvProsentti),
  } as Tuote;
  if (id !== undefined) t.id = id;
  return t;
}

export function encodeTuote(t: Tuote | UusiTuote): Record<string, unknown> {
  return { ...t };
}

// --- Vakioviite ---

export function decodeVakioviite(w: Record<string, unknown>): Vakioviite {
  return {
    ...w,
    viite: String(w.viite),
    tili: Number(w.tili),
    otsikko: String(w.otsikko ?? ''),
  } as Vakioviite;
}

export function encodeVakioviite(v: Vakioviite): Record<string, unknown> {
  return { ...v };
}

export function decodeVakioviiteSyote(w: Record<string, unknown>): VakioviiteSyote {
  return { ...w, otsikko: String(w.otsikko ?? '') } as VakioviiteSyote;
}

export function encodeVakioviiteSyote(s: VakioviiteSyote): Record<string, unknown> {
  return { ...s };
}

// --- Toisto: pohjan rivit kulkevat laskuriveinä (rivi.ts) ---

export function decodeToisto(w: Record<string, unknown>): Toisto {
  const { id, rest } = idPois(w);
  const pohja = (w.pohja ?? {}) as Record<string, unknown>;
  const t = {
    ...rest,
    kuukausia: Number(w.kuukausia),
    seuraava: String(w.seuraava),
    aktiivinen: Boolean(w.aktiivinen),
    pohja: {
      ...pohja,
      maksutapa: Number(pohja.maksutapa),
      maksuaikaPaivia: Number(pohja.maksuaikaPaivia),
      rivit: ((pohja.rivit ?? []) as WireRivi[]).map(decodeRivi),
    },
  } as Toisto;
  if (id !== undefined) t.id = id;
  return t;
}

export function encodeToisto(t: Toisto | UusiToisto): Record<string, unknown> {
  return { ...t, pohja: { ...t.pohja, rivit: t.pohja.rivit.map(encodeRivi) } };
}

// --- Toistojen luonti ---

export function decodeToistoLaskustaSyote(w: Record<string, unknown>): ToistoLaskustaSyote {
  return {
    tosite: Number(w.tosite),
    kuukausia: Number(w.kuukausia),
    ...(typeof w.seuraava === 'string' ? { seuraava: w.seuraava } : {}),
    ...(typeof w.loppuu === 'string' ? { loppuu: w.loppuu } : {}),
    ...(typeof w.nimi === 'string' ? { nimi: w.nimi } : {}),
  };
}

export function encodeToistoLaskustaSyote(s: ToistoLaskustaSyote): Record<string, unknown> {
  return { ...s };
}

export function decodeErantyneetToistot(w: Record<string, unknown>): ErantyneetToistot {
  const ohitettu = w.ohitettu;
  return {
    luodut: ((w.luodut ?? []) as unknown[]).map(Number),
    ...(ohitettu === 'EITILIKAUTTA' || ohitettu === 'LUKITTU' ? { ohitettu } : {}),
    ...(Array.isArray(w.epaonnistuneet) && w.epaonnistuneet.length > 0
      ? {
          epaonnistuneet: (w.epaonnistuneet as Record<string, unknown>[]).map((e) => ({
            toisto: Number(e.toisto),
            ...(typeof e.nimi === 'string' ? { nimi: e.nimi } : {}),
            virhe: String(e.virhe),
          })),
        }
      : {}),
  };
}

export function encodeErantyneetToistot(t: ErantyneetToistot): Record<string, unknown> {
  return { ...t };
}
