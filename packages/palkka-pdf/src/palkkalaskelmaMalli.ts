import type { IsoDate, PalkkaAjo, PalkkaHenkilo, PalkkaLaji, PalkkaRivi } from '@penni/engine';
import { type Cents, muotoileEuro, muotoilePvm } from '@penni/euro';
import { type Tyontekija, syntymapaiva } from '@penni/palkat';

/**
 * Palkkalaskelman malli: kaikki arvot valmiiksi muotoiltuja merkkijonoja, joten PDF-piirtäjä
 * ei laske mitään. Malli ei koskaan sisällä koko henkilötunnusta, vain syntymäajan.
 */

export type PalkkalaskelmaRyhma = 'palkka' | 'edut' | 'verovapaat' | 'vahennykset';

export interface PalkkalaskelmaRivi {
  selite: string;
  maara?: string;
  ahinta?: string;
  summa: string;
  ryhma: PalkkalaskelmaRyhma;
}

export interface PalkkalaskelmaMalli {
  tyonantaja: { nimi: string; ytunnus: string };
  tyontekija: {
    nimi: string;
    /** 'pp.kk.vvvv'; henkilötunnuksen muita osia ei viedä malliin. */
    syntymaaika: string;
    osoite?: string[];
    iban?: string;
  };
  kausi: string;
  maksupaiva: string;
  rivit: PalkkalaskelmaRivi[];
  /** Esim. "20,0 % (tuloraja 30 000,00 €, kertymä 3 020,00 €)". */
  pidatys: string;
  nettopalkka: string;
  vuodenAlusta: { brutto: string; ennakonpidatys: string; netto: string };
}

export interface PalkkalaskelmaLahtotiedot {
  henkilo: PalkkaHenkilo;
  ajo: PalkkaAjo;
  maksupaiva: IsoDate;
  tyontekija: Tyontekija;
  tyonantaja: { nimi: string; ytunnus: string };
  /** Vuoden alun kertymät, tämä maksu mukaan lukien. */
  vuodenAlusta: { brutto: Cents; ennakonpidatys: Cents; netto: Cents };
}

const NBSP = '\u00a0';

interface LajiTieto {
  ryhma: Exclude<PalkkalaskelmaRyhma, 'vahennykset'>;
  /** Määrän yksikkö (tunnit, km, päivät, kappaleet). */
  yksikko?: string;
  /** Luontoisetu: ei makseta rahana. */
  etu?: true;
}

const LAJIT: Record<PalkkaLaji, LajiTieto> = {
  kuukausipalkka: { ryhma: 'palkka' },
  tuntipalkka: { ryhma: 'palkka', yksikko: 'h' },
  lisa: { ryhma: 'palkka' },
  puhelinetu: { ryhma: 'edut', etu: true },
  ravintoetu: { ryhma: 'edut', yksikko: 'kpl', etu: true },
  km: { ryhma: 'verovapaat', yksikko: 'km' },
  kokopaivaraha: { ryhma: 'verovapaat', yksikko: 'pv' },
  osapaivaraha: { ryhma: 'verovapaat', yksikko: 'pv' },
  ateriakorvaus: { ryhma: 'verovapaat', yksikko: 'kpl' },
  kulukorvaus: { ryhma: 'verovapaat' },
};

const RYHMAJARJESTYS: PalkkalaskelmaRyhma[] = ['palkka', 'edut', 'verovapaat', 'vahennykset'];

/** Kokonaisluku tuhaterotettuna: 1234 -> "1 234". */
const ryhmittele = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/** Sadasosina annettu määrä: 3750 -> "37,5", 10000 -> "100". */
function muotoileMaara(sadasosat: number): string {
  const neg = sadasosat < 0 ? '−' : '';
  const abs = Math.abs(sadasosat);
  const kokonaiset = ryhmittele(Math.trunc(abs / 100));
  const desimaalit = String(abs % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${neg}${kokonaiset}${desimaalit === '' ? '' : `,${desimaalit}`}`;
}

/** Peruspisteet -> prosentti vähintään yhdellä desimaalilla: 2000 -> "20,0", 3125 -> "31,25". */
function prosentti(bp: number): string {
  const s = (bp / 100).toFixed(2).replace('.', ',');
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

/** Peruspisteet -> prosentti kahdella desimaalilla: 730 -> "7,30". */
const prosentti2 = (bp: number): string => (bp / 100).toFixed(2).replace('.', ',');

/** Kokonaisluvun jako sentteinä (summa × 100 / määrä), lähimpään senttiin. */
const yksikkoHinta = (summa: number, sadasosat: number): Cents =>
  Math.round((summa * 100) / sadasosat) as Cents;

function ajoRivi(r: PalkkaRivi): PalkkalaskelmaRivi {
  const tieto = LAJIT[r.laji];
  const rivi: PalkkalaskelmaRivi = {
    selite: tieto.etu ? `${r.selite} (ei makseta rahana)` : r.selite,
    summa: muotoileEuro(r.summa),
    ryhma: tieto.ryhma,
  };
  if (r.maara !== undefined && r.maara !== 0) {
    rivi.maara = tieto.yksikko
      ? `${muotoileMaara(r.maara)}${NBSP}${tieto.yksikko}`
      : muotoileMaara(r.maara);
    // Ravintoedun ahinta on työnantajan ateriakustannus, ei verotettava arvo: näytetään
    // arvo/ateria, jotta määrä × a-hinta = rivin summa.
    const hinta =
      r.laji !== 'ravintoetu' && r.ahinta !== undefined ? r.ahinta : yksikkoHinta(r.summa, r.maara);
    rivi.ahinta = muotoileEuro(hinta);
  }
  return rivi;
}

function pidatysSelite(h: PalkkaHenkilo): string {
  const osat = h.tulos.pidatysOsat;
  const kortti = h.verokortti;
  if (kortti === null && osat.length === 0) return 'Ei ennakonpidätystä';
  const kortinTiedot = kortti
    ? ` (tuloraja ${muotoileEuro(kortti.tuloraja)}, kertymä ${muotoileEuro(h.tulos.kertymaJalkeen)})`
    : '';
  if (osat.length === 0) return `Ei ennakonpidätystä${kortinTiedot}`;
  if (kortti === null) {
    return `${osat.map((o) => `${prosentti(o.bp)} %`).join(' + ')} (ei verokorttia)`;
  }
  const osaTeksti =
    osat.length === 1
      ? `${prosentti(osat[0]?.bp ?? 0)} %`
      : osat.map((o) => `${prosentti(o.bp)} % perusteesta ${muotoileEuro(o.peruste)}`).join(' + ');
  const tammikuu = kortti.tammikuuSaanto ? '; edellisen vuoden verokortti (tammikuu)' : '';
  return `${osaTeksti}${kortinTiedot}${tammikuu}`;
}

/** 'FI2112345600000785' -> 'FI21 1234 5600 0007 85'. */
const ryhmitteleIban = (iban: string): string =>
  iban
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();

/** ISO-päivä -> 'pp.kk.vvvv' (ei erota henkilötunnuksen muita osia). */
function syntymaaikaTekstina(t: Tyontekija): string {
  const iso = syntymapaiva(t.hetu);
  if (iso === null) throw new Error('Palkkalaskelma: työntekijän henkilötunnus on virheellinen');
  const [v, k, p] = iso.split('-');
  return `${p}.${k}.${v}`;
}

export function palkkalaskelmaMalli(p: PalkkalaskelmaLahtotiedot): PalkkalaskelmaMalli {
  const { henkilo: h, ajo, tyontekija: t } = p;
  const rivit: PalkkalaskelmaRivi[] = h.rivit.map(ajoRivi);

  const vahennys = (selite: string, sentit: Cents) => {
    if (sentit !== 0) {
      rivit.push({ selite, summa: muotoileEuro(-sentit as Cents), ryhma: 'vahennykset' });
    }
  };
  vahennys('Ennakonpidätys', h.tulos.ennakonpidatys);
  vahennys(
    `Työntekijän TyEL-maksu ${prosentti2(h.prosentit.tyelTyontekijaBp)} %`,
    h.tulos.tyelTyontekija,
  );
  vahennys(
    `Työntekijän työttömyysvakuutusmaksu ${prosentti2(h.prosentit.tvrTyontekijaBp)} %`,
    h.tulos.tvrTyontekija,
  );

  // Vakaa ryhmäjärjestys; ryhmän sisällä rivien alkuperäinen järjestys.
  rivit.sort((a, b) => RYHMAJARJESTYS.indexOf(a.ryhma) - RYHMAJARJESTYS.indexOf(b.ryhma));

  const tyontekija: PalkkalaskelmaMalli['tyontekija'] = {
    nimi: t.nimi,
    syntymaaika: syntymaaikaTekstina(t),
  };
  if (t.osoite) {
    tyontekija.osoite = [t.osoite.katu, `${t.osoite.postinumero} ${t.osoite.kaupunki}`];
  }
  if (t.iban) tyontekija.iban = ryhmitteleIban(t.iban);

  return {
    tyonantaja: { nimi: p.tyonantaja.nimi, ytunnus: p.tyonantaja.ytunnus },
    tyontekija,
    kausi: `${muotoilePvm(ajo.kausiAlkaa)} – ${muotoilePvm(ajo.kausiLoppuu)}`,
    maksupaiva: muotoilePvm(p.maksupaiva),
    rivit,
    pidatys: pidatysSelite(h),
    nettopalkka: muotoileEuro(h.tulos.nettopalkka),
    vuodenAlusta: {
      brutto: muotoileEuro(p.vuodenAlusta.brutto),
      ennakonpidatys: muotoileEuro(p.vuodenAlusta.ennakonpidatys),
      netto: muotoileEuro(p.vuodenAlusta.netto),
    },
  };
}

/** 'palkkalaskelma-<sukunimi ascii-pienaakkosin>-<pvm>.pdf'; sukunimi on nimen ensimmäinen sana. */
export function palkkalaskelmanNimi(nimi: string, maksupaiva: IsoDate): string {
  const sukunimi =
    (nimi.trim().split(/\s+/)[0] ?? '')
      .toLowerCase()
      .replace(/[äå]/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/[^a-z0-9]/g, '') || 'tyontekija';
  return `palkkalaskelma-${sukunimi}-${maksupaiva}.pdf`;
}
