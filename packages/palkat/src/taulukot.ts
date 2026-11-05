import { Euro } from '@penni/euro';
import type { Cents } from '@penni/euro';
import { z } from 'zod';
import t2025 from '../taulukot/2025.json' with { type: 'json' };
import t2026 from '../taulukot/2026.json' with { type: 'json' };
import t2027 from '../taulukot/2027.json' with { type: 'json' };

/**
 * Vuositaulukot: kaikki prosentit ja korvausmäärät asuvat JSON-tiedostoissa
 * (`taulukot/<vuosi>.json`), jokaisella arvolla lähde (`lahde`). Koodissa ei ole yhtään
 * prosentti- tai euroliteraalia. Rahat ovat kokonaislukusentteinä, prosentit peruspisteinä
 * (100 bp = 1 %). Taulukko valitaan maksupäivän vuoden mukaan (matkakorvauksilla matkapäivän).
 */

export class PalkatVirhe extends Error {
  constructor(
    readonly koodi: 'TAULUKKO_PUUTTUU' | 'VEROKORTTI' | 'SYOTE',
    viesti: string,
    readonly tiedot?: unknown,
  ) {
    super(viesti);
    this.name = 'PalkatVirhe';
  }
}

export interface Taulukko {
  vuosi: number;
  tyelTyontekijaBp: number;
  tyelTyontekija53_62Bp?: number; // vain 2025: 53-62-vuotiaiden korotettu osuus
  tyelOletusKokonaisBp: number;
  tyelTilapainenKokonaisBp: number;
  tyelAlarajaKk: Cents;
  tvrTyontekijaBp: number;
  tvrTyonantajaBp: number;
  tvrOsaomistajaTyontekijaBp: number;
  tvrOsaomistajaTyonantajaBp: number;
  savaBp: number;
  kmKorvaus: Cents; // senttiä per km, oma auto
  kokopaivaraha: Cents;
  osapaivaraha: Cents;
  ateriakorvaus: Cents;
  puhelinetuKk: Cents;
  ravintoetu: Cents;
  ravintoetuYlaraja: Cents;
  eiVerokorttiaBp: number;
}

export type TaulukkoKentta = Exclude<keyof Taulukko, 'vuosi'>;
/** Asetus `PalkatTaulukot`: `{ [vuosi]: Partial<Taulukko> }`, yhdistetään bundlatun taulukon päälle. */
export type TaulukkoOhitus = Record<string, Partial<Record<TaulukkoKentta, number>>>;
export type TaulukkoHaku =
  | { ok: true; taulukko: Taulukko }
  | { ok: false; vuosi: number; puuttuvat: TaulukkoKentta[] };

/** Kaikki kentät; `satisfies` + alla oleva tyyppitarkistus pitävät listan synkassa rajapinnan kanssa. */
export const TAULUKKO_KENTAT = [
  'tyelTyontekijaBp',
  'tyelTyontekija53_62Bp',
  'tyelOletusKokonaisBp',
  'tyelTilapainenKokonaisBp',
  'tyelAlarajaKk',
  'tvrTyontekijaBp',
  'tvrTyonantajaBp',
  'tvrOsaomistajaTyontekijaBp',
  'tvrOsaomistajaTyonantajaBp',
  'savaBp',
  'kmKorvaus',
  'kokopaivaraha',
  'osapaivaraha',
  'ateriakorvaus',
  'puhelinetuKk',
  'ravintoetu',
  'ravintoetuYlaraja',
  'eiVerokorttiaBp',
] as const satisfies readonly TaulukkoKentta[];
type KaikkiMukana = TaulukkoKentta extends (typeof TAULUKKO_KENTAT)[number] ? true : never;
const _kaikkiMukana: KaikkiMukana = true;
void _kaikkiMukana;

/** Valinnaiset kentät: puuttuminen ei estä laskentaa. */
const VALINNAISET: readonly TaulukkoKentta[] = ['tyelTyontekija53_62Bp'];

const kenttaSchema = z.object({
  arvo: z.number().int().nonnegative(),
  lahde: z.string().url().startsWith('https://'),
});

const tiedostoSchema = z
  .object({
    vuosi: z.number().int(),
    kentat: z.record(z.enum(TAULUKKO_KENTAT), kenttaSchema),
  })
  .strict();

type Tiedosto = z.infer<typeof tiedostoSchema>;

function lataa(raaka: unknown, odotettuVuosi: number): Tiedosto {
  const t = tiedostoSchema.parse(raaka);
  if (t.vuosi !== odotettuVuosi) {
    throw new Error(`Taulukkotiedoston vuosi ${t.vuosi} ei vastaa tiedostoa ${odotettuVuosi}`);
  }
  return t;
}

const BUNDLATUT = new Map<number, Tiedosto>([
  [2025, lataa(t2025, 2025)],
  [2026, lataa(t2026, 2026)],
  [2027, lataa(t2027, 2027)],
]);

const RAHAKENTAT: ReadonlySet<TaulukkoKentta> = new Set<TaulukkoKentta>([
  'tyelAlarajaKk',
  'kmKorvaus',
  'kokopaivaraha',
  'osapaivaraha',
  'ateriakorvaus',
  'puhelinetuKk',
  'ravintoetu',
  'ravintoetuYlaraja',
]);

const ohitusSchema = z.record(
  z.string().regex(/^\d{4}$/),
  z.record(z.enum(TAULUKKO_KENTAT), z.number().int().nonnegative()),
);

/**
 * Hakee vuoden taulukon: bundlattu tiedosto + kirjakohtainen ohitus (`PalkatTaulukot`).
 * `kentat` rajaa vaaditut kentät (oletus: kaikki paitsi valinnaiset). Palauttaa `ok: false` ja
 * puuttuvien kenttien listan, jos jokin vaadittu arvo puuttuu — laskenta ei saa arvata.
 * Kun `kentat` on annettu, vain ne kentät ovat taatusti läsnä palautetussa taulukossa.
 */
export function haeTaulukko(
  vuosi: number,
  ohitus?: TaulukkoOhitus,
  kentat?: readonly TaulukkoKentta[],
): TaulukkoHaku {
  const arvot: Partial<Record<TaulukkoKentta, number>> = {};
  const bundlattu = BUNDLATUT.get(vuosi);
  if (bundlattu) {
    for (const [k, v] of Object.entries(bundlattu.kentat)) {
      arvot[k as TaulukkoKentta] = v.arvo;
    }
  }
  if (ohitus) {
    const tulos = ohitusSchema.safeParse(ohitus);
    if (!tulos.success) {
      throw new PalkatVirhe(
        'SYOTE',
        'Palkkataulukon oma arvo on virheellinen (kokonaisluku vaaditaan).',
      );
    }
    for (const [k, v] of Object.entries(tulos.data[String(vuosi)] ?? {})) {
      arvot[k as TaulukkoKentta] = v;
    }
  }
  const vaaditut = kentat ?? TAULUKKO_KENTAT.filter((k) => !VALINNAISET.includes(k));
  const puuttuvat = vaaditut.filter((k) => arvot[k] === undefined);
  if (puuttuvat.length > 0) return { ok: false, vuosi, puuttuvat };

  const taulukko: Record<string, number> = { vuosi };
  for (const [k, v] of Object.entries(arvot)) {
    taulukko[k] = RAHAKENTAT.has(k as TaulukkoKentta) ? Euro.fromCents(v as number) : (v as number);
  }
  return { ok: true, taulukko: taulukko as unknown as Taulukko };
}

/** Bundlatun taulukon lähde-URLit kenttäkohtaisesti (oma arvo ei kuulu tähän). */
export function taulukonLahteet(vuosi: number): Partial<Record<TaulukkoKentta, string>> {
  const tulos: Partial<Record<TaulukkoKentta, string>> = {};
  const t = BUNDLATUT.get(vuosi);
  if (!t) return tulos;
  for (const [k, v] of Object.entries(t.kentat)) tulos[k as TaulukkoKentta] = v.lahde;
  return tulos;
}
