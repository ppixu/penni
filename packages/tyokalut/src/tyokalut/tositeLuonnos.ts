import {
  type Tosite,
  TositeTila,
  type ValidationContext,
  type Violation,
  type VirheKoodi,
  lataaKartta,
  muodostaValidointiKonteksti,
  tarkasta,
} from '@penni/engine';
import { type Cents, muotoileEuro } from '@penni/euro';
import { z } from 'zod/v4';
import { TyokaluVirhe, maaritaTyokalu, pvmSchema } from '../tyokalu.js';

const vientiSchema = z.object({
  tili: z.number().int(),
  debet: z.number().int().nonnegative(), // sentteinä
  kredit: z.number().int().nonnegative(), // sentteinä
  pvm: pvmSchema.optional(),
  selite: z.string().optional(),
  alvKoodi: z.number().int().optional(),
  alvProsentti: z.number().optional(),
});

/**
 * Tarkastuskoodit, joilla luonnostakaan ei tallenneta. Tilikarttaan kuulumaton tili ja
 * kalenterissa olematon päivä ovat aina kirjoitusvirheitä, eikä ihminen voi viimeistellä
 * tällaista luonnosta muuttamatta sitä — siksi agentti saa ne heti virheenä. (PVMLUKITTU
 * hylätään jo moottorissa kaikilla tiloilla.) Muut havainnot, esim. täsmäämätön debet/kredit,
 * ovat sallittuja keskeneräisessä luonnoksessa ja palautetaan varoituksina.
 */
const LUONNOKSEN_ESTAVAT: ReadonlySet<VirheKoodi> = new Set(['TILIPUUTTUU', 'PVMPUUTTUU']);

export interface LuonnosVaroitus {
  koodi: VirheKoodi;
  viesti: string;
  /** Tosi, kun havainto estää luonnoksen kirjaamisen (tila >= 100) sellaisenaan. */
  estaaKirjauksen: boolean;
}

function puuttuvatTilit(t: Tosite, ctx: ValidationContext): number[] {
  const tilit = t.viennit
    .filter((v) => (v.debet !== 0 || v.kredit !== 0) && !ctx.chart.some((a) => a.numero === v.tili))
    .map((v) => v.tili);
  return [...new Set(tilit)];
}

/** Ihmis- ja agenttiluettava selitys yhdelle tarkasta-havainnolle. */
function viesti(koodi: VirheKoodi, t: Tosite, ctx: ValidationContext): string {
  switch (koodi) {
    case 'EITASMAA': {
      const debet = t.viennit.reduce((s, v) => s + v.debet, 0) as Cents;
      const kredit = t.viennit.reduce((s, v) => s + v.kredit, 0) as Cents;
      return (
        `Debet ${muotoileEuro(debet)} ja kredit ${muotoileEuro(kredit)} eivät täsmää ` +
        `(erotus ${muotoileEuro((debet - kredit) as Cents)}).`
      );
    }
    case 'TILIPUUTTUU':
      return `Tiliä ${puuttuvatTilit(t, ctx).join(', ')} ei ole tilikartassa — tarkista tilinumero tilikartasta.`;
    case 'PVMPUUTTUU':
      return 'Tositteen tai viennin päivämäärä ei ole kelvollinen kalenteripäivä.';
    case 'EIAVOINTAKUTTA':
      return `Päivä ei osu millekään kirjanpidon tilikaudelle (${ctx.kausiAlkaa}–${ctx.kausiLoppuu}); luonnosta ei voi kirjata ennen kuin tilikausi on olemassa.`;
    case 'PVMLUKITTU':
      return 'Päivä osuu lukittuun tilikauteen.';
    case 'PVMALV':
      return 'Alv-koodillinen vienti osuu jo ilmoitetulle alv-kaudelle.';
    case 'EITASMAAPVM':
      return 'Debet ja kredit eivät täsmää kaikilla vientipäivillä erikseen.';
    case 'ALVITON_ALVKIRJAUS':
      return 'Vientiin on merkitty alv, vaikka kirjanpito ei ole alv-velvollinen viennin päivänä.';
    case 'ERA_ILMAN_ERITTELYA':
      return 'Viennillä on tase-erä tilillä, jonka eriä ei eritellä.';
  }
}

function varoitukset(
  rikkeet: readonly Violation[],
  t: Tosite,
  ctx: ValidationContext,
): LuonnosVaroitus[] {
  return rikkeet.map((r) => ({
    koodi: r.code,
    viesti: viesti(r.code, t, ctx),
    estaaKirjauksen: r.severity === 'block',
  }));
}

export const tositeLuonnos = maaritaTyokalu({
  nimi: 'tosite_luonnos',
  kuvaus:
    'Luo LUONNOS-tilainen tosite (tila 50). Rahamäärät ovat kokonaislukusenttejä. ' +
    'Ei koskaan kirjaa kirjanpitoon asti — ihminen viimeistelee luonnoksen sovelluksessa. ' +
    'Luonnos tarkastetaan samoin kuin kirjattaessa: havainnot palautetaan varoitukset-' +
    'listassa ({koodi, viesti, estaaKirjauksen}), esim. EITASMAA kun debet ja kredit eivät ' +
    'täsmää — korjaa ne heti. Tilikarttaan kuulumaton tili (TILIPUUTTUU) tai kelvoton päivä ' +
    '(PVMPUUTTUU) hylkää luonnoksen kokonaan.',
  kirjoittava: true,
  syote: z.object({
    pvm: pvmSchema,
    tyyppi: z.number().int(),
    sarja: z.string().optional(),
    otsikko: z.string().optional(),
    tila: z.number().int().optional(),
    viennit: z.array(vientiSchema).min(2),
  }),
  async suorita(client, syote) {
    if (syote.tila !== undefined && syote.tila !== TositeTila.LUONNOS) {
      throw new TyokaluVirhe(
        'LUONNOSVAIN',
        `Agentti saa luoda vain LUONNOS-tilaisia (${TositeTila.LUONNOS}) tositteita.`,
      );
    }
    const luonnos: Tosite = {
      pvm: syote.pvm,
      tyyppi: syote.tyyppi,
      tila: TositeTila.LUONNOS,
      tunniste: 0,
      sarja: syote.sarja ?? '',
      ...(syote.otsikko !== undefined ? { otsikko: syote.otsikko } : {}),
      viennit: syote.viennit.map((v) => ({
        tili: v.tili,
        debet: v.debet as Cents,
        kredit: v.kredit as Cents,
        pvm: v.pvm ?? syote.pvm,
        alvKoodi: v.alvKoodi ?? 0,
        alvProsentti: v.alvProsentti ?? 0,
        ...(v.selite !== undefined ? { selite: v.selite } : {}),
      })),
    };

    // Sama tarkastus ja konteksti kuin kirjattaessa (muutaTositteenTila -> tarkasta).
    const init = await client.haeInit();
    const ctx = muodostaValidointiKonteksti(
      lataaKartta(init.tilit),
      init.tilikaudet,
      init.asetukset,
    );
    const rikkeet = tarkasta(luonnos, ctx);
    const estava = rikkeet.find((r) => LUONNOKSEN_ESTAVAT.has(r.code));
    if (estava) throw new TyokaluVirhe(estava.code, viesti(estava.code, luonnos, ctx));

    const { tila: _tila, tunniste: _tunniste, ...syoteMoottorille } = luonnos;
    const tosite = await client.luoTosite({ ...syoteMoottorille, tila: TositeTila.LUONNOS });
    return {
      id: tosite.id,
      tila: tosite.tila,
      tunniste: tosite.tunniste,
      pvm: tosite.pvm,
      varoitukset: varoitukset(rikkeet, luonnos, ctx),
    };
  },
});
