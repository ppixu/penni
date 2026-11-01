import type { Asetukset, IsoDate, Vakuutusperuste } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { tarkistaIban } from '@penni/validator';
import { type ZodError, type ZodTypeAny, z } from 'zod';
import { tarkistaHetu } from './henkilo.js';
import { PalkatVirhe } from './taulukot.js';

/**
 * Palkkarekisterin tyypit ja lukijat. Työntekijät ja palkka-asetukset ovat kirjan asetuksissa
 * JSON-merkkijonoina (avaimet `ASETUS`), joten tietokantamigraatiota ei tarvita.
 * Virheviestit eivät koskaan sisällä henkilötietoja (hetu, nimi, IBAN): vain kenttäpolut.
 */

export interface Verokortti {
  alkaa: IsoDate;
  paattyy: IsoDate;
  perusBp: number; // perusprosentti, esim. 2350 = 23,5 %
  lisaBp: number;
  tuloraja: Cents; // vuosituloraja
  aiemminMaksettu: Cents; // tällä kortilla ennen Pennin käyttöä / muilta maksettu
}

export interface Tyontekija {
  id: string;
  nimi: string;
  hetu: string;
  osoite?: { katu: string; postinumero: string; kaupunki: string };
  iban?: string;
  vakuutusperuste: Vakuutusperuste;
  ammattikoodi?: string;
  palkkamuoto: 'kuukausi' | 'tunti';
  kuukausipalkka?: Cents;
  tuntipalkka?: Cents;
  puhelinetu: boolean;
  verokortit: Verokortti[];
  aktiivinen: boolean;
}

export interface PalkatAsetukset {
  tyelYhtio?: string; // PensionProvIdCode
  tyelSopimus?: string;
  tyelKokonaisBp?: Record<string, number>; // vuosittain
  tilapainenTyonantaja: boolean;
  tapaturmaYhtio?: string;
  tapaturmaSopimus?: string;
  yhteyshenkilo?: { nimi: string; puhelin: string };
  tvrVapautus: boolean;
  omaVeroViite?: string;
}

export const ASETUS = {
  tyontekijat: 'PalkatTyontekijat',
  asetukset: 'PalkatAsetukset',
  taulukot: 'PalkatTaulukot',
  erillisilmoitukset: 'PalkatErillisilmoitukset',
  palkkatilit: 'palkkatilit',
} as const;

const pvm = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sentit = z.number().int();
const bp = z.number().int().nonnegative();

const verokorttiSchema = z
  .object({
    alkaa: pvm,
    paattyy: pvm,
    perusBp: bp,
    lisaBp: bp,
    tuloraja: sentit.nonnegative(),
    aiemminMaksettu: sentit.nonnegative(),
  })
  .passthrough();

const tyontekijaSchema = z
  .object({
    id: z.string().min(1),
    nimi: z.string().min(1),
    hetu: z.string().refine(tarkistaHetu, 'virheellinen henkilötunnus'),
    osoite: z
      .object({ katu: z.string(), postinumero: z.string(), kaupunki: z.string() })
      .optional(),
    iban: z.string().refine(tarkistaIban, 'virheellinen IBAN').optional(),
    vakuutusperuste: z.enum(['tyontekija', 'yel', 'osaomistaja']),
    ammattikoodi: z.string().optional(),
    palkkamuoto: z.enum(['kuukausi', 'tunti']),
    kuukausipalkka: sentit.optional(),
    tuntipalkka: sentit.optional(),
    puhelinetu: z.boolean(),
    verokortit: z.array(verokorttiSchema),
    aktiivinen: z.boolean(),
  })
  .passthrough();

const asetuksetSchema = z
  .object({
    tyelYhtio: z.string().optional(),
    tyelSopimus: z.string().optional(),
    tyelKokonaisBp: z.record(z.string().regex(/^\d{4}$/), bp).optional(),
    tilapainenTyonantaja: z.boolean().default(false),
    tapaturmaYhtio: z.string().optional(),
    tapaturmaSopimus: z.string().optional(),
    yhteyshenkilo: z.object({ nimi: z.string(), puhelin: z.string() }).optional(),
    tvrVapautus: z.boolean().default(false),
    omaVeroViite: z.string().optional(),
  })
  .passthrough();

/** Pelkät kenttäpolut ja virhekoodit: zodin viestit voivat sisältää syötettyjä arvoja. */
function turvallinenSelite(e: ZodError): string {
  return e.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(juuri)'}: ${i.code === 'custom' ? i.message : i.code}`)
    .join('; ');
}

function lue<S extends ZodTypeAny>(asetukset: Asetukset, avain: string, schema: S, tyhja: unknown) {
  const raaka = asetukset[avain];
  if (raaka === undefined || raaka.trim() === '') return schema.parse(tyhja) as z.infer<S>;
  let json: unknown;
  try {
    json = JSON.parse(raaka);
  } catch {
    throw new PalkatVirhe('SYOTE', `Asetus ${avain} ei ole kelvollista JSONia.`);
  }
  const tulos = schema.safeParse(json);
  if (!tulos.success) {
    throw new PalkatVirhe(
      'SYOTE',
      `Asetus ${avain} on virheellinen: ${turvallinenSelite(tulos.error)}`,
    );
  }
  return tulos.data as z.infer<S>;
}

/** Lukee `PalkatTyontekijat`; puuttuva asetus on tyhjä lista. */
export function lueTyontekijat(asetukset: Asetukset): Tyontekija[] {
  return lue(
    asetukset,
    ASETUS.tyontekijat,
    z.array(tyontekijaSchema),
    [],
  ) as unknown as Tyontekija[];
}

/** Lukee `PalkatAsetukset`; puuttuvat boolean-kentät ovat false. */
export function luePalkatAsetukset(asetukset: Asetukset): PalkatAsetukset {
  return lue(asetukset, ASETUS.asetukset, asetuksetSchema, {}) as unknown as PalkatAsetukset;
}
