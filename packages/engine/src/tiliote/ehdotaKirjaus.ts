import { Luonne, onko } from '../accounts/luonne.js';
import { type Tili, nimi as tilinNimi } from '../accounts/tili.js';
import type { IsoDate, Tosite, TositeVienti } from '../vouchers/types.js';
import { merkitsevatSanat, normalisoiNimi } from './nimi.js';
import type { Tilitapahtuma } from './poimiTiliote.js';

/** Rahan suunta pankkitilin näkökulmasta. */
export type Rahavirta = 'sisaan' | 'ulos';

/** Mistä ehdotus päätellään: aiempi sama pankkinimi, nimen sanatäsmäys, omistajan liike. */
export type EhdotuksenPeruste = 'pankkinimi' | 'nimi' | 'omistaja';

/** Ehdotettu kirjaus pankkitapahtumalle (vastatili + ALV). */
export interface KirjausEhdotus {
  tili: number;
  alvKoodi: number;
  alvProsentti: number;
  /** Aiemman vastaavan tositteen otsikko, jos sellainen oli. */
  otsikko?: string;
  /** Tositteen id, josta ehdotus opittiin. */
  lahdeTosite?: number;
  /** Lähdetositteen kumppani: toistuva tapahtuma kirjataan samalle kumppanille. */
  kumppani?: number;
  peruste: EhdotuksenPeruste;
}

/** Historian tosite: tallennettu tai tallentamaton (id valinnainen). */
export type HistoriaTosite = Tosite & { id?: number };

interface Merkinta {
  /** Normalisoidut nimet: pankkivientin selite (pankin nimi), otsikko, kumppani. */
  nimet: string[];
  /** Normalisoitu pankkinimi (pankkivientin selite), jos sellainen on. */
  pankkinimi?: string;
  sanat: Set<string>;
  /** Kunkin nimen ensimmäinen merkitsevä sana. */
  ensimmaiset: Set<string>;
  suunta: Rahavirta;
  tili: number;
  alvKoodi: number;
  alvProsentti: number;
  otsikko?: string;
  kumppani?: number;
  /** Pankkiliikkeen suuruus sentteinä (ilman pankkivientiä tositteen debet-puolen summa). */
  summa: number;
  pvm: IsoDate;
  id?: number;
}

/** Kirjaushistoriasta opittu muisti; `ehdotaKirjaus` hakee siitä. */
export interface Kirjausmuisti {
  merkinnat: readonly Merkinta[];
  chart: readonly Tili[];
}

export interface OppimisOptiot {
  /** Kumppanien nimet id:n mukaan (tositteen `kumppani`-kentälle). */
  kumppanit?: ReadonlyMap<number, string>;
}

const onRahatili = (t: Tili | undefined): boolean =>
  t !== undefined && onko(t.luonne, Luonne.RAHAVARAT);
const onAlvTili = (t: Tili | undefined): boolean =>
  t !== undefined &&
  (onko(t.luonne, Luonne.ALVSAATAVA) ||
    onko(t.luonne, Luonne.ALVVELKA) ||
    onko(t.luonne, Luonne.KOHDENTAMATONALVSAATAVA) ||
    onko(t.luonne, Luonne.KOHDENTAMATONALVVELKA));

const summa = (v: TositeVienti): number => v.debet + v.kredit;

/**
 * Tositteen "perusvienti": vastatili, jolle raha kirjattiin. Ohitetaan rahatilit ja ALV-viennit
 * (alv-koodi >= 100 tai ALV-tili). Tulostilit ennen tasetilejä, sitten suurin summa.
 */
function perusvienti(
  viennit: readonly TositeVienti[],
  tilit: Map<number, Tili>,
): TositeVienti | undefined {
  const ehdokkaat = viennit.filter((v) => {
    const t = tilit.get(v.tili);
    return !onRahatili(t) && !onAlvTili(t) && v.alvKoodi < 100 && summa(v) > 0;
  });
  const tulosta = (v: TositeVienti): number => {
    const t = tilit.get(v.tili);
    return t !== undefined && onko(t.luonne, Luonne.TULOS) ? 1 : 0;
  };
  return [...ehdokkaat].sort((a, b) => tulosta(b) - tulosta(a) || summa(b) - summa(a))[0];
}

/**
 * Oppii kirjaushistoriasta vastapuolikohtaiset kirjaukset: kullekin tositteelle sen nimet
 * (pankkivientin selite = pankin tapahtumanimi, otsikko, kumppani), rahan suunta ja vastatili
 * ALV-koodeineen. Puhdas funktio.
 */
export function opiKirjaushistoriasta(
  tositteet: readonly HistoriaTosite[],
  chart: readonly Tili[],
  optiot: OppimisOptiot = {},
): Kirjausmuisti {
  const tilit = new Map(chart.map((t) => [t.numero, t]));
  const merkinnat: Merkinta[] = [];
  for (const t of tositteet) {
    const perus = perusvienti(t.viennit, tilit);
    if (!perus) continue;
    const rahaviennit = t.viennit.filter((v) => onRahatili(tilit.get(v.tili)));
    const rahaa = rahaviennit.reduce((s, v) => s + v.debet - v.kredit, 0);
    // Suunta pankkiviennistä; ilman sitä perusviennin puolesta (debet = kulu = raha ulos).
    const suunta: Rahavirta =
      rahaviennit.length > 0
        ? rahaa >= 0
          ? 'sisaan'
          : 'ulos'
        : perus.debet > 0
          ? 'ulos'
          : 'sisaan';
    const pankkiselite = rahaviennit.find((v) => v.selite)?.selite;
    const raakaNimet = [
      pankkiselite,
      t.otsikko,
      t.kumppani !== undefined ? optiot.kumppanit?.get(t.kumppani) : undefined,
    ].filter((x): x is string => x !== undefined && x.trim() !== '');
    if (raakaNimet.length === 0) continue;
    const nimet = raakaNimet.map(normalisoiNimi);
    const sanat = new Set(raakaNimet.flatMap(merkitsevatSanat));
    const ensimmaiset = new Set(
      raakaNimet.map((n) => merkitsevatSanat(n)[0]).filter((x): x is string => x !== undefined),
    );
    const m: Merkinta = {
      nimet,
      sanat,
      ensimmaiset,
      suunta,
      tili: perus.tili,
      alvKoodi: perus.alvKoodi,
      alvProsentti: perus.alvProsentti,
      summa: rahaviennit.length > 0 ? Math.abs(rahaa) : t.viennit.reduce((s, v) => s + v.debet, 0),
      pvm: t.pvm,
    };
    if (pankkiselite) m.pankkinimi = normalisoiNimi(pankkiselite);
    if (t.otsikko) m.otsikko = t.otsikko;
    if (t.kumppani !== undefined) m.kumppani = t.kumppani;
    if (t.id !== undefined) m.id = t.id;
    merkinnat.push(m);
  }
  return { merkinnat, chart };
}

/**
 * Täsmäyksen laatu: 4 = sama pankkinimi, 3 = sama nimi (otsikko/kumppani), 2 = ensimmäinen
 * merkitsevä sana yhteinen, 1 = jokin merkitsevä sana yhteinen, 0 = ei täsmää.
 */
function laatu(m: Merkinta, nimi: string, sanat: readonly string[]): number {
  if (m.pankkinimi !== undefined && m.pankkinimi === nimi) return 4;
  if (m.nimet.includes(nimi)) return 3;
  const eka = sanat[0];
  if ((eka !== undefined && m.sanat.has(eka)) || sanat.some((s) => m.ensimmaiset.has(s))) return 2;
  if (sanat.some((s) => m.sanat.has(s))) return 1;
  return 0;
}

export interface EhdotusOptiot {
  /** Omistajan nimen osat; omistajan liikkeille ehdotetaan yksityistiliä, jos historiaa ei ole. */
  omistajanNimet?: readonly string[];
}

/** Onko tapahtuma omistajan liike (jokin nimen osa esiintyy normalisoidussa nimessä sanana). */
export function onkoOmistajanLiike(nimi: string, omistajanNimet: readonly string[]): boolean {
  const sanat = new Set(normalisoiNimi(nimi).split(' '));
  return omistajanNimet
    .map(normalisoiNimi)
    .filter((o) => o.length >= 3)
    .some((o) => o.split(' ').every((osa) => sanat.has(osa)));
}

/**
 * Yksityistili tilikartasta nimen perusteella (Yksityisnostot / Yksityissijoitukset). Kartassa
 * voi olla useita (esim. yhtymän "yhtiömies A/B" -tilit): valitaan se, jota kirjaushistoria
 * käyttää eniten, ja vasta ilman historiaa kartan ensimmäinen.
 */
function yksityistili(muisti: Kirjausmuisti, suunta: Rahavirta): Tili | undefined {
  const hae = suunta === 'ulos' ? /yksityisnost/i : /yksityissijoitu/i;
  const ehdokkaat = muisti.chart.filter((t) => t.otsikkotaso === 0 && hae.test(tilinNimi(t)));
  const kaytto = new Map<number, number>();
  for (const m of muisti.merkinnat) kaytto.set(m.tili, (kaytto.get(m.tili) ?? 0) + 1);
  let paras = ehdokkaat[0];
  for (const t of ehdokkaat)
    if ((kaytto.get(t.numero) ?? 0) > (paras ? (kaytto.get(paras.numero) ?? 0) : 0)) paras = t;
  return paras;
}

/**
 * Summien samankaltaisuus järjestämistä varten (ei rahalaskentaa): 0 = lähes sama summa
 * (ero enintään 1 % tai 1 snt), muuten 1 + kertaluokan ero kakkosen potensseina, jolloin
 * saman suuruusluokan kirjaukset ovat keskenään tasoissa ja uusin ratkaisee.
 */
function summaluokka(a: number, b: number): number {
  const ero = Math.abs(a - b);
  const suurempi = Math.max(a, b);
  if (ero <= 1 || ero * 100 <= suurempi) return 0;
  const pienempi = Math.min(a, b);
  if (pienempi <= 0) return Number.MAX_SAFE_INTEGER;
  return 1 + Math.floor(Math.abs(Math.log2(suurempi / pienempi)));
}

const KUUKAUDET = [
  'tammi',
  'helmi',
  'maalis',
  'huhti',
  'touko',
  'kesä',
  'heinä',
  'elo',
  'syys',
  'loka',
  'marras',
  'joulu',
] as const;
const KUUKAUSI_RE = new RegExp(
  `(?<!\\p{L})(${KUUKAUDET.join('|')})(kuu\\p{L}*)(\\s+(?:19|20)\\d{2}(?!\\d))?`,
  'giu',
);
/** Lopun laskuviite: "(lasku 412)", "lasku nro 1234", "[invoice #12]". */
const LASKUVIITE_RE =
  /(?:^|[\s,;:–-]+)[([]?\s*(?:lasku|laskunro|invoice|inv)\.?\s*(?:nro|no|n:o|#)?\.?\s*:?\s*#?[\w/-]*\d[\w/-]*\s*[)\]]?\s*$/iu;

/** Sana samaan kirjainkokoon kuin malli (KAIKKI ISOT / Iso alkukirjain / pienet). */
function kirjainkoko(sana: string, malli: string): string {
  if (malli === malli.toUpperCase() && malli !== malli.toLowerCase()) return sana.toUpperCase();
  const eka = malli.charAt(0);
  if (eka === eka.toUpperCase() && eka !== eka.toLowerCase())
    return sana.charAt(0).toUpperCase() + sana.slice(1);
  return sana;
}

/**
 * Aiemman tositteen otsikko uudelle tapahtumalle: suomenkielinen kuukauden nimi (missä
 * tahansa taivutuksessa, esim. "elokuun") vaihdetaan tapahtumapäivän kuukaudeksi ja sen perässä
 * oleva vuosiluku tapahtuman vuodeksi; lopun laskuviite ("(lasku 412)") poistetaan, koska
 * vanha laskunumero ei koskaan päde uuteen maksuun.
 */
export function paivitaOtsikko(otsikko: string, pvm: IsoDate): string {
  const kk = Number(pvm.slice(5, 7));
  const uusi = KUUKAUDET[kk - 1];
  const vuosi = pvm.slice(0, 4);
  let tulos = otsikko;
  if (uusi !== undefined)
    tulos = tulos.replace(
      KUUKAUSI_RE,
      (_m, vanha: string, loppu: string, vanhaVuosi: string | undefined) =>
        `${kirjainkoko(uusi, vanha)}${kirjainkoko(loppu, loppu)}${
          vanhaVuosi !== undefined ? vanhaVuosi.replace(/\d{4}/, vuosi) : ''
        }`,
    );
  const ilmanViitetta = tulos.replace(LASKUVIITE_RE, '').trim();
  return ilmanViitetta !== '' ? ilmanViitetta : tulos.trim();
}

/**
 * Ehdottaa pankkitapahtumalle vastatiliä ja ALV-käsittelyä kirjaushistorian perusteella.
 * Vain saman rahan suunnan (sisään/ulos) kirjaukset kelpaavat. Paras täsmäys voittaa
 * (sama pankkinimi > sama nimi > ensimmäinen merkitsevä sana > mikä tahansa yhteinen sana),
 * tasatilanteessa lähin summa (lähes sama summa vahvimmin, sitten suuruusluokka) ja sitten
 * uusin tosite — saman vastapuolen eri maksulajit (esim. verottajan ennakkovero vs.
 * viivästysseuraamus) erottuvat summasta. Ilman historiaa omistajan liikkeelle ehdotetaan yksityistiliä.
 */
export function ehdotaKirjaus(
  muisti: Kirjausmuisti,
  tapahtuma: Tilitapahtuma,
  optiot: EhdotusOptiot = {},
): KirjausEhdotus | undefined {
  const suunta: Rahavirta = tapahtuma.maara < 0 ? 'ulos' : 'sisaan';
  const nimi = normalisoiNimi(tapahtuma.nimi);
  const sanat = merkitsevatSanat(tapahtuma.nimi);
  const maara = Math.abs(tapahtuma.maara);
  let paras: { m: Merkinta; laatu: number; summaluokka: number } | undefined;
  for (const m of muisti.merkinnat) {
    if (m.suunta !== suunta) continue;
    const l = laatu(m, nimi, sanat);
    if (l === 0) continue;
    const sl = summaluokka(m.summa, maara);
    if (
      !paras ||
      l > paras.laatu ||
      (l === paras.laatu &&
        (sl < paras.summaluokka ||
          (sl === paras.summaluokka &&
            (m.pvm > paras.m.pvm || (m.pvm === paras.m.pvm && (m.id ?? 0) > (paras.m.id ?? 0))))))
    )
      paras = { m, laatu: l, summaluokka: sl };
  }
  if (paras) {
    const e: KirjausEhdotus = {
      tili: paras.m.tili,
      alvKoodi: paras.m.alvKoodi,
      alvProsentti: paras.m.alvProsentti,
      peruste: paras.laatu >= 4 ? 'pankkinimi' : 'nimi',
    };
    if (paras.m.otsikko) e.otsikko = paivitaOtsikko(paras.m.otsikko, tapahtuma.pvm);
    if (paras.m.id !== undefined) e.lahdeTosite = paras.m.id;
    if (paras.m.kumppani !== undefined) e.kumppani = paras.m.kumppani;
    return e;
  }
  if (optiot.omistajanNimet && onkoOmistajanLiike(tapahtuma.nimi, optiot.omistajanNimet)) {
    const tili = yksityistili(muisti, suunta);
    if (tili) return { tili: tili.numero, alvKoodi: 0, alvProsentti: 0, peruste: 'omistaja' };
  }
  return undefined;
}
