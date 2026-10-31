import { type Cents, Euro } from '@penni/euro';
import { Luonne } from '../accounts/luonne.js';
import { type Tili, tiliTyypilla } from '../accounts/tili.js';
import { type VerollinenRivi, generoiVeroviennit } from '../alv/generoiVeroviennit.js';
import { yleinenAlv } from '../alv/kannat.js';
import { AlvKoodi, veroTyyppi } from '../alv/koodit.js';
import type { Kuitti, KuittiAlvEra } from '../kuitti/kuitti.js';
import { ResourceError } from '../resources/storage.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import type { Tosite, TositeVienti } from '../vouchers/types.js';
import { normalisoiNimi } from './nimi.js';
import type { Tilitapahtuma } from './poimiTiliote.js';

const ZERO: Cents = Euro.fromCents(0);

/** Myyjäkohtainen menotilisääntö: jos `hae` esiintyy normalisoidussa myyjänimessä, käytä `tili`ä. */
export interface MenotiliSaanto {
  /** Hakusana pienaakkosin (normalisoituna); täsmää osumana myyjänimessä. */
  hae: string;
  tili: number;
}

/** Oletustilit tositteen luontiin; kukin voi tulla asetuksista tai tilikartan luonteesta. */
export interface TositeAsetukset {
  menotili?: number;
  myyntitili?: number;
  pankkitili?: number;
  /** Myyjäkohtaiset menotilisäännöt; ensimmäinen täsmäävä voittaa. */
  menotiliSaannot?: readonly MenotiliSaanto[];
}

/**
 * Päättelee menotilin myyjän nimestä sääntöjen perusteella; ensimmäinen täsmäävä voittaa,
 * muuten `oletus`. Vertailu tehdään normalisoidulla nimellä (isot/pienet, ääkköset, välimerkit).
 */
export function paatteleMenotili(
  myyja: string | undefined,
  saannot: readonly MenotiliSaanto[],
  oletus: number | undefined,
): number | undefined {
  if (myyja !== undefined) {
    const nimi = normalisoiNimi(myyja);
    for (const s of saannot) if (nimi.includes(s.hae)) return s.tili;
  }
  return oletus;
}

/** Yhden kanta-erän brutto (tai netto+vero), jos saatavilla. */
function eranBrutto(era: KuittiAlvEra): Cents | undefined {
  if (era.brutto !== undefined) return era.brutto;
  if (era.netto !== undefined && era.vero !== undefined) return Euro.add(era.netto, era.vero);
  return undefined;
}

/**
 * Kokoaa tositteen veroviennistä ja tasapainottavasta pankkiviennistä. Pankkiviennin selite
 * on pankin tapahtumanimi, jotta kirjaushistoriasta opitaan seuraavalla kerralla sama nimi.
 */
function pankillaTasapainotettu(
  tapahtuma: Tilitapahtuma,
  veroviennit: TositeVienti[],
  pankki: number,
): Tosite {
  // Pankkivienti tasapainottaa: erotus vastapuolelle.
  const ero = veroviennit.reduce((s, v) => s + v.debet - v.kredit, 0);
  const pankkiVienti: TositeVienti = {
    tili: pankki,
    debet: ero < 0 ? (Euro.fromCents(-ero) as Cents) : ZERO,
    kredit: ero > 0 ? (Euro.fromCents(ero) as Cents) : ZERO,
    pvm: tapahtuma.pvm,
    alvKoodi: AlvKoodi.EIALV,
    alvProsentti: 0,
  };
  if (tapahtuma.nimi) pankkiVienti.selite = tapahtuma.nimi;
  return {
    pvm: tapahtuma.pvm,
    tyyppi: tapahtuma.maara < 0 ? TositeTyyppi.MENO : TositeTyyppi.TULO,
    tila: TositeTila.LUONNOS,
    tunniste: 0,
    sarja: '',
    viennit: [...veroviennit, pankkiVienti],
  };
}

function pankkitili(chart: readonly Tili[], asetukset: TositeAsetukset): number {
  const pankki = asetukset.pankkitili ?? tiliTyypilla(chart, Luonne.PANKKITILI)?.numero;
  if (pankki === undefined) throw new ResourceError('EIPANKKITILIA', 'Pankkitiliä ei löydy');
  return pankki;
}

/** Vastatili + ALV-käsittely, jolla pankkitapahtuma kirjataan ilman kuittia. */
export interface KirjausValinta {
  tili: number;
  alvKoodi: number;
  alvProsentti: number;
}

/**
 * Luo pankkitapahtumasta luonnostositteen annetulla vastatilillä ja ALV-koodilla (esim.
 * kirjaushistorian ehdotus). Pankin summa on brutto: kotimaan ALV-koodeilla vero erotetaan
 * siitä (bruttoSyotto), käänteisillä koodeilla summa on veron peruste (netto) ja viennit
 * syntyvät molemmille puolille. Pankkitili tasapainottaa.
 */
export function luoTositeValinnasta(
  tapahtuma: Tilitapahtuma,
  valinta: KirjausValinta,
  chart: readonly Tili[],
  asetukset: TositeAsetukset = {},
): Tosite {
  const pankki = pankkitili(chart, asetukset);
  const kaanteinen = veroTyyppi(valinta.alvKoodi)?.kaanteinen ?? false;
  const rivi: VerollinenRivi = {
    tili: valinta.tili,
    alvKoodi: valinta.alvKoodi,
    alvProsentti: valinta.alvProsentti,
    maara: Euro.abs(tapahtuma.maara),
    bruttoSyotto: !kaanteinen,
    puoli: tapahtuma.maara < 0 ? 'debet' : 'kredit',
    pvm: tapahtuma.pvm,
  };
  const tosite = pankillaTasapainotettu(tapahtuma, generoiVeroviennit([rivi], chart), pankki);
  if (tapahtuma.viite) tosite.viite = tapahtuma.viite;
  return tosite;
}

/**
 * Luo täsmätystä parista (pankkitapahtuma + kuitti) luonnostositteen:
 * kuitin ALV-erittely generoi kulu/tulo- ja ALV-viennit (generoiVeroviennit),
 * ja pankkitili tasapainottaa loppusumman. Etumerkki ratkaisee suunnan
 * (negatiivinen = meno/osto, positiivinen = tulo/myynti).
 */
export function luoTositeMatchista(
  tapahtuma: Tilitapahtuma,
  kuitti: Kuitti,
  chart: readonly Tili[],
  asetukset: TositeAsetukset = {},
): Tosite {
  const meno = tapahtuma.maara < 0;
  const puoli: 'debet' | 'kredit' = meno ? 'debet' : 'kredit';
  const gross = Euro.abs(tapahtuma.maara);

  // Menotilin päättelyyn sekä kuitin myyjä että pankin tapahtumanimi (jälkimmäinen on usein
  // luotettavampi brändi kuin kuitin juridinen nimi — esim. pankki 'CURSOR', kuitti 'Anysphere').
  const menonNimi = [kuitti.myyja, tapahtuma.nimi].filter((x): x is string => !!x).join(' ');
  const baseTili = meno
    ? paatteleMenotili(
        menonNimi,
        asetukset.menotiliSaannot ?? [],
        asetukset.menotili ?? tiliTyypilla(chart, Luonne.MENO)?.numero,
      )
    : (asetukset.myyntitili ?? tiliTyypilla(chart, Luonne.LVTULO)?.numero);
  if (baseTili === undefined)
    throw new ResourceError('EITILIA', meno ? 'Menotiliä ei löydy' : 'Myyntitiliä ei löydy');
  const pankki = pankkitili(chart, asetukset);

  // Verollinen rivi yhdelle kanta-erälle. Kanta > 0 → kotimaan osto/myynti; kanta 0 + käännetty
  // verovelvollisuus (ostossa) → EU-palveluosto (25) tai EU:n ulkopuolinen palveluosto (29)
  // yleisellä kannalla; muuten veroton (EIALV).
  const rev = meno && (kuitti.kaanteinenAlv ?? false);
  const verollinenRivi = (maara: Cents, kanta: number): VerollinenRivi => {
    if (kanta > 0)
      return {
        tili: baseTili,
        alvKoodi: meno ? AlvKoodi.OSTOT_NETTO : AlvKoodi.MYYNNIT_NETTO,
        alvProsentti: kanta,
        maara,
        bruttoSyotto: true,
        puoli,
        pvm: tapahtuma.pvm,
      };
    if (rev)
      return {
        tili: baseTili,
        alvKoodi:
          kuitti.alue === 'EU'
            ? AlvKoodi.YHTEISOHANKINNAT_PALVELUT
            : AlvKoodi.MAAHANTUONTI_PALVELUT,
        alvProsentti: yleinenAlv(tapahtuma.pvm),
        maara,
        bruttoSyotto: false,
        puoli,
        pvm: tapahtuma.pvm,
      };
    return {
      tili: baseTili,
      alvKoodi: AlvKoodi.EIALV,
      alvProsentti: 0,
      maara,
      bruttoSyotto: true,
      puoli,
      pvm: tapahtuma.pvm,
    };
  };

  const erat = kuitti.alv
    .map((e) => ({ kanta: e.kanta, brutto: eranBrutto(e) }))
    .filter((x): x is { kanta: number; brutto: Cents } => x.brutto !== undefined);
  // Pankin veloitus on tosite (oikea rahaliike). Jos kuitin summat täsmäävät pankkiin,
  // käytetään kanta-erien tarkkaa jakoa; jos eivät (esim. eri valuutta/nimitäsmäys),
  // kirjataan pankin euromäärä yhtenä rivinä kuitin verokannan/käänteisyyden mukaan.
  const kuitinSumma: number = erat.reduce((s, x) => s + x.brutto, 0);
  const rivit: VerollinenRivi[] =
    erat.length === 0
      ? [verollinenRivi(gross, 0)]
      : kuitinSumma === gross
        ? erat.map((x) => verollinenRivi(x.brutto, x.kanta))
        : [verollinenRivi(gross, erat[0]?.kanta ?? 0)];

  const tosite = pankillaTasapainotettu(tapahtuma, generoiVeroviennit(rivit, chart), pankki);
  if (kuitti.myyja) tosite.otsikko = kuitti.myyja;
  if (tapahtuma.viite) tosite.viite = tapahtuma.viite;
  return tosite;
}
