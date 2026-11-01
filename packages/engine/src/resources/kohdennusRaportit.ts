import { type Cents, Euro } from '@penni/euro';
import { budjettiKohdennukselle, toteumaProsentti } from '../kohdennukset/budjetti.js';
import {
  type Kohdennus,
  KohdennusTyyppi,
  YLEINEN_ID,
  kohdennuksenNimi,
  kohdennuksenPolku,
  kohdennusSuodatin,
} from '../kohdennukset/kohdennus.js';
import type { IsoDate } from '../vouchers/types.js';
import { type RaporttiRivi, haeRaporttiMaaritys, tulkitseRaportti } from './raportti.js';
import { haeSaldot } from './saldot.js';
import { type ResourceEnv, ResourceError, type Storage } from './storage.js';

export interface KohdennusRaporttiParams {
  muoto: string;
  alkupvm: IsoDate;
  pvm: IsoDate;
  laji: 'kustannuspaikat' | 'projektit';
  /** Vain projekteille: rajaa tämän kustannuspaikan (0 = Yleisen) projekteihin. */
  kustannuspaikka?: number;
}

/** Yksi raportin osio: kohdennuksen tuloslaskelma. `tuntematon` = id, jota ei ole tallennettu
 *  kustannuspaikkana tai projektina, mutta jota viennit käyttävät. */
export interface KohdennusOsio {
  kohdennus: { id: number; nimi: string; polku: string; tuntematon?: true };
  rivit: RaporttiRivi[];
}

interface Osio {
  kohdennus: KohdennusOsio['kohdennus'];
  suodatin: { kohdennukset?: number[]; merkkaus?: number };
}

function kohdennusOsio(k: Kohdennus, kaikki: readonly Kohdennus[]): Osio {
  return {
    kohdennus: { id: k.id, nimi: kohdennuksenNimi(k), polku: kohdennuksenPolku(k, kaikki) },
    suodatin: kohdennusSuodatin(kaikki, k.id),
  };
}

/** Yleinen ensin, tallennetut polun mukaan, tuntemattomat viimeisinä id:n mukaan. */
function osioidenJarjestys(a: Osio, b: Osio): number {
  const ryhma = (o: Osio) => (o.kohdennus.id === YLEINEN_ID ? 0 : o.kohdennus.tuntematon ? 2 : 1);
  return (
    ryhma(a) - ryhma(b) ||
    (ryhma(a) === 2
      ? a.kohdennus.id - b.kohdennus.id
      : a.kohdennus.polku.localeCompare(b.kohdennus.polku, 'fi'))
  );
}

/**
 * Tuloslaskelma kohdennuksittain (Kitsas: Kustannuspaikat / Projektit -raportit), yksi osio per
 * kohdennus. Kustannuspaikat: osio per kustannuspaikka projekteineen, Yleinen (kohdentamattomat ja
 * Yleisen alla olevat projektit) ja oma osio jokaiselle käytetylle id:lle, joka ei ole tallennettu
 * kustannuspaikka tai projekti, joten osiot summautuvat aina koko tuloslaskelmaan. Projektit: osio
 * per projekti, valinnaisesti vain `kustannuspaikka`n alla olevat. Osiot, joiden saldot ovat kaikki
 * nollia, jätetään pois; voimassaolo ei piilota osiota, jolla on lukuja.
 */
export async function laadiKohdennusRaportti(
  storage: Storage,
  env: ResourceEnv,
  p: KohdennusRaporttiParams,
): Promise<KohdennusOsio[]> {
  const [maaritys, chart, kaikki] = await Promise.all([
    haeRaporttiMaaritys(storage, p.muoto),
    storage.getChart(),
    storage.getKohdennukset(),
  ]);
  const { KUSTANNUSPAIKKA, PROJEKTI } = KohdennusTyyppi;

  const osiot: Osio[] = [];
  if (p.laji === 'kustannuspaikat') {
    for (const k of kaikki) if (k.tyyppi === KUSTANNUSPAIKKA) osiot.push(kohdennusOsio(k, kaikki));
    osiot.push({
      kohdennus: { id: YLEINEN_ID, nimi: 'Yleinen', polku: 'Yleinen' },
      suodatin: kohdennusSuodatin(kaikki, YLEINEN_ID),
    });
    const kaytto = await storage.laskeKohdennustenKaytto();
    const raportoitavat = new Set(
      kaikki.filter((k) => k.tyyppi === KUSTANNUSPAIKKA || k.tyyppi === PROJEKTI).map((k) => k.id),
    );
    for (const [id, lkm] of kaytto) {
      if (lkm <= 0 || id === YLEINEN_ID || raportoitavat.has(id)) continue;
      const nimi = `Tuntematon kohdennus (${id})`;
      osiot.push({
        kohdennus: { id, nimi, polku: nimi, tuntematon: true },
        suodatin: { kohdennukset: [id] },
      });
    }
  } else {
    const rajaus =
      p.kustannuspaikka !== undefined
        ? new Set(kohdennusSuodatin(kaikki, p.kustannuspaikka).kohdennukset ?? [])
        : undefined;
    for (const k of kaikki)
      if (k.tyyppi === PROJEKTI && (!rajaus || rajaus.has(k.id)))
        osiot.push(kohdennusOsio(k, kaikki));
  }
  osiot.sort(osioidenJarjestys);

  const saldot = await Promise.all(
    osiot.map((o) =>
      haeSaldot(storage, env, {
        pvm: p.pvm,
        alkupvm: p.alkupvm,
        tuloslaskelma: true,
        ...o.suodatin,
      }),
    ),
  );
  const out: KohdennusOsio[] = [];
  osiot.forEach((o, i) => {
    const s = saldot[i] as Map<number, Cents>;
    if ([...s.values()].every((v) => v === 0)) return;
    out.push({ kohdennus: o.kohdennus, rivit: tulkitseRaportti(maaritys, s, chart, 'fi') });
  });
  return out;
}

export interface BudjettivertailuParams {
  muoto: string;
  /** Tilikauden alkupäivä. */
  tilikausi: IsoDate;
  /** Toteuman loppupäivä; oletus tilikauden loppu. Budjetti on aina koko vuoden. */
  pvm?: IsoDate;
  /** Kohdennus kuten laadiRaportti; puuttuu = koko budjetti ja kaikki viennit. */
  kohdennus?: number;
}

/** Raporttirivi budjetin ja toteuman sarakkein. Rahat sentteinä raportin etumerkein (tulot +,
 *  menot −); `prosentti` prosentin sadasosina, puuttuu kun budjetti on 0. */
export interface BudjettivertailuRivi {
  teksti: string;
  sisennys: number;
  lihava: boolean;
  tyhja?: boolean;
  tili?: number;
  kaavarivi?: number;
  budjetti: Cents | null;
  toteutunut: Cents | null;
  /** toteutunut − budjetti: negatiivinen = budjettia huonompi sekä tuloilla että menoilla. */
  ero: Cents | null;
  prosentti?: number;
}

/**
 * Budjettivertailu (Kitsas laatijantasetulos.cpp:359-370): raporttikaava budjetille (koko tilikausi,
 * kohdennuksen rollup kuten suodattimessa) ja toteumalle (tilikauden alusta `pvm`:ään samalla
 * suodattimella). Molemmat renderöidään `kaikkiRivit`-tilassa ja kohdistetaan kaavariveittäin
 * (kuten KuukausiRaportti), joten välisummat pysyvät johdonmukaisina; rivi jää pois, kun
 * tavallinen tila jättäisi sen pois kummaltakin.
 */
export async function laadiBudjettivertailu(
  storage: Storage,
  env: ResourceEnv,
  p: BudjettivertailuParams,
): Promise<BudjettivertailuRivi[]> {
  const [maaritys, chart, kaikki, kaudet, budjetti] = await Promise.all([
    haeRaporttiMaaritys(storage, p.muoto),
    storage.getChart(),
    storage.getKohdennukset(),
    storage.getTilikaudet(),
    storage.getBudjetti(p.tilikausi),
  ]);
  const kausi = kaudet.find((k) => k.alkaa === p.tilikausi);
  if (!kausi) throw new ResourceError('EITILIKAUTTA', `Tilikautta ${p.tilikausi} ei ole`);

  const toteuma = await haeSaldot(storage, env, {
    pvm: p.pvm ?? kausi.loppuu,
    alkupvm: kausi.alkaa,
    tuloslaskelma: true,
    ...(p.kohdennus !== undefined ? kohdennusSuodatin(kaikki, p.kohdennus) : {}),
  });
  const valinnat = { kaikkiRivit: true };
  const budjettiRivit = tulkitseRaportti(
    maaritys,
    budjettiKohdennukselle(budjetti, kaikki, p.kohdennus),
    chart,
    'fi',
    valinnat,
  );
  const toteumaRivit = new Map<number, RaporttiRivi>();
  for (const r of tulkitseRaportti(maaritys, toteuma, chart, 'fi', valinnat))
    if (r.kaavarivi !== undefined) toteumaRivit.set(r.kaavarivi, r);

  // Tavallisen tilan näyttösäännöt yhdistetylle riville (raportti.ts tulkitseRaportti): ei
  // kahta tyhjää peräkkäin, ei kahta välisummaa peräkkäin, tyhjä rivi pois.
  const out: BudjettivertailuRivi[] = [];
  let edellinenValisumma = false;
  for (const b of budjettiRivit) {
    if (b.tyhja) {
      if (!out[out.length - 1]?.tyhja)
        out.push({ ...tekstiosa(b), budjetti: null, toteutunut: null, ero: null });
      continue;
    }
    const t = b.kaavarivi !== undefined ? toteumaRivit.get(b.kaavarivi) : undefined;
    const valisumma = b.kaavaLaji === 'valisumma';
    if (b.kaavaLaji === 'ohitettava' && t?.kaavaLaji === 'ohitettava') continue;
    if (valisumma && edellinenValisumma) continue;
    if (b.kaavaLaji !== 'otsikko') edellinenValisumma = valisumma;

    const toteutunut = t?.arvo ?? null;
    const molemmatTyhjia = b.arvo === null && toteutunut === null;
    const nolla = Euro.fromCents(0);
    const prosentti = molemmatTyhjia
      ? undefined
      : toteumaProsentti(toteutunut ?? nolla, b.arvo ?? nolla);
    out.push({
      ...tekstiosa(b),
      budjetti: b.arvo,
      toteutunut,
      ero: molemmatTyhjia ? null : Euro.sub(toteutunut ?? nolla, b.arvo ?? nolla),
      ...(prosentti !== undefined ? { prosentti } : {}),
    });
  }
  return out;
}

function tekstiosa(
  r: RaporttiRivi,
): Pick<BudjettivertailuRivi, 'teksti' | 'sisennys' | 'lihava' | 'tyhja' | 'tili' | 'kaavarivi'> {
  return {
    teksti: r.teksti,
    sisennys: r.sisennys,
    lihava: r.lihava,
    ...(r.tyhja ? { tyhja: true } : {}),
    ...(r.tili !== undefined ? { tili: r.tili } : {}),
    ...(r.kaavarivi !== undefined ? { kaavarivi: r.kaavarivi } : {}),
  };
}
