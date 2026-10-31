import { type Cents, Euro } from '@penni/euro';
import { Luonne, onko } from '../accounts/luonne.js';
import type { Tili } from '../accounts/tili.js';
import type { IsoDate } from '../vouchers/types.js';
import { jasennaKaava, tilitAlueille } from './raporttiKaava.js';
import { haeSaldot } from './saldot.js';
import { type ResourceEnv, ResourceError, type Storage } from './storage.js';

/** One report-row definition (the JSON blob shape: L formula + S/V/M + language-keyed labels). */
export type RaporttiRiviMaaritys = Record<string, unknown>;

export interface RaporttiMaaritys {
  nimi?: Record<string, string>;
  muoto?: Record<string, string>;
  rivit: RaporttiRiviMaaritys[];
}

/**
 * One rendered output row. `arvo` is null for header/title rows; `tyhja` marks a blank spacer.
 * `tili` is set only on per-account detail rows (erittelyrivi, teksti "4000 Ostot").
 * `kaavarivi` is the 0-based index of the layout row (`maaritys.rivit`) that produced the row;
 * erittelyrivit carry their parent formula row's index. Rows are dropped per period when empty,
 * so this is the stable key for aligning several renderings of one layout (kuukausiraportti).
 */
export interface RaporttiRivi {
  teksti: string;
  sisennys: number;
  lihava: boolean;
  arvo: Cents | null;
  tyhja?: boolean;
  tili?: number;
  kaavarivi?: number;
  /**
   * Vain `kaikkiRivit`-tilassa: rivin laji, jonka perusteella kuukausittainen raportti soveltaa
   * Kitsaksen näyttösääntöjä yhdistetylle riville. 'otsikko' = pelkkä otsikkorivi (tyhjä L),
   * 'valisumma' = '='-rivi, 'ohitettava' = rivin tileillä ei ole saldoa eikä S/H pakota riviä
   * näkyviin (tavallisessa tilassa rivi jätettäisiin pois).
   */
  kaavaLaji?: 'otsikko' | 'valisumma' | 'ohitettava';
}

export interface TulkintaValinnat {
  /** Tilikohtaiset erittelyt '*'-riveille (Kitsas: RaporttiValinnat::TulostaErittely). */
  erittelyt?: boolean;
  /**
   * Kaikki kaavarivit mukaan arvoineen: ei tyhjän rivin eikä peräkkäisen välisumman ohitusta, vaan
   * rivit merkitään `kaavaLaji`lla. Kuukausittainen raportti päättää näkyvyyden vasta kaikkien
   * kuukausien yli (Kitsas laatii kaavan kerran kaikille sarakkeille, laatijankuukausiraportti.cpp).
   * Oletus pois.
   */
  kaikkiRivit?: boolean;
}

function lukuArvo(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
function tekstiArvo(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Render a report layout against sign-normalized saldot (mirrors LaatijanTaseTulos::kirjoitaRaportti,
 * laatijantasetulos.cpp:209-381), single column. Comparative/budget columns are deferred. No sign
 * flip — `haeSaldot` already returns income +, expenses −.
 *
 * With `erittelyt`, every row whose formula carries `*` is followed by one row per account in its
 * range (laatijantasetulos.cpp:334-378): "numero nimi", indent +1, the account's own saldo, same
 * `+`/`-` filter; accounts missing from the chart are skipped. Penni addition: zero-saldo accounts
 * are omitted (a period's netted-out account would otherwise list as 0,00).
 */
export function tulkitseRaportti(
  maaritys: RaporttiMaaritys,
  saldot: ReadonlyMap<number, Cents>,
  chart: readonly Tili[],
  kieli = 'fi',
  valinnat: TulkintaValinnat = {},
): RaporttiRivi[] {
  const tilit = [...saldot.keys()].map(String).sort();
  const luonteet = new Map<number, number>(chart.map((t) => [t.numero, t.luonne]));
  // Lehtitilit numerolla — otsikko voi jakaa numeron tilin kanssa (ks. tili.ts).
  const lehtitilit = new Map<number, Tili>(
    chart.filter((t) => t.otsikkotaso === 0).map((t) => [t.numero, t]),
  );
  const kaikki = valinnat.kaikkiRivit === true;
  const out: RaporttiRivi[] = [];
  let kokosumma: Cents = Euro.fromCents(0);
  let edellinenValisumma = false;

  const lisaaTyhja = (): void => {
    if (out.length > 0 && out[out.length - 1]?.tyhja) return; // no two consecutive blanks
    out.push({ teksti: '', sisennys: 0, lihava: false, arvo: null, tyhja: true });
  };

  for (const [kaavarivi, map] of maaritys.rivit.entries()) {
    const kaava = tekstiArvo(map.L);
    const sisennys = lukuArvo(map.S);
    const teksti = tekstiArvo(map[kieli]);
    const lihava = tekstiArvo(map.M).includes('bold');
    for (let i = 0; i < lukuArvo(map.V); i++) lisaaTyhja();

    if (kaava === '') {
      // pure title row
      out.push({
        teksti,
        sisennys,
        lihava,
        arvo: null,
        kaavarivi,
        ...(kaikki ? { kaavaLaji: 'otsikko' as const } : {}),
      });
      continue;
    }

    const f = jasennaKaava(kaava);
    if (!kaikki && f.lisaaValisumma && edellinenValisumma) continue; // no two subtotals in a row

    const rivinTilit = tilitAlueille(f.alueet, tilit);
    let summa: Cents = Euro.fromCents(0);
    for (const tili of rivinTilit) {
      if (f.vainMenot || f.vainTulot) {
        const l = luonteet.get(tili) ?? 0;
        if ((f.vainMenot && !onko(l, Luonne.MENO)) || (f.vainTulot && !onko(l, Luonne.TULO)))
          continue;
      }
      summa = Euro.add(summa, saldot.get(tili) ?? Euro.fromCents(0));
    }

    if (f.laskeSummaan && !f.otsikko) kokosumma = Euro.add(kokosumma, summa);

    let kaavaLaji: RaporttiRivi['kaavaLaji'];
    if (f.lisaaValisumma) {
      summa = Euro.add(summa, kokosumma);
      kaavaLaji = 'valisumma';
    } else if (!f.naytaTyhja && rivinTilit.length === 0) {
      if (!kaikki) continue;
      kaavaLaji = 'ohitettava';
    }
    edellinenValisumma = f.lisaaValisumma;

    out.push({
      teksti,
      sisennys,
      lihava,
      arvo: f.otsikko ? null : summa,
      kaavarivi,
      ...(kaikki && kaavaLaji ? { kaavaLaji } : {}),
    });

    if (f.naytaErittelyt && valinnat.erittelyt) {
      for (const numero of rivinTilit) {
        const tili = lehtitilit.get(numero);
        if (
          !tili ||
          (f.vainMenot && !onko(tili.luonne, Luonne.MENO)) ||
          (f.vainTulot && !onko(tili.luonne, Luonne.TULO))
        )
          continue;
        const arvo = saldot.get(numero) ?? Euro.fromCents(0);
        if (arvo === 0) continue;
        const nimi = tili.nimi[kieli] ?? tili.nimi.fi ?? '';
        out.push({
          teksti: `${numero} ${nimi}`,
          sisennys: sisennys + 1,
          lihava: false,
          arvo,
          tili: numero,
          kaavarivi,
        });
      }
    }
  }

  return out;
}

export interface RaporttiParams {
  muoto: string; // e.g. 'tase/yleinen' | 'tulos/yleinen'
  pvm: IsoDate;
  alkupvm?: IsoDate;
  /** Tilikohtaiset erittelyt '*'-riveille (oletus pois). */
  erittelyt?: boolean;
  /** Kaikki kaavarivit mukaan (ks. TulkintaValinnat.kaikkiRivit); oletus pois. */
  kaikkiRivit?: boolean;
}

/** Render a named report layout (stored in settings) for the given period. */
export async function laadiRaportti(
  storage: Storage,
  env: ResourceEnv,
  params: RaporttiParams,
): Promise<RaporttiRivi[]> {
  const asetukset = await storage.getAsetukset();
  const json = asetukset[params.muoto];
  if (!json) throw new ResourceError('EIRAPORTTIA', `Raporttia ${params.muoto} ei ole määritetty`);
  const maaritys = JSON.parse(json) as RaporttiMaaritys;

  const onTase = params.muoto.startsWith('tase');
  const saldot = await haeSaldot(storage, env, {
    pvm: params.pvm,
    ...(params.alkupvm !== undefined ? { alkupvm: params.alkupvm } : {}),
    ...(onTase ? { tase: true } : { tuloslaskelma: true }),
  });
  const chart = await storage.getChart();
  return tulkitseRaportti(maaritys, saldot, chart, 'fi', {
    erittelyt: params.erittelyt === true,
    kaikkiRivit: params.kaikkiRivit === true,
  });
}
