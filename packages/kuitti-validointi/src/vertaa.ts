import type { Aliasryhma, Tili, Tosite } from '@penni/engine';
import { nimetTasmaavat } from '@penni/engine';
import { type Leg, luokitteleLegit } from './legit.js';
import type { MenoOdotus, Totuus } from './totuus.js';

export interface Kentta {
  nimi: string;
  ok: boolean;
  odotettu: string;
  saatu: string;
}

export interface VertailuTulos {
  tositeId: number;
  kentat: Kentta[];
  taysinTasmaa: boolean;
}

const kentta = (nimi: string, ok: boolean, odotettu: unknown, saatu: unknown): Kentta => ({
  nimi,
  ok,
  odotettu: String(odotettu),
  saatu: String(saatu),
});

/** Does the generated voucher contain an expense line matching this expected one? */
function menoTasmaa(odotus: MenoOdotus, menot: readonly Leg[]): boolean {
  return menot.some(
    (m) =>
      m.tili === odotus.tili &&
      m.debet === odotus.netto &&
      m.alvKoodi === odotus.alvKoodi &&
      m.alvProsentti === odotus.alvProsentti,
  );
}

/** Grade a generated voucher against the booked truth, field by field (bank account excluded). */
export function vertaa(
  totuus: Totuus,
  tosite: Tosite,
  chart: readonly Tili[],
  aliakset: readonly Aliasryhma[] = [],
): VertailuTulos {
  const legit: Leg[] = tosite.viennit.map((v) => ({
    tili: v.tili,
    debet: v.debet,
    kredit: v.kredit,
    alvKoodi: v.alvKoodi,
    alvProsentti: v.alvProsentti,
  }));
  const { pankki, alv, menot } = luokitteleLegit(legit, chart);
  const brutto = pankki.reduce((s, l) => s + l.kredit, 0);
  const alvYhteensa = alv.reduce((s, l) => s + l.debet, 0);
  const saatuMyyja = tosite.otsikko ?? '';

  const kentat: Kentta[] = [
    kentta('pvm', tosite.pvm === totuus.pvm, totuus.pvm, tosite.pvm),
    kentta('myyja', nimetTasmaavat(totuus.myyja, saatuMyyja, aliakset), totuus.myyja, saatuMyyja),
    kentta('brutto', brutto === totuus.brutto, totuus.brutto, brutto),
    kentta('alv', alvYhteensa === totuus.alvYhteensa, totuus.alvYhteensa, alvYhteensa),
    ...totuus.menot.map((odotus) =>
      kentta(
        `menotili ${odotus.tili}@${odotus.alvProsentti}`,
        menoTasmaa(odotus, menot),
        `${odotus.tili}/${odotus.alvKoodi}/${odotus.alvProsentti}/${odotus.netto}`,
        menot.map((m) => `${m.tili}/${m.alvKoodi}/${m.alvProsentti}/${m.debet}`).join(',') || '—',
      ),
    ),
  ];

  return { tositeId: totuus.tositeId, kentat, taysinTasmaa: kentat.every((k) => k.ok) };
}

/** A generate/compare threw for one voucher → a fully-failing row (so one bad voucher
 *  costs one report row instead of aborting the run). Shared by the CLI and path B. */
export function epaonnistunutTulos(tositeId: number, virhe: unknown): VertailuTulos {
  const viesti = virhe instanceof Error ? virhe.message : String(virhe);
  return {
    tositeId,
    kentat: [{ nimi: 'luku', ok: false, odotettu: 'tosite', saatu: `virhe: ${viesti}` }],
    taysinTasmaa: false,
  };
}
