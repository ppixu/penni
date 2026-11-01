import type {
  IsoDate,
  PalkkaHenkilo,
  PalkkaLaji,
  PalkkaProsentit,
  PalkkaRivi,
} from '@penni/engine';
import { type Cents, muotoileEuro } from '@penni/euro';
import { syntymapaiva, velvollisuudet } from './henkilo.js';
import { jasennaPvm } from './pvm.js';
import {
  PalkatVirhe,
  type Taulukko,
  type TaulukkoKentta,
  type TaulukkoOhitus,
  haeTaulukko,
} from './taulukot.js';
import type { PalkatAsetukset, Tyontekija } from './tyontekija.js';
import { valitseVerokortti } from './verokortti.js';

/**
 * Palkkalaskenta: yksi puhdas, deterministinen funktio ilman I/O:ta. Rahat sentteinä, prosentit
 * peruspisteinä (bp), määrät sadasosina. Jokainen laskettu summa pyöristetään kerran lähimpään
 * senttiin, puolikkaat ylöspäin (VH/7526 §4.1.1 "lähimpään senttiin"), ja jokainen maksu lasketaan
 * erikseen perusteesta — ei toisista pyöristetyistä summista. Kaikki prosentit ja määrät tulevat
 * vuositaulukosta (`taulukot/<vuosi>.json`); tässä tiedostossa ei ole yhtään prosenttiliteraalia.
 */

/** Syöterivi: `summa` annetaan kuukausipalkalle, lisälle ja kulukorvaukselle; muille se lasketaan. */
export type SyoteRivi = Omit<PalkkaRivi, 'summa'> & { summa?: Cents };

export interface PalkkaSyote {
  tyontekija: Tyontekija;
  maksupaiva: IsoDate;
  kausiAlkaa: IsoDate;
  kausiLoppuu: IsoDate;
  rivit: SyoteRivi[];
}

export interface LaskentaYmparisto {
  /** Heittää PalkatVirhe('TAULUKKO_PUUTTUU', …, { vuosi, puuttuvat }), jos pyydetty arvo puuttuu. */
  taulukko: (vuosi: number, kentat?: readonly TaulukkoKentta[]) => Taulukko;
  asetukset: PalkatAsetukset;
  /** Valitun verokortin tulokertymä ennen tätä maksua (ks. `kertymaVerokortille`). */
  aiempiKertyma: Cents;
}

/** `LaskentaYmparisto.taulukko` bundlatuista taulukoista + kirjan ohituksista (`PalkatTaulukot`). */
export function taulukkoHaku(ohitus?: TaulukkoOhitus): LaskentaYmparisto['taulukko'] {
  return (vuosi, kentat) => {
    const haku = haeTaulukko(vuosi, ohitus, kentat);
    if (haku.ok) return haku.taulukko;
    throw new PalkatVirhe(
      'TAULUKKO_PUUTTUU',
      `Vuoden ${vuosi} palkkataulukosta puuttuu arvoja (${haku.puuttuvat.join(', ')}). Lisää ne palkka-asetuksiin.`,
      { vuosi, puuttuvat: haku.puuttuvat },
    );
  };
}

// --- Kokonaislukuaritmetiikka -------------------------------------------------------------

/** Jakaa ja pyöristää lähimpään kokonaislukuun, puolikkaat nollasta poispäin (BigInt, ei liukulukuja). */
function jaaPyoristaen(osoittaja: bigint, jakaja: bigint): number {
  const itseis = osoittaja < 0n ? -osoittaja : osoittaja;
  const osamaara = (2n * itseis + jakaja) / (2n * jakaja);
  return Number(osoittaja < 0n ? -osamaara : osamaara);
}

/** Peruspiste on 1/10 000 (yksikkömuunnos, ei prosenttiarvo). */
const BP_YKSIKKO = 10_000n;
/** Määrät (tunnit, km, päivät, ateriat) ovat sadasosina. */
const SADASOSA = 100n;

/** Σ bp × peruste / 10 000, pyöristettynä kerran. */
function bpOsuus(osat: readonly { bp: number; peruste: number }[]): Cents {
  let osoittaja = 0n;
  for (const o of osat) osoittaja += BigInt(o.bp) * BigInt(o.peruste);
  return jaaPyoristaen(osoittaja, BP_YKSIKKO) as Cents;
}

const kertaaBp = (peruste: number, bp: number): Cents => bpOsuus([{ bp, peruste }]);

/** maara (sadasosina) × yksikköhinta / 100, pyöristettynä kerran. */
const maaraKertaa = (maara: number, hinta: number): Cents =>
  jaaPyoristaen(BigInt(maara) * BigInt(hinta), SADASOSA) as Cents;

/** "6000" -> "60", "2350" -> "23,5" (vain näyttöön). */
function prosenttiTeksti(bp: number): string {
  const desimaalit = bp % 100;
  const kokonaiset = (bp - desimaalit) / 100;
  if (desimaalit === 0) return String(kokonaiset);
  return `${kokonaiset},${String(desimaalit).padStart(2, '0').replace(/0$/, '')}`;
}

// --- Rivit ---------------------------------------------------------------------------------

const RAHAPALKKA: ReadonlySet<PalkkaLaji> = new Set(['kuukausipalkka', 'tuntipalkka', 'lisa']);
const LUONTOISEDUT: ReadonlySet<PalkkaLaji> = new Set(['puhelinetu', 'ravintoetu']);
const VEROVAPAAT: ReadonlySet<PalkkaLaji> = new Set([
  'km',
  'kokopaivaraha',
  'osapaivaraha',
  'ateriakorvaus',
  'kulukorvaus',
]);

/** Virheviestissä vain rivin numero ja laji — ei selitettä, jossa voi olla henkilötietoja. */
function vaadi(arvo: number | undefined, kentta: string, i: number, laji: PalkkaLaji): number {
  if (arvo === undefined || !Number.isSafeInteger(arvo) || arvo < 0) {
    throw new PalkatVirhe(
      'SYOTE',
      `Palkkarivi ${i + 1} (${laji}): ${kentta} puuttuu tai ei ole ei-negatiivinen kokonaisluku.`,
    );
  }
  return arvo;
}

const vuosiPvm = (pvm: IsoDate) => jasennaPvm(pvm).v;

function laskeRivi(
  r: SyoteRivi,
  i: number,
  s: PalkkaSyote,
  y: LaskentaYmparisto,
  maksuVuosi: number,
): PalkkaRivi {
  const rivi: PalkkaRivi = { ...r, summa: 0 as Cents };
  switch (r.laji) {
    case 'kuukausipalkka':
    case 'lisa':
    case 'kulukorvaus':
      // Summa sellaisenaan (kuukausipalkka esitäytetään työntekijän tiedoista).
      rivi.summa = vaadi(r.summa, 'summa', i, r.laji) as Cents;
      break;
    case 'tuntipalkka':
      // Tunnit × tuntipalkka, pyöristys kerran rivillä.
      rivi.summa = maaraKertaa(
        vaadi(r.maara, 'määrä', i, r.laji),
        vaadi(r.ahinta, 'hinta', i, r.laji),
      );
      break;
    case 'km': {
      // Verovapaa kilometrikorvaus matkapäivän vuoden taulukosta (oletus kauden viimeinen päivä).
      const t = y.taulukko(vuosiPvm(r.pvm ?? s.kausiLoppuu), ['kmKorvaus']);
      rivi.ahinta = t.kmKorvaus;
      rivi.summa = maaraKertaa(vaadi(r.maara, 'määrä', i, r.laji), t.kmKorvaus);
      break;
    }
    case 'kokopaivaraha':
    case 'osapaivaraha':
    case 'ateriakorvaus': {
      // Päivärahat ja ateriakorvaus: kokonainen lukumäärä × matkapäivän vuoden määrä.
      const maara = vaadi(r.maara, 'määrä', i, r.laji);
      if (maara % 100 !== 0) {
        throw new PalkatVirhe(
          'SYOTE',
          `Palkkarivi ${i + 1} (${r.laji}): lukumäärän on oltava kokonaisluku.`,
        );
      }
      const t = y.taulukko(vuosiPvm(r.pvm ?? s.kausiLoppuu), [r.laji]);
      rivi.ahinta = t[r.laji];
      rivi.summa = maaraKertaa(maara, t[r.laji]);
      break;
    }
    case 'puhelinetu': {
      // Puhelinetu: kaavamainen kuukausiarvo (Verohallinnon luontoisetupäätös).
      const t = y.taulukko(maksuVuosi, ['puhelinetuKk']);
      rivi.ahinta = t.puhelinetuKk;
      rivi.summa = t.puhelinetuKk;
      break;
    }
    case 'ravintoetu': {
      // Ravintoetu (luontoisetupäätös): jos työnantajan kustannus ateriaa kohti on taulukon
      // arvon ja ylärajan välillä (rajat mukaan lukien), arvo on taulukon arvo; muuten kustannus.
      const t = y.taulukko(maksuVuosi, ['ravintoetu', 'ravintoetuYlaraja']);
      const kustannus = vaadi(r.ahinta, 'ateriakustannus', i, r.laji);
      const arvo =
        t.ravintoetu <= kustannus && kustannus <= t.ravintoetuYlaraja ? t.ravintoetu : kustannus;
      rivi.summa = maaraKertaa(vaadi(r.maara, 'määrä', i, r.laji), arvo);
      break;
    }
  }
  return rivi;
}

const summaa = (rivit: readonly PalkkaRivi[], lajit: ReadonlySet<PalkkaLaji>): Cents =>
  rivit.reduce((a, r) => (lajit.has(r.laji) ? a + r.summa : a), 0) as Cents;

// --- Maksuprosentit ------------------------------------------------------------------------

const NOLLAPROSENTIT: PalkkaProsentit = {
  tyelTyontekijaBp: 0,
  tyelKokonaisBp: 0,
  tvrTyontekijaBp: 0,
  tvrTyonantajaBp: 0,
  savaBp: 0,
};

/**
 * Henkilöön maksupäivänä sovellettavat prosentit; ne, jotka eivät koske henkilöä, ovat 0.
 * Taulukosta pyydetään vain tarvittavat kentät.
 *  - TyEL: ei YEL-vakuutetulle; ikärajat `velvollisuudet` (instr. 2026 s. 32).
 *    Työnantajan osuus = kokonaisprosentti − työntekijän osuus; kokonaisprosentti kirjan
 *    asetuksesta (`tyelKokonaisBp[vuosi]`) tai taulukon oletus / tilapäisen työnantajan prosentti.
 *  - 2025: 53–62-vuotiaiden korotettu työntekijän osuus, jos taulukossa on se.
 *  - Työttömyysvakuutus: ei YEL-vakuutetulle; osaomistajalle alennetut prosentit;
 *    työnantajan osuus 0, kun kirjalla on palkkasummavapautus (`tvrVapautus`).
 *  - Sava: kaikille vakuutusperusteille ikärajojen sisällä (VH/7272 §4.2).
 */
function laskeProsentit(
  t: Tyontekija,
  maksupaiva: IsoDate,
  vuosi: number,
  y: LaskentaYmparisto,
  lisaKentat: readonly TaulukkoKentta[],
): { prosentit: PalkkaProsentit; tyelAlaraja?: Cents; taulukko?: Taulukko } {
  const synt = syntymapaiva(t.hetu);
  if (!synt) throw new PalkatVirhe('SYOTE', 'Työntekijän henkilötunnus on virheellinen.');
  const v = velvollisuudet(synt, maksupaiva);
  const yel = t.vakuutusperuste === 'yel';
  const osaomistaja = t.vakuutusperuste === 'osaomistaja';
  const tyel = !yel && v.tyel;
  const tvr = !yel && v.tvr;
  const omaKokonais = y.asetukset.tyelKokonaisBp?.[String(vuosi)];
  const kokonaisKentta: TaulukkoKentta = y.asetukset.tilapainenTyonantaja
    ? 'tyelTilapainenKokonaisBp'
    : 'tyelOletusKokonaisBp';

  // Yksi pyyntö, jotta puuttuvat arvot listataan virheessä kerralla.
  const kentat: TaulukkoKentta[] = [...lisaKentat];
  if (tyel) {
    kentat.push('tyelTyontekijaBp', 'tyelAlarajaKk');
    if (omaKokonais === undefined) kentat.push(kokonaisKentta);
  }
  const tvrTt = osaomistaja ? 'tvrOsaomistajaTyontekijaBp' : 'tvrTyontekijaBp';
  const tvrTa = osaomistaja ? 'tvrOsaomistajaTyonantajaBp' : 'tvrTyonantajaBp';
  if (tvr) kentat.push(tvrTt);
  if (tvr && !y.asetukset.tvrVapautus) kentat.push(tvrTa);
  if (v.sava) kentat.push('savaBp');
  if (kentat.length === 0) return { prosentit: { ...NOLLAPROSENTIT } };
  const tb = y.taulukko(vuosi, kentat);

  const prosentit: PalkkaProsentit = { ...NOLLAPROSENTIT };
  let tyelAlaraja: Cents | undefined;
  if (tyel) {
    let tyontekijaBp = tb.tyelTyontekijaBp;
    if (v.tyel53_62) {
      const korotettu = valinnainen(y, vuosi, 'tyelTyontekija53_62Bp');
      if (korotettu !== undefined) tyontekijaBp = korotettu;
    }
    const kokonais = omaKokonais ?? tb[kokonaisKentta];
    if (kokonais < tyontekijaBp) {
      throw new PalkatVirhe(
        'SYOTE',
        `TyEL-kokonaisprosentti vuodelle ${vuosi} on pienempi kuin työntekijän osuus.`,
      );
    }
    prosentit.tyelTyontekijaBp = tyontekijaBp;
    prosentit.tyelKokonaisBp = kokonais;
    tyelAlaraja = tb.tyelAlarajaKk;
  }
  if (tvr) {
    prosentit.tvrTyontekijaBp = tb[tvrTt];
    if (!y.asetukset.tvrVapautus) prosentit.tvrTyonantajaBp = tb[tvrTa];
  }
  if (v.sava) prosentit.savaBp = tb.savaBp;
  return tyelAlaraja === undefined
    ? { prosentit, taulukko: tb }
    : { prosentit, tyelAlaraja, taulukko: tb };
}

/** Valinnainen taulukkoarvo: puuttuminen ei ole virhe. */
function valinnainen(
  y: LaskentaYmparisto,
  vuosi: number,
  kentta: TaulukkoKentta,
): number | undefined {
  try {
    return y.taulukko(vuosi, [kentta])[kentta];
  } catch (e) {
    if (e instanceof PalkatVirhe && e.koodi === 'TAULUKKO_PUUTTUU') return undefined;
    throw e;
  }
}

// --- Laskenta ------------------------------------------------------------------------------

/**
 * Laskee yhden henkilön palkan. Säännöt (suunnitelma "Calculation"):
 *  - Pidätysperuste = rahapalkka + luontoisedut; verovapaat korvaukset eivät kuulu siihen, eikä
 *    työntekijän TyEL- tai TVR-maksuja vähennetä perusteesta.
 *  - Ennakonpidätys: tulorajaan asti perusprosentilla, sen ylittävä osa lisäprosentilla; raja on
 *    kumulatiivinen kortin voimassaoloajalta (`aiempiKertyma`), ylittävä maksu jaetaan kahteen
 *    osaan (VH/7526 §4.3.2, §6.1.1). Ilman korttia taulukon `eiVerokorttiaBp` (60 %, §6.1.1).
 *    Tammikuun sääntö: edellisen vuoden kortti (§4.3.3), jonka kertymää jatketaan.
 *  - Pidätys ei ylitä rahana maksettua palkkaa (VH/7526 §4.1.2, EPL 11 § 2 mom.): rajataan ja
 *    varoitetaan; siirtoa seuraavaan palkkaan ei automatisoida.
 *  - TyEL, TVR ja sava lasketaan samasta perusteesta, kukin erikseen.
 *  - Nettopalkka = rahapalkka + verovapaat − pidätys − työntekijän TyEL − työntekijän TVR.
 */
export function laskePalkka(s: PalkkaSyote, y: LaskentaYmparisto): PalkkaHenkilo {
  const t = s.tyontekija;
  const vuosi = jasennaPvm(s.maksupaiva).v;
  jasennaPvm(s.kausiAlkaa);
  jasennaPvm(s.kausiLoppuu);

  const rivit = s.rivit.map((r, i) => laskeRivi(r, i, s, y, vuosi));
  const rahapalkka = summaa(rivit, RAHAPALKKA);
  const luontoisedut = summaa(rivit, LUONTOISEDUT);
  const verovapaat = summaa(rivit, VEROVAPAAT);
  const pidatysperuste = (rahapalkka + luontoisedut) as Cents;
  const varoitukset: string[] = [];

  // Maksuprosentit ja pidätyksen taulukkoarvot haetaan vain, kun on veronalaista maksettavaa,
  // jotta esim. pelkkä km-korvaus onnistuu vuodelle, jonka maksuprosentteja ei vielä ole.
  const valinta = valitseVerokortti(t.verokortit, s.maksupaiva);
  const { prosentit, tyelAlaraja, taulukko } =
    pidatysperuste > 0
      ? laskeProsentit(t, s.maksupaiva, vuosi, y, valinta ? [] : ['eiVerokorttiaBp'])
      : { prosentit: { ...NOLLAPROSENTIT }, tyelAlaraja: undefined, taulukko: undefined };

  // Ennakonpidätys
  const pidatysOsat: { bp: number; peruste: Cents }[] = [];
  if (pidatysperuste > 0) {
    if (valinta) {
      const k = valinta.kortti;
      const tilaa = Math.max(0, k.tuloraja - y.aiempiKertyma);
      const perusOsa = Math.min(pidatysperuste, tilaa);
      const lisaOsa = pidatysperuste - perusOsa;
      if (perusOsa > 0) pidatysOsat.push({ bp: k.perusBp, peruste: perusOsa as Cents });
      if (lisaOsa > 0) pidatysOsat.push({ bp: k.lisaBp, peruste: lisaOsa as Cents });
      if (valinta.tammikuuSaanto) {
        varoitukset.push(
          'Maksupäivälle ei ole syötetty uutta verokorttia: tammikuussa käytetään edellisen vuoden verokortin prosentteja. Syötä uusi verokortti, kun se on saatavilla.',
        );
      }
    } else if (taulukko) {
      const bp = taulukko.eiVerokorttiaBp;
      pidatysOsat.push({ bp, peruste: pidatysperuste });
      varoitukset.push(
        `Työntekijällä ei ole maksupäivänä voimassa olevaa verokorttia: ennakonpidätys tehdään ${prosenttiTeksti(bp)} %:n mukaan. Lisää verokortti työntekijän tietoihin.`,
      );
    }
  }
  const laskettuPidatys = bpOsuus(pidatysOsat);
  let ennakonpidatys = laskettuPidatys;
  if (ennakonpidatys > rahapalkka) {
    ennakonpidatys = rahapalkka;
    varoitukset.push(
      `Ennakonpidätys (${muotoileEuro(laskettuPidatys)}) ylittäisi rahana maksettavan palkan, joten se on rajattu määrään ${muotoileEuro(rahapalkka)}.`,
    );
  }

  // Maksut
  const tyelTyontekija = kertaaBp(pidatysperuste, prosentit.tyelTyontekijaBp);
  const tyelTyonantaja = kertaaBp(
    pidatysperuste,
    prosentit.tyelKokonaisBp - prosentit.tyelTyontekijaBp,
  );
  const tvrTyontekija = kertaaBp(pidatysperuste, prosentit.tvrTyontekijaBp);
  const tvrTyonantaja = kertaaBp(pidatysperuste, prosentit.tvrTyonantajaBp);
  const sava = kertaaBp(pidatysperuste, prosentit.savaBp);

  // MVP: alarajaa verrataan vain tämän maksun perusteeseen, ei saman kuukauden muihin maksuihin.
  if (tyelAlaraja !== undefined && pidatysperuste < tyelAlaraja) {
    varoitukset.push(
      `Maksun TyEL-palkka ${muotoileEuro(pidatysperuste)} alittaa TyEL-vakuuttamisen kuukausittaisen alarajan ${muotoileEuro(tyelAlaraja)}. Maksut on laskettu silti; tarkista, onko samalle kuukaudelle muita palkkoja.`,
    );
  }

  const nettopalkka = (rahapalkka +
    verovapaat -
    ennakonpidatys -
    tyelTyontekija -
    tvrTyontekija) as Cents;
  if (nettopalkka < 0) {
    varoitukset.push(
      `Nettopalkka on negatiivinen (${muotoileEuro(nettopalkka)}): työntekijän eläke- ja työttömyysvakuutusmaksut ylittävät maksettavan rahamäärän.`,
    );
  }

  const k = valinta?.kortti;
  return {
    tyontekijaId: t.id,
    nimi: t.nimi,
    vakuutusperuste: t.vakuutusperuste,
    verokortti:
      valinta && k
        ? {
            alkaa: k.alkaa,
            paattyy: k.paattyy,
            perusBp: k.perusBp,
            lisaBp: k.lisaBp,
            tuloraja: k.tuloraja,
            tammikuuSaanto: valinta.tammikuuSaanto,
          }
        : null,
    prosentit,
    rivit,
    tulos: {
      rahapalkka,
      luontoisedut,
      verovapaat,
      pidatysperuste,
      pidatysOsat,
      ennakonpidatys,
      tyelTyontekija,
      tyelTyonantaja,
      tvrTyontekija,
      tvrTyonantaja,
      sava,
      nettopalkka,
      kertymaJalkeen: (y.aiempiKertyma + pidatysperuste) as Cents,
      varoitukset,
    },
  };
}

/** Lomakkeen oletusrivit: kuukausipalkka tai tyhjä tuntirivi tuntipalkalla, sekä puhelinetu. */
export function oletusRivit(t: Tyontekija, taulukko: Taulukko, kausiLoppuu: IsoDate): SyoteRivi[] {
  const { v, k } = jasennaPvm(kausiLoppuu);
  const kausi = `${k}/${v}`;
  const rivit: SyoteRivi[] =
    t.palkkamuoto === 'kuukausi'
      ? [
          {
            laji: 'kuukausipalkka',
            selite: `Palkka ${kausi}`,
            summa: t.kuukausipalkka ?? (0 as Cents),
          },
        ]
      : [
          {
            laji: 'tuntipalkka',
            selite: `Tuntipalkka ${kausi}`,
            maara: 0,
            ahinta: t.tuntipalkka ?? (0 as Cents),
          },
        ];
  if (t.puhelinetu) {
    rivit.push({ laji: 'puhelinetu', selite: `Puhelinetu ${kausi}`, summa: taulukko.puhelinetuKk });
  }
  return rivit;
}
