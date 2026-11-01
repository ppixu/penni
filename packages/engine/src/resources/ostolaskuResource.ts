import type { Cents } from '@penni/euro';
import { Luonne } from '../accounts/luonne.js';
import { tiliTyypilla } from '../accounts/tili.js';
import { type VerollinenRivi, generoiVeroviennit } from '../alv/generoiVeroviennit.js';
import { TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import { nettoYhteensaCents } from '../vouchers/rivi.js';
import type { IsoDate, TositeRivi, TositeVienti } from '../vouchers/types.js';
import { onkoMaksuperusteinenAlv } from './context.js';
// Reuse the same settings-account helper the sales resource uses (exported there for this).
import { tiliAsetuksesta } from './myyntilaskuResource.js';
import { normalisoiSaldo } from './saldot.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface OstolaskuSyote {
  pvm: IsoDate;
  laskupvm?: IsoDate;
  erapvm?: IsoDate;
  viite?: string;
  kumppani?: number;
  otsikko?: string;
  sarja?: string;
  tyyppi?: number; // default MENO(100)
  rivit: TositeRivi[];
}

/**
 * Kirjaa ostolaskun: menorivit (OSTO+KIRJAUS) + vähennettävä ALV generoiVeroviennit'illä,
 * plus ostovelkatilin vastakirjaus (OSTO+VASTAKIRJAUS) tasapainottavana eränä. Kaksivaiheinen
 * tallennus (E2): posti ensin, sitten aseta velkarivin era = tosite.id ja tallenna uudelleen.
 */
export async function tallennaOstolasku(
  storage: Storage,
  syote: OstolaskuSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  if (!syote.rivit || syote.rivit.length === 0)
    throw new ResourceError('EIRIVEJA', 'Ostolaskulla on oltava vähintään yksi rivi');

  const asetukset = await storage.getAsetukset();
  const chart = await storage.getChart();

  const apTili =
    tiliAsetuksesta(asetukset, 'OstoVelkaTili') ?? tiliTyypilla(chart, Luonne.OSTOVELKA)?.numero;
  if (apTili === undefined)
    throw new ResourceError('EIOSTOVELKATILIA', 'Ostovelkatili puuttuu (aseta OstoVelkaTili)');

  const oletusMeno = tiliAsetuksesta(asetukset, 'OletusMenotili');
  const verolliset: VerollinenRivi[] = syote.rivit.map((r) => {
    const tili = r.tili ?? oletusMeno;
    if (tili === undefined)
      throw new ResourceError('EIMENOTILIA', 'Riviltä puuttuu menotili (aseta OletusMenotili)');
    return {
      tili,
      alvKoodi: r.alvKoodi,
      alvProsentti: r.alvProsentti,
      maara: nettoYhteensaCents(r), // net cents from aNetto × myyntiKpl − discounts
      bruttoSyotto: false, // TositeRivi carries net unit prices (same as the sales path)
      puoli: 'debet',
      pvm: syote.pvm,
      ...(r.kohdennus !== undefined ? { kohdennus: r.kohdennus } : {}),
      ...(r.merkkaukset !== undefined ? { merkkaukset: r.merkkaukset } : {}),
      ...(r.selite !== undefined ? { selite: r.selite } : {}),
    };
  });

  const maksuperusteinen = onkoMaksuperusteinenAlv(asetukset, syote.pvm);
  const legs = generoiVeroviennit(verolliset, chart, maksuperusteinen);
  const velkaMaara = legs.reduce((a, v) => a + v.debet - v.kredit, 0) as Cents;
  if (velkaMaara <= 0)
    throw new ResourceError('EISUMMAA', 'Ostolaskun loppusumman on oltava positiivinen');
  const velka: TositeVienti = {
    tili: apTili,
    debet: 0 as Cents,
    kredit: velkaMaara,
    pvm: syote.pvm,
    alvKoodi: 0,
    alvProsentti: 0,
    tyyppi: VientiTyyppi.OSTO + VientiTyyppi.VASTAKIRJAUS,
  };
  const viennit = [...legs, velka];

  const posted = await tallennaTosite(
    storage,
    {
      pvm: syote.pvm,
      tyyppi: syote.tyyppi ?? TositeTyyppi.MENO,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: syote.sarja ?? '',
      viennit,
      ...(syote.laskupvm !== undefined ? { laskupvm: syote.laskupvm } : {}),
      ...(syote.erapvm !== undefined ? { erapvm: syote.erapvm } : {}),
      ...(syote.viite !== undefined ? { viite: syote.viite } : {}),
      ...(syote.kumppani !== undefined ? { kumppani: syote.kumppani } : {}),
      ...(syote.otsikko !== undefined ? { otsikko: syote.otsikko } : {}),
    },
    env,
  );

  // E2: aseta ostovelkarivin era = tosite.id ja tallenna uudelleen (id => päivitys, tunniste säilyy).
  const viennitEralla = posted.viennit.map((v) =>
    v.tili === apTili && v.kredit > 0 ? { ...v, era: posted.id } : v,
  );
  return tallennaTosite(storage, { ...posted, viennit: viennitEralla }, env);
}

/** Ostotositetyypit, jotka listaaOstolaskut huomioi (meno, kululasku, saapunut verkkolasku). */
const OSTOTYYPIT = new Set<number>([
  TositeTyyppi.MENO,
  TositeTyyppi.KULULASKU,
  TositeTyyppi.SAAPUNUTVERKKOLASKU,
]);

export interface OstolaskuListQuery {
  alkupvm?: IsoDate; // laskupvm >=
  loppupvm?: IsoDate; // laskupvm <=
  eraalkupvm?: IsoDate; // erapvm >=
  eraloppupvm?: IsoDate; // erapvm <=
  avoin?: boolean; // vain rivit, joilla avoin !== 0
  eraantynyt?: IsoDate; // vain rivit, joilla erapvm < tämä JA avoin !== 0 (erääntynyt)
  saldopvm?: IsoDate; // eräsaldo tähän päivään asti
}

export interface OstolaskuRivi {
  tosite: number; // ostolaskun tositetunnus
  pvm?: IsoDate; // laskupvm
  erapvm?: IsoDate;
  viite?: string;
  summa: Cents; // laskun loppusumma = ostovelkarivin kredit
  avoin: Cents; // avoin ostovelka (positiivinen, kun avoinna) E1
  kumppani?: number;
  toimittaja?: string; // kumppani.nimi
  era?: number;
  tili?: number; // ostovelkatili
  tyyppi: number;
  tunniste: number;
  sarja: string;
  tila: number;
}

/**
 * Listaa ostolaskut avoimella saldolla per lasku. Kunkin laskun avoin erä on sen ostovelkarivi
 * (OSTO+VASTAKIRJAUS, kredit > 0); `avoin` tulee queryErat-kyselystä normalisoituna
 * normalisoiSaldo-funktiolla (E1) niin, että avoin ostovelka näkyy positiivisena.
 */
export async function listaaOstolaskut(
  storage: Storage,
  suodatin: OstolaskuListQuery,
): Promise<OstolaskuRivi[]> {
  const tositteet = await storage.listTositteet({ bucket: 'kirjanpidossa' });
  const eraMap = await storage.queryErat(
    suodatin.saldopvm !== undefined ? { saldopvm: suodatin.saldopvm } : {},
  );
  const kumppanit = new Map((await storage.getKumppanit()).map((k) => [k.id, k.nimi] as const));

  const rivit: OstolaskuRivi[] = [];
  for (const t of tositteet) {
    if (!OSTOTYYPIT.has(t.tyyppi)) continue;

    const velka = t.viennit.find(
      (v) => v.tyyppi === VientiTyyppi.OSTO + VientiTyyppi.VASTAKIRJAUS && v.kredit > 0,
    );
    if (!velka) continue;

    const laskupvm = t.laskupvm ?? t.pvm;
    if (suodatin.alkupvm !== undefined && !(laskupvm >= suodatin.alkupvm)) continue;
    if (suodatin.loppupvm !== undefined && !(laskupvm <= suodatin.loppupvm)) continue;
    if (suodatin.eraalkupvm !== undefined && !(t.erapvm != null && t.erapvm >= suodatin.eraalkupvm))
      continue;
    if (
      suodatin.eraloppupvm !== undefined &&
      !(t.erapvm != null && t.erapvm <= suodatin.eraloppupvm)
    )
      continue;

    const era = velka.era;
    const avoin = (
      era !== undefined ? normalisoiSaldo(velka.tili, (eraMap.get(era) ?? 0) as Cents) : 0
    ) as Cents;

    if (suodatin.avoin && avoin === 0) continue;
    if (
      suodatin.eraantynyt !== undefined &&
      !(t.erapvm != null && t.erapvm < suodatin.eraantynyt && avoin !== 0)
    )
      continue;

    const rivi: OstolaskuRivi = {
      tosite: t.id,
      pvm: laskupvm,
      summa: velka.kredit as Cents,
      avoin,
      tyyppi: t.tyyppi,
      tunniste: t.tunniste,
      sarja: t.sarja,
      tila: t.tila,
      tili: velka.tili,
    };
    if (t.erapvm !== undefined) rivi.erapvm = t.erapvm;
    if (t.viite !== undefined) rivi.viite = t.viite;
    if (era !== undefined) rivi.era = era;
    if (t.kumppani !== undefined) {
      rivi.kumppani = t.kumppani;
      const nimi = kumppanit.get(t.kumppani);
      if (nimi !== undefined) rivi.toimittaja = nimi;
    }
    rivit.push(rivi);
  }

  rivit.sort((a, b) => {
    const ap = a.pvm ?? '';
    const bp = b.pvm ?? '';
    if (ap !== bp) return ap < bp ? -1 : 1;
    const av = a.viite ?? '';
    const bv = b.viite ?? '';
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return rivit;
}
