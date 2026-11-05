import type { Cents } from '@penni/euro';
import type { IsoDate } from './types.js';

/**
 * Palkka-ajon tilannekuva (`Tosite.palkka`, TositeTyyppi.PALKKA). Ajo tallennetaan tositteelle
 * sellaisenaan: laskennan tulokset ja käytetyt prosentit jäädytetään, jotta jälkikäteen
 * muuttuvat verokortti-, TyEL- tai päivärahaprosentit eivät muuta jo tehtyä ajoa.
 * Rahamäärät ovat kokonaislukusentteinä; henkilötunnusta ja IBANia ei koskaan tallenneta tänne.
 */

/** Millä perusteella henkilö vakuutetaan (TyEL/YEL/osaomistaja). */
export type Vakuutusperuste = 'tyontekija' | 'yel' | 'osaomistaja';

export type PalkkaLaji =
  | 'kuukausipalkka'
  | 'tuntipalkka'
  | 'lisa'
  | 'km'
  | 'kokopaivaraha'
  | 'osapaivaraha'
  | 'ateriakorvaus'
  | 'kulukorvaus'
  | 'puhelinetu'
  | 'ravintoetu';

export interface PalkkaRivi {
  laji: PalkkaLaji;
  selite: string; // esim. "Lokakuun palkka", km-reitti, "Helsinki–Tampere asiakaskäynti"
  maara?: number; // sadasosina: tunnit, km, päivät tai ateriat (3750 = 37,5)
  ahinta?: Cents; // yksikköhinta: tuntipalkka, €/km, päivärahan määrä, työnantajan ateriakustannus
  summa: Cents; // rivin summa (lasketaan tunti-, km-, päiväraha- ja eturiveille)
  pvm?: IsoDate; // matkapäivä km- ja päivärahariveille (määrän valinta)
  tili?: number; // kulukorvauksen tili
}

export interface PalkkaProsentit {
  tyelTyontekijaBp: number;
  tyelKokonaisBp: number;
  tvrTyontekijaBp: number;
  tvrTyonantajaBp: number;
  savaBp: number;
}

export interface PalkkaTulos {
  rahapalkka: Cents; // kuukausi + tunti + lisät
  luontoisedut: Cents; // puhelin + ravinto
  verovapaat: Cents; // km + päivärahat + ateria + kulukorvaukset
  pidatysperuste: Cents; // rahapalkka + luontoisedut
  pidatysOsat: { bp: number; peruste: Cents }[]; // yksi osa, tai kaksi kun tuloraja ylittyy
  ennakonpidatys: Cents;
  tyelTyontekija: Cents;
  tyelTyonantaja: Cents;
  tvrTyontekija: Cents;
  tvrTyonantaja: Cents;
  sava: Cents;
  nettopalkka: Cents;
  kertymaJalkeen: Cents; // verokortin tulokertymä tämän maksun jälkeen
  varoitukset: string[]; // suomenkieliset käyttöliittymätekstit
}

export interface PalkkaHenkilo {
  tyontekijaId: string;
  nimi: string; // tilannekuva; EI KOSKAAN hetua tai IBANia
  vakuutusperuste: Vakuutusperuste;
  verokortti: {
    alkaa: IsoDate;
    paattyy: IsoDate;
    perusBp: number;
    lisaBp: number;
    tuloraja: Cents;
    tammikuuSaanto: boolean;
  } | null;
  prosentit: PalkkaProsentit;
  rivit: PalkkaRivi[];
  tulos: PalkkaTulos;
}

export interface PalkkaAjo {
  versio: 1;
  kausiAlkaa: IsoDate;
  kausiLoppuu: IsoDate;
  laskettu: string; // viimeisimmän tallennuksen ISO-aikaleima; ohjaa XML:n Timestampin ja DeliveryId:n
  henkilot: PalkkaHenkilo[];
  ilmoitus?: { lahetetty: IsoDate; deliveryId: string; sha256: string };
}
