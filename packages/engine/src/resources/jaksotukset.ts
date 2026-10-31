import { type Cents, roundHalfAway } from '@penni/euro';
import { Luonne } from '../accounts/luonne.js';
import { tiliTyypilla } from '../accounts/tili.js';
import { TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { tilikausiPaivalle } from './numbering.js';
import {
  type ResourceEnv,
  ResourceError,
  type Storage,
  type StoredTosite,
  type Tilikausi,
} from './storage.js';
import { tallennaTosite } from './tositeResource.js';

/** UTC-integer whole-day difference b − a. */
function paivia(a: IsoDate, b: IsoDate): number {
  const ms = (iso: IsoDate) =>
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** Seuraava päivä (UTC, kokonaisluku). */
function seuraavaPaiva(iso: IsoDate): IsoDate {
  return new Date(paivia('1970-01-01', iso) * 86_400_000 + 86_400_000)
    .toISOString()
    .slice(0, 10) as IsoDate;
}

/**
 * Jaksotuksen päiväsuhteutus (tilikaudetroute.cpp:444-466). Palauttaa etumerkillisen
 * senttimäärän, joka kuuluu päättyvälle kaudelle: Branch A (vienti kirjattu kauden
 * päättymisen JÄLKEEN) palauttaa positiivisen ennen-osuuden; Branch B (kirjattu
 * kauden aikana) palauttaa negatiivisen jälkeen-osuuden (siirretään pois kaudelta).
 * Yksi pyöristysraja (roundHalfAway = qRound64), kuten alv-kanta. Kerromme ennen
 * jakoa ((euro*osuus)/päivät) toisin kuin legacy, joka kertoo valmiiksi lasketulla
 * suhdeluvulla (euro*(osuus/päivät)); tulos on matemaattisesti tarkempi ja voi tasan
 * puolen sentin tilanteissa poiketa legacystä enintään sentin. Tosite pysyy silti
 * tasan (vasta- ja päävienti peilaavat saman luvun).
 */
export function laskeJaksotus(
  kausiLoppuu: IsoDate,
  vientiPvm: IsoDate,
  jaksoalkaa: IsoDate,
  jaksoloppuu: IsoDate | undefined,
  euroSnt: number,
): Cents {
  const ennen = paivia(jaksoalkaa, kausiLoppuu) + 1;
  const jalkeen = jaksoloppuu ? paivia(kausiLoppuu, jaksoloppuu) : 0;
  if (vientiPvm > kausiLoppuu) {
    if (jaksoalkaa > kausiLoppuu) return 0 as Cents;
    if (!jaksoloppuu || jaksoloppuu <= kausiLoppuu) return euroSnt as Cents;
    return roundHalfAway((euroSnt * ennen) / (ennen + jalkeen)) as Cents;
  }
  if (jaksoloppuu && jaksoloppuu <= kausiLoppuu) return 0 as Cents;
  if (!jaksoloppuu && jaksoalkaa <= kausiLoppuu) return 0 as Cents;
  if (!jaksoloppuu || jaksoalkaa > kausiLoppuu) return -euroSnt as Cents;
  return -roundHalfAway((euroSnt * jalkeen) / (ennen + jalkeen)) as Cents;
}

export interface JaksotuksetParams {
  loppupvm: IsoDate;
}

export interface JaksotusRivi {
  tili: number;
  maara: Cents; // etumerkillinen: + => päälle debet, − => päälle kredit
  selite: string;
  kohdennus?: number;
  jaksoalkaa?: IsoDate; // vain Branch-B-rivit (rullaa eteenpäin)
  jaksoloppuu?: IsoDate;
}

export interface Jaksotuslaskelma {
  loppupvm: IsoDate;
  rivit: JaksotusRivi[];
  joKirjattu: boolean;
}

export type JaksotuksetSyote = JaksotuksetParams;

/** Ihmisluettava tositetunnus (sarja+tunniste) jaksotusselitteeseen. */
function tositeTunnus(t: StoredTosite): string {
  return t.tunniste ? `${t.sarja}${t.tunniste}` : '';
}

/** Vaadi että loppupvm on tilikauden viimeinen päivä (EIKAUDENLOPPU); palauta kausi. */
async function vaadiKausiLoppu(storage: Storage, loppupvm: IsoDate): Promise<Tilikausi> {
  const kaudet = await storage.getTilikaudet();
  const kausi = tilikausiPaivalle(kaudet, loppupvm);
  if (!kausi || kausi.loppuu !== loppupvm)
    throw new ResourceError(
      'EIKAUDENLOPPU',
      'Jaksotukset kirjataan tilikauden viimeiselle päivälle',
    );
  return kausi;
}

/** Onko kaudelle jo kirjattu JAKSOTUS-tosite (tila >= 100)? */
async function joJaksotettu(storage: Storage, loppupvm: IsoDate): Promise<boolean> {
  const aiemmat = await storage.listTositteet({
    bucket: 'kirjanpidossa',
    tyyppi: TositeTyyppi.JAKSOTUS,
    alkupvm: loppupvm,
    loppupvm,
  });
  return aiemmat.length > 0;
}

/**
 * Skannaa kirjatut viennit joilla on jaksoalkaa ja vienti.pvm >= kausi.alkaa (ei
 * yläraja — kauden jälkeen kirjatut, osittain kaudelle kuuluvat, mukaan). Suhteutus
 * vienti.pvm:n mukaan (per-vienti-peruste, kuten 1h/1i). Rullaustiedot (jaksoalkaa/
 * jaksoloppuu) vain Branch-B-riveille (vienti.pvm <= kausi.loppuu).
 */
async function laskeRivit(storage: Storage, kausi: Tilikausi): Promise<JaksotusRivi[]> {
  const tositteet = await storage.listTositteet({ bucket: 'kirjanpidossa' });
  const rivit: JaksotusRivi[] = [];
  for (const t of tositteet) {
    for (const v of t.viennit) {
      if (!v.jaksoalkaa || v.pvm < kausi.alkaa) continue;
      const maara = laskeJaksotus(
        kausi.loppuu,
        v.pvm,
        v.jaksoalkaa,
        v.jaksoloppuu,
        v.debet - v.kredit,
      );
      if (maara === 0) continue;
      const rivi: JaksotusRivi = {
        tili: v.tili,
        maara,
        selite: `${tositeTunnus(t)} ${v.selite ?? ''}`.trim(),
      };
      if (v.kohdennus) rivi.kohdennus = v.kohdennus;
      if (v.pvm <= kausi.loppuu) {
        rivi.jaksoalkaa = v.jaksoalkaa;
        if (v.jaksoloppuu) rivi.jaksoloppuu = v.jaksoloppuu;
      }
      rivit.push(rivi);
    }
  }
  return rivit;
}

/** Kauden jaksotuslaskelman esikatselu (puhdas luku). Jo kirjattu -> tyhjä lista (legacy "kirjattu"). */
export async function haeJaksotukset(
  storage: Storage,
  params: JaksotuksetParams,
): Promise<Jaksotuslaskelma> {
  const kausi = await vaadiKausiLoppu(storage, params.loppupvm);
  const joKirjattu = await joJaksotettu(storage, params.loppupvm);
  const rivit = joKirjattu ? [] : await laskeRivit(storage, kausi);
  return { loppupvm: params.loppupvm, rivit, joKirjattu };
}

/**
 * Kirjaa kauden jaksotukset: päätöstosite (JAKSOTUS 9920) loppupvm:lle — per rivi
 * päävienti lähdetilille (JAKSOTUS_TP+KIRJAUS) + vasta SIIRTOVELKA/SIIRTOSAATAVA-tilille
 * (JAKSOTUS_TP+VASTAKIRJAUS) — sekä (jos seuraava tilikausi on olemassa) purkutosite
 * loppupvm+1:lle, joka peilaa jalat käänteisinä (JAKSOTUS_TA) ja rullaa yli menevän
 * jakson eteenpäin. Ei era=-1 (queryErat-suoja). Kaksi tositetta ei ole atominen —
 * sama yksittäiskirjoittajarajoite kuin alv/tulovero.
 */
export async function tallennaJaksotukset(
  storage: Storage,
  syote: JaksotuksetSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const kausi = await vaadiKausiLoppu(storage, syote.loppupvm);
  if (await joJaksotettu(storage, syote.loppupvm))
    throw new ResourceError('JOJAKSOTETTU', 'Tilikauden jaksotukset on jo kirjattu');

  const rivit = await laskeRivit(storage, kausi);
  if (rivit.length === 0)
    throw new ResourceError('EIJAKSOTETTAVAA', 'Kaudella ei ole jaksotettavaa');

  const chart = await storage.getChart();
  const luonteella = (
    luonne: (typeof Luonne)[keyof typeof Luonne],
    tarvitaan: boolean,
  ): number | undefined => {
    if (!tarvitaan) return undefined;
    const tili = tiliTyypilla(chart, luonne);
    if (!tili)
      throw new ResourceError('EITILIA', 'Siirtovelka-/siirtosaamistili puuttuu tilikartasta');
    return tili.numero;
  };
  const siirtoVelka = luonteella(
    Luonne.SIIRTOVELKA,
    rivit.some((r) => r.maara > 0),
  );
  const siirtoSaatava = luonteella(
    Luonne.SIIRTOSAATAVA,
    rivit.some((r) => r.maara < 0),
  );

  const paatosPvm = syote.loppupvm;
  const seuraavaPvm = seuraavaPaiva(paatosPvm);

  const viennit: TositeVienti[] = [];
  for (const r of rivit) {
    const maara = Math.abs(r.maara) as Cents;
    const paa: TositeVienti = {
      tili: r.tili,
      debet: (r.maara > 0 ? maara : 0) as Cents,
      kredit: (r.maara > 0 ? 0 : maara) as Cents,
      pvm: paatosPvm,
      alvKoodi: 0,
      alvProsentti: 0,
      tyyppi: VientiTyyppi.JAKSOTUS_TP + VientiTyyppi.KIRJAUS,
      selite: r.selite,
    };
    const vasta: TositeVienti = {
      tili: (r.maara > 0 ? siirtoVelka : siirtoSaatava) as number,
      debet: (r.maara > 0 ? 0 : maara) as Cents,
      kredit: (r.maara > 0 ? maara : 0) as Cents,
      pvm: paatosPvm,
      alvKoodi: 0,
      alvProsentti: 0,
      tyyppi: VientiTyyppi.JAKSOTUS_TP + VientiTyyppi.VASTAKIRJAUS,
      selite: r.selite,
    };
    if (r.kohdennus) {
      paa.kohdennus = r.kohdennus;
      vasta.kohdennus = r.kohdennus;
    }
    if (
      r.jaksoalkaa &&
      (r.jaksoalkaa > paatosPvm || (r.jaksoloppuu != null && r.jaksoloppuu > paatosPvm))
    ) {
      paa.jaksoalkaa = r.jaksoalkaa > paatosPvm ? r.jaksoalkaa : seuraavaPvm;
      if (r.jaksoloppuu && r.jaksoloppuu > paatosPvm) paa.jaksoloppuu = r.jaksoloppuu;
    }
    viennit.push(vasta, paa);
  }

  const paatos = await tallennaTosite(
    storage,
    {
      pvm: paatosPvm,
      tyyppi: TositeTyyppi.JAKSOTUS,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      otsikko: 'Tilinpäätösjaksotukset',
      viennit,
    },
    env,
  );

  const kaudet = await storage.getTilikaudet();
  const seuraavaKausi = tilikausiPaivalle(kaudet, seuraavaPvm);
  if (seuraavaKausi) {
    const purku: TositeVienti[] = [];
    for (const p of paatos.viennit) {
      const uusi: TositeVienti = {
        tili: p.tili,
        debet: (p.kredit > 0 ? p.kredit : 0) as Cents,
        kredit: (p.kredit > 0 ? 0 : p.debet) as Cents,
        pvm: seuraavaPvm,
        alvKoodi: 0,
        alvProsentti: 0,
        tyyppi: (p.tyyppi ?? 0) - VientiTyyppi.JAKSOTUS_TP + VientiTyyppi.JAKSOTUS_TA,
      };
      if (p.selite !== undefined) uusi.selite = p.selite;
      if (p.kohdennus) uusi.kohdennus = p.kohdennus;
      const onKirjaus = (p.tyyppi ?? 0) % 10 === VientiTyyppi.KIRJAUS;
      if (onKirjaus && p.jaksoloppuu && p.jaksoloppuu > seuraavaKausi.loppuu) {
        uusi.jaksoalkaa = seuraavaPvm;
        uusi.jaksoloppuu = p.jaksoloppuu;
      }
      purku.push(uusi);
    }
    await tallennaTosite(
      storage,
      {
        pvm: seuraavaPvm,
        tyyppi: TositeTyyppi.JAKSOTUS,
        tila: TositeTila.KIRJANPIDOSSA,
        sarja: '',
        otsikko: 'Tilinavauksen jaksotuskirjaukset',
        viennit: purku,
      },
      env,
    );
  }

  return paatos;
}
