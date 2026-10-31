import { useKpClient } from '@/app/KpClientProvider';
import { useInit, useSaldot } from '@/app/kysely';
import type { ValittuTilikausi } from '@/tilikausi/valittuTilikausi';
import { type IsoDate, type Tili, type Tilikausi, type TositeVienti, nimi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/** Tilikartan näkymät (segmenttivalitsin). */
export const NAKYMAT = [
  { arvo: 'suosikit', label: 'Suosikit' },
  { arvo: 'viimeksi', label: 'Viimeksi käytetyt' },
  { arvo: 'kaikki', label: 'Kaikki' },
] as const;

export type Nakyma = (typeof NAKYMAT)[number]['arvo'];

export function onNakyma(arvo: unknown): arvo is Nakyma {
  return NAKYMAT.some((n) => n.arvo === arvo);
}

/**
 * Osoitteen `tili`-parametri (syvälinkki tilin kohdalle): positiivinen kokonaisluku numerona
 * tai merkkijonona, muuten undefined.
 */
export function lueTiliHaku(arvo: unknown): number | undefined {
  const n = typeof arvo === 'string' && /^\d+$/.test(arvo) ? Number(arvo) : arvo;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Avautuva näkymä: suosikit jos niitä on, muuten käytetyt tilit jos niitä on, muuten kaikki. */
export function alkunakyma(suosikkeja: number, kaytettyja: number): Nakyma {
  if (suosikkeja > 0) return 'suosikit';
  if (kaytettyja > 0) return 'viimeksi';
  return 'kaikki';
}

export interface TilinKaytto {
  viimeksi: IsoDate;
  maara: number;
}

/** Viennit → tilikohtainen viimeisin kirjauspäivä ja vientien lukumäärä. */
export function kokoaTilienKaytto(viennit: readonly TositeVienti[]): Map<number, TilinKaytto> {
  const tulos = new Map<number, TilinKaytto>();
  for (const v of viennit) {
    const aiempi = tulos.get(v.tili);
    if (aiempi === undefined) tulos.set(v.tili, { viimeksi: v.pvm, maara: 1 });
    else {
      aiempi.maara += 1;
      if (v.pvm > aiempi.viimeksi) aiempi.viimeksi = v.pvm;
    }
  }
  return tulos;
}

/**
 * Valitun ja sitä edeltävän tilikauden kattava väli. Ilman valintaa (tai tuntemattomalla)
 * valittuna on viimeisin kausi.
 */
export function kayttovali(
  tilikaudet: readonly Pick<Tilikausi, 'alkaa' | 'loppuu'>[],
  valittuAlkaa?: string,
): { alkupvm: IsoDate; loppupvm: IsoDate } | null {
  const jarjestyksessa = [...tilikaudet].sort((a, b) => a.alkaa.localeCompare(b.alkaa));
  const i = jarjestyksessa.findIndex((k) => k.alkaa === valittuAlkaa);
  const valittuIndeksi = i === -1 ? jarjestyksessa.length - 1 : i;
  const viimeisin = jarjestyksessa[valittuIndeksi];
  const edellinen = jarjestyksessa[valittuIndeksi - 1] ?? viimeisin;
  if (viimeisin === undefined || edellinen === undefined) return null;
  return { alkupvm: edellinen.alkaa, loppupvm: viimeisin.loppuu };
}

/**
 * Näkymän tilit lehtitileistä: suosikit ja kaikki numerojärjestyksessä (Kitsaksen tapaan
 * ysilukuina, ks. vertaaTilinumeroita), viimeksi käytetyt
 * uusin kirjaus ensin. Piilotetut jäävät pois viimeksi käytetyistä aina ja kaikista, ellei
 * `naytaPiilotetut`; suosikki ei voi olla piilotettu (tila on yksi kolmesta).
 */
export function tilitNakymassa(
  lehdet: readonly Tili[],
  nakyma: Nakyma,
  {
    suosikit,
    piilotetut,
    kaytto,
    naytaPiilotetut = false,
  }: {
    suosikit: ReadonlySet<number>;
    piilotetut: ReadonlySet<number>;
    kaytto: ReadonlyMap<number, TilinKaytto> | undefined;
    naytaPiilotetut?: boolean;
  },
): Tili[] {
  const numeroittain = (rivit: Tili[]) =>
    rivit.sort((a, b) => vertaaTilinumeroita(a.numero, b.numero));
  switch (nakyma) {
    case 'suosikit':
      return numeroittain(lehdet.filter((t) => suosikit.has(t.numero)));
    case 'viimeksi': {
      const k = kaytto ?? new Map<number, TilinKaytto>();
      return lehdet
        .filter((t) => k.has(t.numero) && !piilotetut.has(t.numero))
        .sort((a, b) => {
          const ka = k.get(a.numero)?.viimeksi ?? '';
          const kb = k.get(b.numero)?.viimeksi ?? '';
          return kb.localeCompare(ka) || a.numero - b.numero;
        });
    }
    case 'kaikki':
      return numeroittain(
        naytaPiilotetut ? [...lehdet] : lehdet.filter((t) => !piilotetut.has(t.numero)),
      );
  }
}

export interface TiliAlaryhma {
  /** Tilinumeron kaksi ensimmäistä numeroa ("11" = tilit 1100–1199 ja esim. 11xxx). */
  etuliite: string;
  /** Kartan syvin otsikko, joka kattaa koko ryhmän; tyhjä, jos sellaista ei ole. */
  nimi: string;
  /** Otsikkorivi, josta nimi tulee (selitettä varten). */
  otsikko: Tili | undefined;
  /** Nimen perään sulkeisiin, kun sama nimi toistuu (ks. ryhmitteleTilit); muuten tyhjä. */
  tarkenne: string;
  /** Ryhmän sisältämät tarkemmat otsikot (ks. sisallonOtsikot). */
  sisalto: string[];
  tilit: Tili[];
}

export interface TiliRyhma {
  /** Tilinumeron ensimmäinen numero ("1"–"9"). */
  etuliite: string;
  /** Ryhmän otsikko kartan otsikkoriveistä; tyhjä, jos kartassa ei ole sopivaa otsikkoa. */
  nimi: string;
  otsikko: Tili | undefined;
  tarkenne: string;
  sisalto: string[];
  /** Kaikki ryhmän tilit järjestyksessä. */
  tilit: Tili[];
  alaryhmat: TiliAlaryhma[];
}

/** Kitsaksen "ysiluku": numero oikealta nollilla yhdeksään numeroon, jotta 239 < 24 < 2371. */
function ysiluku(numero: number | string): number {
  return Number(String(numero).padEnd(9, '0'));
}

/**
 * Tilit Kitsaksen järjestyksessä (ysilukuina): viisinumeroinen 29391 asettuu 2939:n perään eikä
 * 9999:n jälkeen, joten saman alun tilit pysyvät yhdessä.
 */
export function vertaaTilinumeroita(a: number, b: number): number {
  return ysiluku(a) - ysiluku(b) || a - b;
}

/** Ryhmän etuliite tilinumerosta: `pituus` ensimmäistä numeroa (yksinumeroinen täydennetään). */
export function tilinEtuliite(numero: number, pituus: 1 | 2): string {
  return String(numero).padEnd(pituus, '0').slice(0, pituus);
}

/** Etuliitteen ryhmän näytettävä numero: "1" → 1000, "11" → 1100. */
export function etuliitteenNumero(etuliite: string): string {
  return etuliite.padEnd(4, '0');
}

/** Ysilukuväli, jonka etuliite kattaa: "19" → [190000000, 200000000), "9" → [900000000, ∞). */
function etuliitteenVali(etuliite: string): { alku: number; loppu: number } {
  const seuraava = String(Number(etuliite) + 1);
  return {
    alku: ysiluku(etuliite),
    loppu: seuraava.length > etuliite.length ? Number.POSITIVE_INFINITY : ysiluku(seuraava),
  };
}

interface OtsikkoVali {
  otsikko: Tili;
  alku: number;
  /** Otsikko kattaa tilit seuraavaan samantasoiseen tai ylempään otsikkoon asti. */
  loppu: number;
}

/** Kartan otsikot ysilukujärjestyksessä (samassa kohdassa ylempi ensin) kattamine väleineen. */
function otsikkoValit(kartta: readonly Tili[]): OtsikkoVali[] {
  const otsikot = kartta
    .filter((t) => t.otsikkotaso >= 1)
    .sort((a, b) => ysiluku(a.numero) - ysiluku(b.numero) || a.otsikkotaso - b.otsikkotaso);
  return otsikot.map((o) => {
    const alku = ysiluku(o.numero);
    const seuraava = otsikot.find(
      (t) => ysiluku(t.numero) > alku && t.otsikkotaso <= o.otsikkotaso,
    );
    return {
      otsikko: o,
      alku,
      loppu: seuraava ? ysiluku(seuraava.numero) : Number.POSITIVE_INFINITY,
    };
  });
}

/**
 * Tilin kattava `taso`-tason otsikko (2 = tuloslaskelman pääryhmä kuten "Henkilöstökulut"), tai
 * undefined, jos kartassa ei ole sellaista. Palauttaa haun, jotta välit lasketaan kerran.
 */
export function tasonOtsikko(
  kartta: readonly Tili[],
  taso: number,
): (numero: number) => Tili | undefined {
  const valit = otsikkoValit(kartta).filter((v) => v.otsikko.otsikkotaso === taso);
  return (numero) => {
    const y = ysiluku(numero);
    return valit.find((v) => v.alku <= y && y < v.loppu)?.otsikko;
  };
}

/**
 * Ensimmäisen numeron ryhmän otsikko: viimeinen H1/H2-otsikko, joka alkaa ryhmän alussa tai
 * ennen sitä (otsikko kattaa tilit seuraavaan samantasoiseen tai ylempään otsikkoon asti).
 * Ysilukuina 1 ja 10 alkavat samasta kohdasta; silloin valitaan ylin otsikko, joka päättyy
 * ryhmän sisällä (1 "Vastaavaa"), ja jos mikään ei pääty, syvin (3 "Myyntituotot" eikä koko
 * tuloslaskelman kattava 3 "Tuloslaskelma"). Ryhmä ilman omaa otsikkoa perii edellisen:
 * 6 → 5 "Henkilöstökulut".
 */
export function ryhmanOtsikko(kartta: readonly Tili[], numero: number): string {
  const vali = paaryhmanVali(otsikkoValit(kartta), String(numero));
  return vali ? nimi(vali.otsikko) : '';
}

function paaryhmanVali(valit: readonly OtsikkoVali[], etuliite: string): OtsikkoVali | undefined {
  const { alku, loppu } = etuliitteenVali(etuliite);
  const ennen = valit.filter((v) => v.otsikko.otsikkotaso <= 2 && v.alku <= alku);
  const viimeinen = ennen.at(-1);
  if (viimeinen === undefined) return undefined;
  const tasan = ennen.filter((v) => v.alku === viimeinen.alku);
  // Loppu lasketaan H1/H2-otsikoiden kesken, kuten ennen alaryhmiä.
  const ylaLoppu = (v: OtsikkoVali) =>
    valit.find(
      (t) =>
        t.otsikko.otsikkotaso <= 2 &&
        t.alku > v.alku &&
        t.otsikko.otsikkotaso <= v.otsikko.otsikkotaso,
    )?.alku ?? Number.POSITIVE_INFINITY;
  return tasan.find((v) => ylaLoppu(v) <= loppu) ?? viimeinen;
}

/**
 * Kahden ensimmäisen numeron alaryhmän otsikko: syvin H2–H4-otsikko, joka kattaa koko ryhmän.
 * 11 → "Aineelliset hyödykkeet" (H3 11–13), ei sen alla olevaa H4 110 "Maa- ja vesialueet",
 * joka kattaa vain osan. H5-otsikot ("Muilta", "Muille") eivät kelpaa, koska ne ovat
 * merkityksellisiä vain yläotsikkonsa alla: 92 → H4 "Muut korko- ja rahoitustuotot". Jos vain
 * H1 ("Tuloslaskelma") kattaisi ryhmän, otetaan ylin H2+-otsikko, jonka alueelle ryhmän alku
 * osuu: 23 → "Oma pääoma", 99 → "Tuloverot".
 */
export function alaryhmanOtsikko(kartta: readonly Tili[], etuliite: string): string {
  const vali = kattavaVali(otsikkoValit(kartta), etuliite);
  return vali ? nimi(vali.otsikko) : '';
}

function kattavaVali(valit: readonly OtsikkoVali[], etuliite: string): OtsikkoVali | undefined {
  const { alku, loppu } = etuliitteenVali(etuliite);
  let kattava: OtsikkoVali | undefined;
  let alunOtsikko: OtsikkoVali | undefined;
  for (const v of valit) {
    if (v.alku > alku) break;
    const taso = v.otsikko.otsikkotaso;
    if (taso < 2) continue;
    if (taso <= 4 && v.loppu >= loppu && (!kattava || taso >= kattava.otsikko.otsikkotaso))
      kattava = v;
    if (v.loppu > alku && (!alunOtsikko || taso < alunOtsikko.otsikko.otsikkotaso)) alunOtsikko = v;
  }
  return kattava ?? alunOtsikko;
}

/** Pääryhmän sisältö kuvataan H3-tarkkuudella, alaryhmän H5-tarkkuudella. */
const SISALLON_TASO = { 1: 3, 2: 5 } as const;

/**
 * Mitä etuliitteen ryhmä sisältää, nimen antanutta otsikkoa tarkemmin: lähin alempi otsikko,
 * joka kattaa ryhmän alun, ja sen perään ryhmän sisällä alkavat yhtä ylätason otsikot (ei
 * toistensa alaotsikoita). 6 "Henkilöstökulut" → ["Henkilösivukulut", "Poistot ja
 * arvonalentumiset"], 2 "Vastattavaa" → ["Oma pääoma", "Vähemmistöosuudet", …].
 */
function sisallonOtsikot(
  valit: readonly OtsikkoVali[],
  etuliite: string,
  nimetty: OtsikkoVali | undefined,
): string[] {
  const { alku, loppu } = etuliitteenVali(etuliite);
  const maxTaso = SISALLON_TASO[etuliite.length === 1 ? 1 : 2];
  const minTaso = nimetty?.otsikko.otsikkotaso ?? 0;
  let alun: OtsikkoVali | undefined;
  for (const v of valit) {
    const taso = v.otsikko.otsikkotaso;
    if (v === nimetty || taso <= minTaso || taso > maxTaso || onYhteydenOtsikko(v)) continue;
    if (v.alku <= alku && alku < v.loppu && (!alun || taso < alun.otsikko.otsikkotaso)) alun = v;
  }
  const raja = alun?.otsikko.otsikkotaso ?? maxTaso;
  const osat = alun ? [alun] : [];
  for (const v of valit) {
    if (v.alku <= alku || v.alku >= loppu || v.otsikko.otsikkotaso > raja) continue;
    if (onYhteydenOtsikko(v)) continue;
    // Samassa kohdassa ylempi tulee ensin (otsikkoValit), joten alaotsikot jäävät pois.
    if (osat.some((o) => o.alku <= v.alku && v.loppu <= o.loppu)) continue;
    osat.push(v);
  }
  return osat.map((o) => nimi(o.otsikko));
}

/**
 * H5-otsikko, joka on merkityksellinen vain yläotsikkonsa alla: "Muilta", "Muille", "Saman
 * konsernin yrityksiltä" (ablatiivi/allatiivi, ks. kattavaVali).
 */
function onYhteydenOtsikko(v: OtsikkoVali): boolean {
  return v.otsikko.otsikkotaso === 5 && /(lta|ltä|lle)$/.test(nimi(v.otsikko));
}

/** "Tavaratuonti; ostojen oikaisuerät…": enintään kaksi osaa, alku pienellä (ei lyhenteissä). */
function tarkenne(osat: readonly string[]): string {
  const pienella = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0]?.toLowerCase() + s.slice(1) : s);
  const naytettavat = osat.slice(0, 2).map(pienella).join('; ');
  return osat.length > 2 ? `${naytettavat}…` : naytettavat;
}

/** Ilman sisällön otsikoita ryhmän ensimmäinen ja viimeinen tili: "kiinnityskulut … muut kulut". */
function tilivalinTarkenne(tilit: readonly Tili[]): string {
  const ensimmainen = tilit[0];
  const viimeinen = tilit.at(-1);
  if (!ensimmainen || !viimeinen) return '';
  if (ensimmainen === viimeinen) return tarkenne([nimi(ensimmainen)]);
  return `${tarkenne([nimi(ensimmainen)])} … ${tarkenne([nimi(viimeinen)])}`;
}

/** Nimet, jotka esiintyvät useammin kuin kerran. */
function toistuvat(nimet: Iterable<string>): Set<string> {
  const nahty = new Set<string>();
  const tulos = new Set<string>();
  for (const n of nimet) {
    if (n !== '' && nahty.has(n)) tulos.add(n);
    nahty.add(n);
  }
  return tulos;
}

/**
 * Tilit ryhmiin ensimmäisen numeron ja sen sisällä kahden ensimmäisen numeron mukaan. Ryhmät ja
 * tilit ovat Kitsaksen järjestyksessä (ks. vertaaTilinumeroita) syötteen järjestyksestä
 * riippumatta, eikä sama etuliite koskaan toistu.
 *
 * Kartan otsikoista johdettu nimi toistuu usein (5 ja 6 "Henkilöstökulut", 40–43 "Ostot
 * tilikauden aikana"), joten toistuva nimi saa tarkenteen sisällön otsikoista, tai niiden
 * puuttuessa ensimmäisestä ja viimeisestä tilistä (95 ja 96 ovat kumpikin "Muille"). Toistuvuus
 * lasketaan koko kartan lehtitileistä, jottei nimi vaihdu haun tai suodatuksen mukana; alaryhmän
 * nimi lasketaan toistuvaksi myös, kun se on sama kuin pääryhmän.
 */
export function ryhmitteleTilit(tilit: readonly Tili[], kartta: readonly Tili[]): TiliRyhma[] {
  const valit = otsikkoValit(kartta);
  const lehdet = kartta.filter((t) => t.otsikkotaso === 0);
  const vali = (etuliite: string) =>
    etuliite.length === 1 ? paaryhmanVali(valit, etuliite) : kattavaVali(valit, etuliite);
  const nimella = (v: OtsikkoVali | undefined) => (v ? nimi(v.otsikko) : '');
  const kaikkienNimet = (pituus: 1 | 2) =>
    [...new Set(lehdet.map((t) => tilinEtuliite(t.numero, pituus)))].map((e) => nimella(vali(e)));
  const toistuvatPaa = toistuvat(kaikkienNimet(1));
  const toistuvatAla = toistuvat(kaikkienNimet(2));

  const jarjestetytLehdet = [...lehdet].sort((a, b) => vertaaTilinumeroita(a.numero, b.numero));

  function ryhmanTiedot(etuliite: string, toistuva: (nimi: string) => boolean) {
    const v = vali(etuliite);
    const n = nimella(v);
    const sisalto = sisallonOtsikot(valit, etuliite, v);
    const etuliitteenTilit = () =>
      jarjestetytLehdet.filter(
        (t) => tilinEtuliite(t.numero, etuliite.length as 1 | 2) === etuliite,
      );
    return {
      etuliite,
      nimi: n,
      otsikko: v?.otsikko,
      tarkenne: !toistuva(n)
        ? ''
        : sisalto.length > 0
          ? tarkenne(sisalto)
          : tilivalinTarkenne(etuliitteenTilit()),
      sisalto,
      tilit: [] as Tili[],
    };
  }

  const jarjestyksessa = [...tilit].sort((a, b) => vertaaTilinumeroita(a.numero, b.numero));
  const ryhmat: TiliRyhma[] = [];
  for (const t of jarjestyksessa) {
    const etuliite = tilinEtuliite(t.numero, 1);
    let ryhma = ryhmat.at(-1);
    if (ryhma?.etuliite !== etuliite) {
      ryhma = { ...ryhmanTiedot(etuliite, (n) => toistuvatPaa.has(n)), alaryhmat: [] };
      ryhmat.push(ryhma);
    }
    ryhma.tilit.push(t);
    const alaEtuliite = tilinEtuliite(t.numero, 2);
    let ala = ryhma.alaryhmat.at(-1);
    if (ala?.etuliite !== alaEtuliite) {
      const paaNimi = ryhma.nimi;
      ala = ryhmanTiedot(alaEtuliite, (n) => toistuvatAla.has(n) || n === paaNimi);
      ryhma.alaryhmat.push(ala);
    }
    ala.tilit.push(t);
  }
  return ryhmat;
}

/** Kaikkien ryhmien ja alaryhmien etuliitteet ("Sulje kaikki"). */
export function ryhmienEtuliitteet(ryhmat: readonly TiliRyhma[]): string[] {
  return ryhmat.flatMap((r) => [r.etuliite, ...r.alaryhmat.map((a) => a.etuliite)]);
}

/** Tilin rivin sisältävien ryhmien etuliitteet: 1910 → ["1", "19"]. */
export function tilinRyhmat(numero: number): string[] {
  return [tilinEtuliite(numero, 1), tilinEtuliite(numero, 2)];
}

/**
 * Kuuluuko tili rajaukseen: `tili` tarkka numero, `tiliryhma` etuliite (pääkirja tilikartan
 * ryhmästä). Ilman rajausta kaikki tilit kuuluvat.
 */
export function tiliRajauksessa(
  numero: number,
  rajaus: { tili?: number | undefined; tiliryhma?: string | undefined },
): boolean {
  if (rajaus.tili !== undefined) return numero === rajaus.tili;
  if (rajaus.tiliryhma !== undefined) return String(numero).startsWith(rajaus.tiliryhma);
  return true;
}

/** Numerohaku on etuliite, tekstihaku osajono (kirjainkoosta riippumatta); tyhjä haku täsmää aina. */
export function tasmaaTiliHakuun(numero: number, nimi: string, haku: string): boolean {
  const q = haku.trim();
  if (q === '') return true;
  return /^\d+$/.test(q)
    ? String(numero).startsWith(q)
    : nimi.toLowerCase().includes(q.toLowerCase());
}

/**
 * Tilien käyttö valitulla ja sitä edeltävällä tilikaudella. Avain alkaa 'viennit', joten
 * tositteen tallennus (joka mitätöi ['viennit']) päivittää myös tämän.
 */
export function useTilienKaytto(valinta: Pick<ValittuTilikausi, 'kausi' | 'kaudet'>) {
  const client = useKpClient();
  const { data: init } = useInit();
  const { kausi, kaudet } = valinta;
  const vali = useMemo(
    () => (init ? kayttovali(kaudet, kausi?.alkaa) : null),
    [init, kaudet, kausi],
  );
  const kysely = useQuery({
    queryKey: ['viennit', 'kaytto', vali] as const,
    queryFn: async () =>
      vali ? kokoaTilienKaytto(await client.listaaViennit(vali)) : new Map<number, TilinKaytto>(),
    enabled: init !== undefined,
  });
  return kysely.data;
}

export interface TilienSaldot {
  /** Tilikauden lopun saldo (haeSaldot: tase kertyvänä, tuloslaskelma kaudelta). */
  saldot: ReadonlyMap<number, Cents>;
  /** Vientien lukumäärä valitulla tilikaudella. */
  maarat: ReadonlyMap<number, number>;
}

/** Kulutili (D…): kirjaukset ovat debet-puolella, joten saldo näytetään positiivisena. */
function onKulutili(tili: Tili): boolean {
  return tili.tyyppiKoodi.startsWith('D');
}

/**
 * Saldo luonnollisella etumerkillä. haeSaldot palauttaa vastaavaa debet-positiivisena ja muut
 * kredit-positiivisina, jolloin kulut olisivat negatiivisia; ne käännetään, jotta
 * "Henkilöstökulut 12 000 €" on positiivinen kuten raporteissa.
 */
export function naytettavaSaldo(tili: Tili, saldot: ReadonlyMap<number, Cents>): Cents {
  const s = saldot.get(tili.numero) ?? 0;
  return (onKulutili(tili) ? -s || 0 : s) as Cents;
}

/**
 * Ryhmän saldo: summa haeSaldotin etumerkein, käännettynä jos ryhmän tileistä enemmistö on
 * kulutilejä. Näin oikaisuerät (esim. 4270 Saadut vahingonkorvaukset) pienentävät kuluryhmää
 * eivätkä kasvata sitä.
 */
export function ryhmanSaldo(tilit: readonly Tili[], saldot: ReadonlyMap<number, Cents>): Cents {
  let summa = 0;
  let kuluja = 0;
  for (const t of tilit) {
    summa += saldot.get(t.numero) ?? 0;
    if (onKulutili(t)) kuluja += 1;
  }
  return (kuluja * 2 > tilit.length ? -summa || 0 : summa) as Cents;
}

/** Onko tilillä tapahtumia: vientejä valitulla kaudella tai saldo (esim. pankkitili). */
export function onTapahtumia(numero: number, { saldot, maarat }: TilienSaldot): boolean {
  return (maarat.get(numero) ?? 0) > 0 || (saldot.get(numero) ?? 0) !== 0;
}

/**
 * Valitun tilikauden saldot ja vientimäärät tilikarttaan. Saldojen avain on sama kuin
 * kojelaudalla ({ pvm: kauden loppu }); vientien avain alkaa 'viennit', joten tositteen
 * tallennus päivittää molemmat.
 */
export function useTilienSaldot(kausi: Tilikausi | undefined): TilienSaldot | undefined {
  const client = useKpClient();
  const { data: saldot } = useSaldot({ pvm: kausi?.loppuu ?? '' }, kausi !== undefined);
  const { data: maarat } = useQuery({
    queryKey: ['viennit', 'maarat', kausi?.alkaa, kausi?.loppuu] as const,
    queryFn: async () => {
      const viennit = kausi
        ? await client.listaaViennit({ alkupvm: kausi.alkaa, loppupvm: kausi.loppuu })
        : [];
      return new Map([...kokoaTilienKaytto(viennit)].map(([tili, k]) => [tili, k.maara]));
    },
    enabled: kausi !== undefined,
  });
  return useMemo(() => (saldot && maarat ? { saldot, maarat } : undefined), [saldot, maarat]);
}

/** Haku: tilin syvin kattava otsikko (tilin selitteen varalle). Välit lasketaan kerran. */
export function lahinOtsikko(kartta: readonly Tili[]): (numero: number) => Tili | undefined {
  const valit = otsikkoValit(kartta);
  return (numero) => {
    const y = ysiluku(numero);
    let syvin: OtsikkoVali | undefined;
    for (const v of valit) {
      if (v.alku > y) break;
      if (y < v.loppu && (!syvin || v.otsikko.otsikkotaso >= syvin.otsikko.otsikkotaso)) syvin = v;
    }
    return syvin?.otsikko;
  };
}
