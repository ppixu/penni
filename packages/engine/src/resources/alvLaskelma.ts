import { type Cents, muotoileEuro, roundHalfAway } from '@penni/euro';
import { Luonne, type LuonneArvo } from '../accounts/luonne.js';
import { type Tili, nimi, tiliTyypilla } from '../accounts/tili.js';
import { AlvKoodi, TILITYS, alvKoodilla, debetistaKoodilla, palautuskoodi } from '../alv/koodit.js';
import { TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import type { IsoDate, TositeVienti } from '../vouchers/types.js';
import { type ResourceEnv, ResourceError, type Storage, type StoredTosite } from './storage.js';
import { tallennaTosite } from './tositeResource.js';

export interface AlvLaskelmaParams {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
}

export interface AlvLaskelmaTulos {
  alkupvm: IsoDate;
  loppupvm: IsoDate;
  /** veroilmoituksen koodi -> määrä sentteinä; vain nollasta poikkeavat koodit mukana. */
  koodit: Map<number, Cents>;
  /** = koodi 308 = vero - vähennys (positiivinen maksettava, negatiivinen palautus). */
  maksettava: Cents;
}

export type AlvTilitysSyote = AlvLaskelmaParams;

/**
 * Yhden (alv-koodi, verokanta, tili) -ryhmän bruttokirjausten oikaisu. Bruttokirjauksessa
 * (koodit 12/22) koko verollinen summa kirjataan tulo-/menotilille ilman erillistä
 * alv-vientiä; sisältyvä vero erotetaan vasta alv-tilityksessä.
 */
export interface BruttoOikaisu {
  /** AlvKoodi.MYYNNIT_BRUTTO (12) tai AlvKoodi.OSTOT_BRUTTO (22). */
  alvKoodi: number;
  tili: number;
  /** Verokanta prosentin sadasosina (25,5 % -> 2550), kuten Kitsaksen KoodiTaulu-avain. */
  kanta: number;
  /** Ryhmän bruttosumma koodin luonnolliselta puolelta (myynti kredit−debet, osto debet−kredit). */
  brutto: Cents;
  netto: Cents;
  /** = brutto − netto; negatiivinen esim. hyvityksillä. */
  vero: Cents;
}

/**
 * Kauden bruttokirjausten oikaisut. Port of AlvLaskelma::oikaiseBruttoKirjaukset
 * (kitsas/alv/alvlaskelma.cpp:1014-1103): viennit ryhmitellään koodin, verokannan
 * (qRound(alvprosentti*100), KoodiTaulu::lisaa :1151) ja tilin mukaan, ryhmän brutto
 * summataan ja vasta SUMMASTA lasketaan netto = qRound64(brutto * 10000 / (10000 + kanta))
 * (:1028, :1072) ja vero = brutto − netto — yksi pyöristys tiliä ja kantaa kohden, ei
 * tositteittain. Järjestys kuten Kitsaksen QMap-iteraatio: myynnit ennen ostoja, kanta ja
 * tili nousevasti. BRUTTOOIKAISU-viennit (aiemman tilityksen omat oikaisut) ohitetaan —
 * Kitsas ohittaa ne jättämällä ALVLASKELMA-tositteet pois summauksesta (:707).
 */
export function laskeBruttoOikaisut(viennit: readonly TositeVienti[]): BruttoOikaisu[] {
  const ryhmat = new Map<
    string,
    { alvKoodi: number; kanta: number; tili: number; brutto: number }
  >();
  for (const v of viennit) {
    if (v.alvKoodi !== AlvKoodi.MYYNNIT_BRUTTO && v.alvKoodi !== AlvKoodi.OSTOT_BRUTTO) continue;
    if (v.tyyppi === VientiTyyppi.BRUTTOOIKAISU) continue;
    const kanta = Math.round(v.alvProsentti * 100);
    const avain = `${v.alvKoodi}:${kanta}:${v.tili}`;
    const ryhma = ryhmat.get(avain) ?? { alvKoodi: v.alvKoodi, kanta, tili: v.tili, brutto: 0 };
    ryhma.brutto += debetistaKoodilla(v.alvKoodi) ? v.debet - v.kredit : v.kredit - v.debet;
    ryhmat.set(avain, ryhma);
  }
  return [...ryhmat.values()]
    .sort((a, b) => a.alvKoodi - b.alvKoodi || a.kanta - b.kanta || a.tili - b.tili)
    .map((r) => {
      // Kokonaislukujen jakolasku on IEEE-tarkasti pyöristetty, eikä tarkkaa puolikasta voi
      // syntyä voimassa olevilla kannoilla (2400/2550/1350/1400/1000), joten tulos == qRound64.
      const netto = roundHalfAway((r.brutto * 10000) / (10000 + r.kanta));
      return {
        alvKoodi: r.alvKoodi,
        tili: r.tili,
        kanta: r.kanta,
        brutto: r.brutto as Cents,
        netto: netto as Cents,
        vero: (r.brutto - netto) as Cents,
      };
    });
}

/** Oikaisun alv-vientikoodi: 12 -> 112 (ALVKIRJAUS), 22 -> 222 (ALVVAHENNYS). */
export function oikaisunVerokoodi(o: BruttoOikaisu): number {
  return o.alvKoodi === AlvKoodi.MYYNNIT_BRUTTO
    ? alvKoodilla(AlvKoodi.MYYNNIT_BRUTTO, AlvKoodi.ALVKIRJAUS)
    : alvKoodilla(AlvKoodi.OSTOT_BRUTTO, AlvKoodi.ALVVAHENNYS);
}

/**
 * Bruttokirjauksen oikaisuvientien selite, verbatim alvlaskelma.cpp:1030-1031 / :1074-1075.
 * Yhteinen kirjattavalle oikaisulle (bruttoOikaisuViennit) ja alv-erittelyn oikaisuriville,
 * jotta näytetty ja kirjattu selite eivät voi erota.
 */
export function bruttoOikaisuSelite(o: BruttoOikaisu, chart: readonly Tili[]): string {
  const myynti = o.alvKoodi === AlvKoodi.MYYNNIT_BRUTTO;
  const tili = chart.find((t) => t.numero === o.tili);
  const tiliNimi = tili ? `${o.tili} ${nimi(tili)}` : String(o.tili);
  return `${myynti ? 'Bruttomyyntien' : 'Brutto-ostojen'} oikaisu ${tiliNimi} BRUTTO ${muotoileEuro(o.brutto)}, NETTO ${muotoileEuro(o.netto)}`;
}

/**
 * Kauden alv-vientien summaus: kirjatut viennit (listViennit palauttaa vain tila >= 100),
 * puoli debetistaKoodilla-säännöllä, ilmoituskoodi palautuskoodi-kuvauksella.
 * Summataan TALLENNETUT senttimäärät — ei koskaan lasketa netto × kanta uudestaan
 * (kaksoispyöristys). TILITYS-viennit (901) jäävät kaistojen ulkopuolelle.
 *
 * Bruttokirjausten (12/22) vero lasketaan laskeBruttoOikaisut-säännöllä ja summataan
 * koodeina 112/222, kuten Kitsaksen lisaaKirjausVienti (alvlaskelma.cpp:1006-1012) lisää
 * oikaisuviennit tauluun ennen yhteenvetoa (:163-165, :465-472). Tallennetut
 * BRUTTOOIKAISU-viennit ohitetaan, jottei jo tilitetyn kauden uudelleenlaskenta tuplaa
 * bruttoveroa (Kitsas: ALVLASKELMA-tositteet pois, :707).
 */
async function summaaKaudelta(
  storage: Storage,
  params: AlvLaskelmaParams,
): Promise<{
  koodit: Map<number, number>;
  vero: number;
  vahennys: number;
  oikaisut: BruttoOikaisu[];
}> {
  const viennit = await storage.listViennit({
    alkupvm: params.alkupvm,
    loppupvm: params.loppupvm,
  });
  const koodit = new Map<number, number>();
  let vero = 0;
  let vahennys = 0;
  const lisaa = (alvKoodi: number, kanta: number, sivu: number) => {
    const koodi = palautuskoodi(alvKoodi, kanta);
    if (koodi !== undefined) koodit.set(koodi, (koodit.get(koodi) ?? 0) + sivu);
    if (alvKoodi >= 100 && alvKoodi <= 199) vero += sivu;
    else if (alvKoodi >= 200 && alvKoodi <= 299) vahennys += sivu;
  };
  for (const v of viennit) {
    if (!v.alvKoodi) continue;
    if (v.tyyppi === VientiTyyppi.BRUTTOOIKAISU) continue;
    const sivu = debetistaKoodilla(v.alvKoodi) ? v.debet - v.kredit : v.kredit - v.debet;
    lisaa(v.alvKoodi, Math.round(v.alvProsentti * 100), sivu);
  }
  const oikaisut = laskeBruttoOikaisut(viennit);
  for (const o of oikaisut) lisaa(oikaisunVerokoodi(o), o.kanta, o.vero);
  return { koodit, vero, vahennys, oikaisut };
}

/** Kauden alv-laskelman esikatselu (puhdas luku — ei lukitse mitään). */
export async function haeAlvLaskelma(
  storage: Storage,
  params: AlvLaskelmaParams,
): Promise<AlvLaskelmaTulos> {
  const { koodit, vero, vahennys } = await summaaKaudelta(storage, params);
  const maksettava = (vero - vahennys) as Cents;
  koodit.set(308, maksettava);
  const tulos = new Map<number, Cents>();
  for (const [koodi, arvo] of koodit) {
    if (arvo !== 0) tulos.set(koodi, arvo as Cents);
  }
  return { alkupvm: params.alkupvm, loppupvm: params.loppupvm, koodit: tulos, maksettava };
}

/**
 * Kirjaa kauden alv-tilityksen ALVLASKELMA-tositteelle ja siirtää AlvIlmoitettu-rajan
 * kauden loppuun. Tositteelle tulevat ensin bruttokirjausten oikaisuviennit
 * (bruttoOikaisuViennit, alvlaskelma.cpp:1014-1103) ja sitten enintään kolme
 * TILITYS-vientiä (alvlaskelma.cpp:308-366, kirjaaVerot), joiden vero sisältää myös
 * bruttokirjausten veron — kuten Kitsaksessa, jossa oikaisut lisätään tauluun ennen
 * kirjaaVerot-summausta (viimeistele :876).
 * AlvIlmoitettu-rajavahti hylkää jokaisen kauden, joka ei ala AIDOSTI rajan jälkeen:
 * sekä kauden, joka on kokonaan jo ilmoitettu, että kauden, joka vain OSITTAIN menee
 * päällekkäin ilmoitetun jakson kanssa (esim. loppuu rajan jälkeen mutta alkaa ennen
 * sitä) — muuten päällekkäinen osuus tilitettäisiin uudestaan, koska tilitysviennit
 * ovat summaukselle näkymättömiä (TILITYS/BRUTTOOIKAISU) eikä PVMALV estä
 * ALVLASKELMA-tositetta.
 * Koska tositteen tallennus ja rajan siirto eivät ole sama transaktio, alempana oleva
 * listTositteet-tarkistus toimii varakeinona uusintayrityksiä/kilpa-ajoja vastaan.
 */
export async function tallennaAlvTilitys(
  storage: Storage,
  syote: AlvTilitysSyote,
  env: ResourceEnv,
): Promise<StoredTosite> {
  const asetukset = await storage.getAsetukset();
  const ilmoitettu = asetukset.AlvIlmoitettu;
  if (
    ilmoitettu != null &&
    ilmoitettu !== '' &&
    (syote.loppupvm <= ilmoitettu || syote.alkupvm <= ilmoitettu)
  )
    throw new ResourceError('JOILMOITETTU', 'Kausi on jo ilmoitettu');

  // Varakeino uusintayrityksiä/kilpa-ajoja vastaan: tositteen tallennus (tallennaTosite)
  // ja AlvIlmoitettu-rajan siirto (patchAsetukset) eivät tapahdu atomisesti, joten jos
  // patch epäonnistuu tai kaksi pyyntöä kilpailevat, uusintayritys voisi läpäistä yllä
  // olevan rajavahdin uudestaan. Jos kaudelle on jo kirjattu tilitys, torjutaan.
  const aiemmat = await storage.listTositteet({
    bucket: 'kirjanpidossa',
    tyyppi: TositeTyyppi.ALVLASKELMA,
    alkupvm: syote.alkupvm,
    loppupvm: syote.loppupvm,
  });
  if (aiemmat.length > 0)
    throw new ResourceError('JOILMOITETTU', 'Kaudelle on jo kirjattu alv-tilitys');

  const { vero, vahennys, oikaisut } = await summaaKaudelta(storage, syote);
  const myyntiOikaisuja = oikaisut.some(
    (o) => o.alvKoodi === AlvKoodi.MYYNNIT_BRUTTO && o.vero !== 0,
  );
  const ostoOikaisuja = oikaisut.some((o) => o.alvKoodi === AlvKoodi.OSTOT_BRUTTO && o.vero !== 0);
  if (vero === 0 && vahennys === 0 && !myyntiOikaisuja && !ostoOikaisuja)
    throw new ResourceError('EITILITYSTA', 'Kaudella ei ole tilitettävää arvonlisäveroa');

  const chart = await storage.getChart();
  const tiliLuonteella = (luonne: LuonneArvo, tarvitaan: boolean): number | undefined => {
    if (!tarvitaan) return undefined;
    const tili = tiliTyypilla(chart, luonne);
    if (!tili) throw new ResourceError('EIALVTILIA', 'ALV-tili puuttuu tilikartasta');
    return tili.numero;
  };
  const alvVelka = tiliLuonteella(Luonne.ALVVELKA, vero !== 0 || myyntiOikaisuja);
  const alvSaatava = tiliLuonteella(Luonne.ALVSAATAVA, vahennys !== 0 || ostoOikaisuja);
  const veroVelka = tiliLuonteella(Luonne.VEROVELKA, vero !== vahennys);

  const selite = `Arvonlisävero ${syote.alkupvm} – ${syote.loppupvm}`;
  const vienti = (tili: number, debet: number, kredit: number): TositeVienti => ({
    tili,
    debet: debet as Cents,
    kredit: kredit as Cents,
    pvm: syote.loppupvm,
    alvKoodi: TILITYS,
    alvProsentti: 0,
    tyyppi: VientiTyyppi.SIIRTO,
    selite,
  });

  // Bruttokirjausten oikaisut ensin, sitten tilitysviennit (Kitsas: viimeistele :876
  // oikaisee ennen kuin kirjaaVerot :308 summaa taulun).
  const viennit: TositeVienti[] = bruttoOikaisuViennit(oikaisut, chart, syote.loppupvm, {
    alvVelka,
    alvSaatava,
  });
  if (alvVelka !== undefined && vero !== 0)
    viennit.push(vero > 0 ? vienti(alvVelka, vero, 0) : vienti(alvVelka, 0, -vero));
  if (alvSaatava !== undefined && vahennys !== 0)
    viennit.push(vahennys > 0 ? vienti(alvSaatava, 0, vahennys) : vienti(alvSaatava, -vahennys, 0));
  if (veroVelka !== undefined)
    viennit.push(
      vero > vahennys
        ? vienti(veroVelka, 0, vero - vahennys)
        : vienti(veroVelka, vahennys - vero, 0),
    );

  const tosite = await tallennaTosite(
    storage,
    {
      pvm: syote.loppupvm,
      tyyppi: TositeTyyppi.ALVLASKELMA,
      tila: TositeTila.KIRJANPIDOSSA,
      sarja: '',
      otsikko: selite,
      viennit,
    },
    env,
  );

  await storage.patchAsetukset({ AlvIlmoitettu: syote.loppupvm });
  return tosite;
}

/**
 * Bruttokirjausten oikaisuviennit ALVLASKELMA-tositteelle, verbatim
 * AlvLaskelma::oikaiseBruttoKirjaukset (alvlaskelma.cpp:1014-1103): kultakin
 * (koodi, kanta, tili) -ryhmältä sisältyvä vero siirretään pois tulo-/menotililtä
 * (koodi 12/22) alv-velalle (112) / alv-saatavalle (222). Molemmat viennit ovat
 * VientiTyyppi.BRUTTOOIKAISU, jolloin kauden summaus ohittaa ne uudelleenlaskennassa.
 * Nollaveroiset ryhmät jätetään pois (Kitsas kirjaisi nollasummaisen vientiparin).
 */
function bruttoOikaisuViennit(
  oikaisut: readonly BruttoOikaisu[],
  chart: readonly Tili[],
  pvm: IsoDate,
  tilit: { alvVelka: number | undefined; alvSaatava: number | undefined },
): TositeVienti[] {
  /** Positiivinen summa annetulle puolelle, negatiivinen itseisarvona vastakkaiselle. */
  const puolelle = (summa: number, debetiin: boolean): { debet: Cents; kredit: Cents } => {
    const debetPuoli = debetiin === summa > 0;
    return {
      debet: (debetPuoli ? Math.abs(summa) : 0) as Cents,
      kredit: (debetPuoli ? 0 : Math.abs(summa)) as Cents,
    };
  };
  const out: TositeVienti[] = [];
  for (const o of oikaisut) {
    if (o.vero === 0) continue;
    const myynti = o.alvKoodi === AlvKoodi.MYYNNIT_BRUTTO;
    const alvTili = myynti ? tilit.alvVelka : tilit.alvSaatava;
    if (alvTili === undefined)
      throw new ResourceError('EIALVTILIA', 'ALV-tili puuttuu tilikartasta');
    const selite = bruttoOikaisuSelite(o, chart);
    const alvProsentti = o.kanta / 100;
    // Myynti: vero pois tulotililtä debetiin, alv-velalle kreditiin (:1036-1056).
    // Osto: vero pois menotililtä kreditiin, alv-saatavalle debetiin (:1080-1100).
    out.push({
      tili: o.tili,
      ...puolelle(o.vero, myynti),
      pvm,
      alvKoodi: o.alvKoodi,
      alvProsentti,
      tyyppi: VientiTyyppi.BRUTTOOIKAISU,
      selite,
    });
    out.push({
      tili: alvTili,
      ...puolelle(o.vero, !myynti),
      pvm,
      alvKoodi: oikaisunVerokoodi(o),
      alvProsentti,
      tyyppi: VientiTyyppi.BRUTTOOIKAISU,
      selite,
    });
  }
  return out;
}
