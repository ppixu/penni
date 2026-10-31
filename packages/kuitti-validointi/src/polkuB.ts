import {
  type Kuitti,
  type Kuittilahde,
  type TasmaysRaportti,
  type Tili,
  type Tilitapahtuma,
  type TositeAsetukset,
  luoTositeMatchista,
} from '@penni/engine';
import { Euro } from '@penni/euro';
import type { TilioteDiagnostiikka } from './raportti.js';
import type { Totuus } from './totuus.js';
import { type VertailuTulos, epaonnistunutTulos, vertaa } from './vertaa.js';

/** Kahden ISO-päiväyksen ero päivinä (itseisarvo). Vastaa engine-yksityistä paiviaValissa-logiikkaa. */
function paiviaValissa(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map((x) => Number.parseInt(x, 10));
  const [by, bm, bd] = b.split('-').map((x) => Number.parseInt(x, 10));
  const ms = Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1) - Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1);
  return Math.abs(Math.round(ms / 86_400_000));
}

/** Rakenna Kuittilahde[] skannatuista kuiteista; koodaa origin-tositeId tiedostoon + käänteiskartta. */
export function rakennaKuittilahteet(skannatut: readonly { totuus: Totuus; kuitti: Kuitti }[]): {
  kuitit: Kuittilahde[];
  totuusPerTiedosto: Map<string, Totuus>;
} {
  const kuitit: Kuittilahde[] = [];
  const totuusPerTiedosto = new Map<string, Totuus>();
  for (const s of skannatut) {
    const tiedosto = String(s.totuus.tositeId);
    kuitit.push({ tiedosto, kuitti: s.kuitti });
    totuusPerTiedosto.set(tiedosto, s.totuus);
  }
  return { kuitit, totuusPerTiedosto };
}

/** Rakenna kustakin täsmätystä parista tosite (luoTositeMatchista) ja vertaa booked-totuuteen. */
export function ajaPolkuB(
  tasmays: TasmaysRaportti,
  totuusPerTiedosto: ReadonlyMap<string, Totuus>,
  chart: readonly Tili[],
  asetuksetFor: (tositeId: number) => TositeAsetukset,
): VertailuTulos[] {
  const tulokset: VertailuTulos[] = [];
  for (const t of tasmays.tapahtumat) {
    if (!t.kuitti) continue; // vain tasmays/nimitasmays kantaa kuitin
    const totuus = totuusPerTiedosto.get(t.kuitti.tiedosto);
    if (!totuus) continue;
    try {
      const tosite = luoTositeMatchista(
        t.tapahtuma,
        t.kuitti.kuitti,
        chart,
        asetuksetFor(totuus.tositeId),
      );
      tulokset.push(vertaa(totuus, tosite, chart));
    } catch (e) {
      tulokset.push(epaonnistunutTulos(totuus.tositeId, e));
    }
  }
  return tulokset;
}

/** Täsmäytysdiagnostiikka: luokkajakauma + täsmäytystarkkuus (oikeaan tapahtumaan osunut). */
export function tilioteDiagnostiikka(
  tasmays: TasmaysRaportti,
  tapahtumat: readonly Tilitapahtuma[],
  totuusPerTiedosto: ReadonlyMap<string, Totuus>,
  pvmVara: number,
): TilioteDiagnostiikka {
  const d: TilioteDiagnostiikka = {
    tasmays: 0,
    nimitasmays: 0,
    kuittiPuuttuu: 0,
    omaPaaoma: 0,
    tasmaysOikein: 0,
    tasmaysVaarin: 0,
    eiTasmatty: 0,
    eiKohdetta: 0,
  };
  for (const t of tasmays.tapahtumat) {
    if (t.luokka === 'tasmays') d.tasmays += 1;
    else if (t.luokka === 'nimitasmays') d.nimitasmays += 1;
    else if (t.luokka === 'kuittiPuuttuu') d.kuittiPuuttuu += 1;
    else d.omaPaaoma += 1;
  }
  for (const [tiedosto, totuus] of totuusPerTiedosto) {
    const kohde = tapahtumat.some(
      (tx) => Euro.abs(tx.maara) === totuus.brutto && paiviaValissa(tx.pvm, totuus.pvm) <= pvmVara,
    );
    const match = tasmays.tapahtumat.find((tt) => tt.kuitti?.tiedosto === tiedosto);
    if (kohde) {
      const osui =
        match !== undefined &&
        Euro.abs(match.tapahtuma.maara) === totuus.brutto &&
        paiviaValissa(match.tapahtuma.pvm, totuus.pvm) <= pvmVara;
      if (osui) d.tasmaysOikein += 1;
      else if (match === undefined)
        d.eiTasmatty += 1; // miss: correct tx existed, not paired
      else d.tasmaysVaarin += 1; // mispair: paired to a different tx
    } else if (match !== undefined) {
      d.tasmaysVaarin += 1; // false positive: paired though no correct tx exists
    } else {
      d.eiKohdetta += 1; // correctly left unmatched
    }
  }
  return d;
}
