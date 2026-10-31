import { type Kuitti, nimetTasmaavat } from '@penni/engine';
import type { Kentta, VertailuTulos } from '../vertaa.js';
import type { SyntTotuus } from './fikstuurit.js';

export interface Pisteet {
  tulos: VertailuTulos;
  /** Luku onnistui (kuitti saatiin ulos tekstistä/mallilta). */
  luettu: boolean;
  /** Totuudessa EI ole hintaa, mutta sarake palautti positiivisen kokonaissumman. */
  keksittyBrutto: boolean;
  /** Totuudessa EI ole ALV:tä (tyhjä rivi), mutta sarake palautti positiivisen ALV-summan. */
  keksittyAlv: boolean;
}

const sentit = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : String(n);

/** Kuitin ALV-summa: eräiden `vero`-kenttien summa, tai undefined jos yhtään veroa ei luettu. */
export function alvSumma(k: Kuitti): number | undefined {
  const verot = k.alv.flatMap((e) => (e.vero === undefined ? [] : [e.vero]));
  return verot.length === 0 ? undefined : verot.reduce((s, v) => s + v, 0);
}

const kentta = (nimi: string, ok: boolean, odotettu: string, saatu: string): Kentta => ({
  nimi,
  ok,
  odotettu,
  saatu,
});

/**
 * Pisteyttää yhden sarakkeen luennan synteettistä totuutta vasten.
 *  - `brutto`: totuus null (ei hintaa) → oikein vain jos mitään summaa ei palautettu.
 *  - `alv`: totuus null (tyhjä ALV-rivi) → oikein jos veroa ei palautettu (nolla sallitaan);
 *    totuus 0 (esim. käännetty verovelvollisuus) → oikein jos 0 tai ei lukua.
 *  - `keksitty*`: ei-nollaarvo siellä missä asiakirjassa ei ole mitään — avainmittari.
 * Epäonnistunut luku (kuitti puuttuu) on `luku`-rivi kuten päiväharnessissa; keksittyä ei synny.
 */
export function pisteyta(id: number, t: SyntTotuus, k: Kuitti | undefined): Pisteet {
  if (k === undefined) {
    return {
      tulos: {
        tositeId: id,
        kentat: [{ nimi: 'luku', ok: false, odotettu: 'kuitti', saatu: '—' }],
        taysinTasmaa: false,
      },
      luettu: false,
      keksittyBrutto: false,
      keksittyAlv: false,
    };
  }
  const brutto = k.bruttoSumma !== undefined && k.bruttoSumma > 0 ? k.bruttoSumma : undefined;
  const alv = alvSumma(k);
  const bruttoOk = t.brutto === null ? brutto === undefined : brutto === t.brutto;
  const alvOk = t.alv === null || t.alv === 0 ? alv === undefined || alv === 0 : alv === t.alv;
  const kentat: Kentta[] = [
    kentta('pvm', k.pvm === t.pvm, String(t.pvm), String(k.pvm ?? '—')),
    kentta('myyja', nimetTasmaavat(t.myyja, k.myyja ?? '', []), t.myyja, k.myyja ?? '—'),
    kentta('brutto', bruttoOk, sentit(t.brutto), sentit(brutto)),
    kentta('alv', alvOk, sentit(t.alv), sentit(alv)),
  ];
  return {
    tulos: { tositeId: id, kentat, taysinTasmaa: kentat.every((x) => x.ok) },
    luettu: true,
    keksittyBrutto: t.brutto === null && brutto !== undefined,
    keksittyAlv: t.alv === null && alv !== undefined && alv > 0,
  };
}
