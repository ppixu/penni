import type { IsoDate, PalkkaAjo, PalkkaHenkilo, PalkkaLaji } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { tarkistaHetu } from '../henkilo.js';
import { jasennaPvm } from '../pvm.js';
import { PalkatVirhe } from '../taulukot.js';
import type { PalkatAsetukset, Tyontekija } from '../tyontekija.js';
import {
  type Elementti,
  LAHDE,
  type Maksaja,
  TUNNISTE,
  UUSI_ILMOITUS,
  VIRHEKASITTELY,
  aikaleima,
  dokumentti,
  e,
  euroa,
  numerot,
  t,
  teksti,
  tietueenOsapuolet,
  tyelTiedot,
  viite,
  yhteyshenkilot,
  ytunnus,
  ytunnusId,
} from './xml.js';

/**
 * Palkkatietoilmoitus (ansiotietoilmoitus, DeliveryDataType 100): yksi tiedosto per palkka-ajo
 * (yksi maksaja ja maksupäivä), yksi `Report` per henkilö. Skeema WageReportsToIR (2025- ja
 * 2027-paketit, ks. `packages/palkat/xsd/README.md`).
 *
 * Lähteet (viitteet kommenteissa):
 *  - instr. 2026 = "Application instructions on the data contents of an earnings payment report 2026" v1.2
 *  - schema 2026 = "Data delivery – Schemas – Earnings payment reports 2026" v1.5
 *  - tulolajit 2026 = "Wages – Codes – Income types 2026"; koodistot = "Codes 2026"
 *  kaikki: https://www.vero.fi/en/incomes-register/software-developers/documentation/
 */

export interface PalkkatietoilmoitusSyote {
  tositeId: number;
  maksupaiva: IsoDate;
  ajo: PalkkaAjo;
  maksaja: Maksaja;
  /** Rekisteri: henkilötunnus ja ammattiluokka, joita tilannekuvassa ei ole. */
  tyontekijat: ReadonlyMap<string, Tyontekija>;
  asetukset: PalkatAsetukset;
  tuotanto: boolean;
}

const NIMIAVARUUS = 'http://www.tulorekisteri.fi/2017/1/WageReportsToIR';

/** Tietueen tunniste: `P<tosite>-<laskettu-aikaleiman numerot>`; ei henkilötietoja. */
export function deliveryId(tositeId: number, laskettu: string): string {
  return `P${tositeId}-${numerot(laskettu)}`;
}

/** Raportin tunniste: `<tosite>-<työntekijän id>`; pysyvä, jotta korvaava ilmoitus voidaan kohdistaa. */
export function reportId(tositeId: number, tyontekijaId: string): string {
  return `${tositeId}-${tyontekijaId}`;
}

// --- Koodit ---------------------------------------------------------------------------------

/** Codes: PensionActCode. */
const ELAKELAKI = { tyel: 1, yel: 3 } as const;

/** Codes: InsuranceExceptionCode ("No obligation to provide insurance (…)"). */
const POIKKEUS = { sairaus: 2, elake: 3, tapaturma: 4, tyottomyys: 5 } as const;

/** Codes: IncomeEarnerType 3 = "Partial owner" (osaomistaja, työttömyysturvalaki 1290/2002). */
const OSAOMISTAJA = 3;

/** Codes: ProfessionType 1 = Tilastokeskuksen ammattiluokitus TK10. */
const TK10 = 1;

/** Codes: AllowanceCode (päivärahan laji). */
const PAIVARAHA = { osapaivaraha: 2, kokopaivaraha: 3 } as const;

/**
 * Palkkarivin tulolaji (tulolajit 2026). Ilmoitustapa 2 (eritelty rahapalkka, 200-sarja) ja
 * erikseen ilmoitettavat 300-sarjan tulolajit; 100-sarjaa (tapa 1) ei käytetä, eikä tapoja saa
 * sekoittaa (schema 2026 §2.27).
 *  - kuukausi- ja tuntipalkka: 201 Aikapalkka ("Wages paid based on the time worked").
 *  - lisa: 216 Muut korvaukset ("working time and exceptional situation compensations not paid
 *    regularly … any other compensation and bonuses paid in accordance with collective agreements
 *    or employment contracts"). Palkka-ajon vapaa lisärivi on kertaluonteinen; säännölliset lisät
 *    (238) ja tulospalkkiot (203) vaatisivat oman rivilajin. Vakuutustiedot ovat oletusarvoiset
 *    (kaikki vakuutukset), samat kuin 201:llä.
 *  - puhelinetu: 330 Puhelinetu ja ravintoetu: 334 Ravintoetu, eriteltyinä omina tulolajeinaan.
 *    Tulolajit 2026 (330, 334): "can be reported separately, but the received benefit must at least
 *    be reported as a total sum, using the 'Other fringe benefit' income type (317)" ja "If … reported
 *    separately, it should not be added to … 317"; instr. 2026 s. 58 (Other fringe benefit): "Of the
 *    fringe benefits, accommodation benefit and telephone benefit can be reported as separate income
 *    types". Kumpikin tapa kelpaa; eritelty on tarkempi eikä tarvitse BenefitCode-lisätietoa.
 *    Ravintoedulle ei anneta MealBenefit/TaxValue-tietoa, koska työntekijältä ei peritä korvausta.
 *  - km: 311 Kilometrikorvaus (verovapaa) + KmAllowance/Kilometers (instr. 2026 s. 62).
 *  - koko- ja osapäiväraha: 331 Päiväraha + DailyAllowance/AllowanceCode 3 ja/tai 2
 *    (schema 2026 §2.37: lisätieto pakollinen tulolajille 331).
 *  - ateriakorvaus: 303 Ateriakorvaus omana tulolajinaan (tulolajit 2026, 303: "can be reported
 *    separately"; tällöin sitä ei lisätä 331:een).
 *  - kulukorvaus: ei ilmoiteta. Tositteisiin perustuva kulujen korvaus ei ole tuloa; vrt.
 *    tulolajit 2026, 311: matkalippuun perustuva korvaus "is tax-exempt, and is not reported".
 */
const TULOLAJI: Record<PalkkaLaji, number | null> = {
  kuukausipalkka: 201,
  tuntipalkka: 201,
  lisa: 216,
  ateriakorvaus: 303,
  km: 311,
  puhelinetu: 330,
  kokopaivaraha: 331,
  osapaivaraha: 331,
  ravintoetu: 334,
  kulukorvaus: null,
};

/**
 * Tulolajit, jotka ovat oletusarvoisesti eläke-, tapaturma-, työttömyys- ja sairausvakuutusmaksun
 * alaisia (tulolajit 2026, sarakkeet "Subject to …": 201, 216, 330 ja 334 = Yes kaikissa; 303, 311
 * ja 331 = No kaikissa). Vain nämä tekevät PensionInsurance- ja Professions-ryhmistä pakollisia
 * (schema 2026 §2.22 a ja §2.19 a).
 */
const VAKUUTETTAVA: ReadonlySet<number> = new Set([201, 216, 330, 334]);

/** Pidätykset ja työntekijän maksut (tulolajit 2026, 400-sarja). */
const ENNAKONPIDATYS = 402;
const TYEL_TYONTEKIJA = 413;
const TVR_TYONTEKIJA = 414;

// --- Henkilön raportti ----------------------------------------------------------------------

interface Tulolaji {
  koodi: number;
  summa: number;
  km: number; // sadasosina (311)
  paivarahat: Set<number>; // AllowanceCode (331)
}

/** Kerää rivit tulolajeittain, koodijärjestyksessä (deterministinen). */
function tulolajit(h: PalkkaHenkilo, i: number): Tulolaji[] {
  const kertyma = new Map<number, Tulolaji>();
  const lisaa = (koodi: number, summa: number): Tulolaji => {
    if (!Number.isSafeInteger(summa) || summa < 0) {
      throw new PalkatVirhe(
        'SYOTE',
        `Palkka-ajon henkilö ${i + 1}: rivin summa ei ole ei-negatiivinen senttimäärä.`,
      );
    }
    const tl = kertyma.get(koodi) ?? { koodi, summa: 0, km: 0, paivarahat: new Set<number>() };
    tl.summa += summa;
    kertyma.set(koodi, tl);
    return tl;
  };
  for (const r of h.rivit) {
    const koodi = TULOLAJI[r.laji];
    if (koodi === null || koodi === undefined) continue;
    const tl = lisaa(koodi, r.summa);
    if (r.laji === 'km') tl.km += r.maara ?? 0;
    if (r.laji === 'kokopaivaraha' || r.laji === 'osapaivaraha') {
      tl.paivarahat.add(PAIVARAHA[r.laji]);
    }
  }
  lisaa(ENNAKONPIDATYS, h.tulos.ennakonpidatys);
  lisaa(TYEL_TYONTEKIJA, h.tulos.tyelTyontekija);
  lisaa(TVR_TYONTEKIJA, h.tulos.tvrTyontekija);
  // Nollasummaisia tulolajeja ei ilmoiteta (instr. 2026 s. 50: "The amount of money paid must be
  // reported for each reported income type"; pidättämätöntä veroa ei ilmoiteta, tulolajit 2026, 317).
  return [...kertyma.values()].filter((tl) => tl.summa > 0).sort((a, b) => a.koodi - b.koodi);
}

/** Kilometrit kokonaislukuna (xs:int) sadasosista, puolikkaat ylöspäin. */
const kilometrit = (sadasosat: number) => Math.trunc((sadasosat + 50) / 100);

function transaktio(tl: Tulolaji): Elementti {
  return e('Transaction', [
    e('TransactionBasic', [t('TransactionCode', tl.koodi), t('Amount', euroa(tl.summa as Cents))]),
    tl.koodi === 331 &&
      e(
        'DailyAllowance',
        [...tl.paivarahat].sort((a, b) => a - b).map((k) => t('AllowanceCode', k)),
      ),
    tl.koodi === 311 && e('KmAllowance', [t('Kilometers', kilometrit(tl.km))]),
  ]);
}

/** TyEL-vakuutus kirjan asetuksista (schema 2026 §2.22: TyEL:lle tunnus ja numero pakollisia). */
function tyelVakuutus(a: PalkatAsetukset): Elementti {
  const tyel = tyelTiedot(a);
  if (!tyel) {
    throw new PalkatVirhe(
      'SYOTE',
      'TyEL-vakuutuksen tiedot (eläkelaitos ja vakuutusnumero) puuttuvat palkka-asetuksista.',
    );
  }
  return e('PensionInsurance', [
    t('PensionActCode', ELAKELAKI.tyel),
    t('PensionProvIdCode', tyel.yhtio),
    t('PensionPolicyNo', tyel.sopimus),
  ]);
}

/**
 * Tapaturmavakuutuksen tiedot (AccidentInsurance) ovat vapaaehtoisia: instr. 2026 s. 33-34
 * vaatii ne vain, jos maksajalla on useampi tapaturmavakuutus. Kirjalla on yksi, joten ne
 * annetaan, kun molemmat on asetettu.
 */
function tapaturmaVakuutus(a: PalkatAsetukset): Elementti | null {
  const yhtio = (a.tapaturmaYhtio ?? '').trim();
  const sopimus = (a.tapaturmaSopimus ?? '').trim();
  if (yhtio === '' && sopimus === '') return null;
  return e('AccidentInsurance', [
    ytunnusId('AccInsProvId', ytunnus(yhtio, 'Tapaturmavakuutusyhtiön Y-tunnus')),
    // Schema 2026 §2.23: vakuutusnumerossa ei saa olla välilyöntejä.
    t('AccInsPolicyNo', teksti(sopimus.replace(/\s+/g, ''), 'Tapaturmavakuutusnumero', 20)),
  ]);
}

function raportti(
  h: PalkkaHenkilo,
  i: number,
  s: PalkkatietoilmoitusSyote,
  tapaturma: Elementti | null,
  tyel: () => Elementti,
): Elementti | null {
  const tyontekija = s.tyontekijat.get(h.tyontekijaId);
  if (!tyontekija) {
    throw new PalkatVirhe('SYOTE', `Palkka-ajon henkilö ${i + 1} puuttuu työntekijärekisteristä.`);
  }
  const tl = tulolajit(h, i);
  if (tl.length === 0) return null; // ei maksettavaa, ei raporttia
  // Henkilötunnus normalisoidaan: Tulorekisteri erottaa isot ja pienet kirjaimet ("150172-999H"
  // ja "150172-999h" ovat eri tunnuksia, schema 2026 §1.2) eikä salli reunavälilyöntejä (§2.14).
  const hetu = tyontekija.hetu.trim().toUpperCase();
  if (!tarkistaHetu(hetu)) {
    throw new PalkatVirhe('SYOTE', `Palkka-ajon henkilö ${i + 1}: henkilötunnus on virheellinen.`);
  }
  const raporttiId = viite(
    reportId(s.tositeId, h.tyontekijaId),
    `Palkka-ajon henkilö ${i + 1}: raporttitunnus`,
  );

  // Vakuuttaminen tilannekuvan vakuutusperusteesta ja jäädytetyistä prosenteista: laskenta asettaa
  // prosentin nollaksi, kun velvollisuutta ei ole (YEL tai ikäraja, `velvollisuudet`), joten
  // ilmoitus on aina sopusoinnussa ilmoitettujen 413/414-summien kanssa.
  const vakuutettava = tl.some((x) => VAKUUTETTAVA.has(x.koodi));
  const p = h.prosentit;
  const yel = h.vakuutusperuste === 'yel';
  const poikkeukset: number[] = [];
  let elake: Elementti | null = null;
  let ammatti: Elementti | null = null;
  if (yel) {
    // YEL-yrittäjä: PensionActCode 3 ilman eläkelaitosta ja vakuutusnumeroa (schema 2026 §2.22),
    // ja poikkeukset 3, 4 ja 5 ovat pakollisia (schema 2026 §2.24). Instr. 2026 s. 32: YEL-vakuutetun
    // palkka on tärkeää ilmoittaa YEL-tiedolla, ettei maksuja peritä kahdesti.
    elake = e('PensionInsurance', [t('PensionActCode', ELAKELAKI.yel)]);
    poikkeukset.push(POIKKEUS.elake, POIKKEUS.tapaturma, POIKKEUS.tyottomyys);
    if (vakuutettava && p.savaBp === 0) poikkeukset.push(POIKKEUS.sairaus);
  } else if (vakuutettava) {
    // Työntekijä ja osaomistaja. Instr. 2026 s. 34-35: kun vakuuttamisvelvollisuutta ei ole esim.
    // henkilön iän vuoksi, ilmoitetaan "No obligation to provide insurance" kunkin vakuutuksen
    // osalta erikseen; TyEL-tiedot jätetään silloin pois (schema 2026 §2.22 c).
    if (p.tyelKokonaisBp > 0) elake = tyel();
    else poikkeukset.push(POIKKEUS.elake);
    if (p.tvrTyontekijaBp === 0) poikkeukset.push(POIKKEUS.tyottomyys);
    if (p.savaBp === 0) poikkeukset.push(POIKKEUS.sairaus);
    // Tapaturmavakuutus koskee kaikkia työntekijöitä iästä ja palkasta riippumatta (instr. 2026
    // s. 33), joten TK10-ammattiluokka on pakollinen (instr. 2026 s. 28, schema 2026 §2.19).
    const koodi = (tyontekija.ammattikoodi ?? '').trim();
    if (koodi === '') {
      throw new PalkatVirhe(
        'SYOTE',
        `Palkka-ajon henkilö ${i + 1}: ammattiluokka puuttuu (Tilastokeskuksen TK10-luokitus, viisi numeroa), joka vaaditaan tapaturmavakuutetulle. Lisää se työntekijän tietoihin.`,
      );
    }
    // Instr. 2026 s. 29: TK10-koodista on annettava vähintään viisi tasoa (viisinumeroinen).
    if (!/^\d{5}$/.test(koodi)) {
      throw new PalkatVirhe(
        'SYOTE',
        `Palkka-ajon henkilö ${i + 1}: ammattiluokan on oltava viisinumeroinen TK10-koodi.`,
      );
    }
    ammatti = e('Professions', [e('Profession', [t('Type', TK10), t('Code', koodi)])]);
  }
  poikkeukset.sort((a, b) => a - b);

  return e('Report', [
    e('ReportData', [t('ActionCode', UUSI_ILMOITUS), t('ReportId', raporttiId)]),
    e('IncomeEarner', [
      e('IncomeEarnerIds', [e('Id', [t('Type', TUNNISTE.hetu), t('Code', hetu)])]),
      ammatti,
      elake,
      // YEL-yrittäjällä ei ole pakollista tapaturmavakuutusta (instr. 2026 s. 33).
      !yel && vakuutettava && tapaturma,
      poikkeukset.length > 0 &&
        e(
          'InsuranceExceptions',
          poikkeukset.map((k) => t('ExceptionCode', k)),
        ),
      // Osaomistaja maksaa alennettua työttömyysvakuutusmaksua; tieto ilmoitetaan lisätietona
      // "Partial owner" (instr. 2026 s. 41).
      h.vakuutusperuste === 'osaomistaja' &&
        e('IncomeEarnerOther', [e('IncomeEarnerTypes', [t('IncomeEarnerType', OSAOMISTAJA)])]),
    ]),
    e('Transactions', tl.map(transaktio)),
  ]);
}

// --- Tietue ---------------------------------------------------------------------------------

/**
 * Palkkatietoilmoitus XML-merkkijonona. Deterministinen: sama syöte (ja sama `ajo.laskettu`)
 * tuottaa saman merkkijonon, joten tositteelle tallennettu tiiviste vastaa ladattua tiedostoa.
 */
export function palkkatietoilmoitusXml(s: PalkkatietoilmoitusSyote): string {
  if (s.asetukset.tilapainenTyonantaja) {
    // Tilapäiselle työnantajalle Tulorekisteri vaatii maksajan nimen, osoitteen ja maksajatyypin 3
    // (schema 2026 §2.6, §2.7, §2.9); osoitetta ei ole palkka-asetuksissa.
    throw new PalkatVirhe(
      'SYOTE',
      'Tilapäisen työnantajan palkkatietoilmoitusta ei vielä tueta: Tulorekisteri vaatii maksajan osoitteen. Tee ilmoitus Tulorekisterin verkkolomakkeella.',
    );
  }
  const tunnus = ytunnus(s.maksaja.ytunnus, 'Maksajan Y-tunnus');
  const aika = aikaleima(s.ajo.laskettu, 'Palkka-ajon tallennusaika');
  jasennaPvm(s.maksupaiva);
  jasennaPvm(s.ajo.kausiAlkaa);
  jasennaPvm(s.ajo.kausiLoppuu);

  const nahty = new Map<string, number>();
  s.ajo.henkilot.forEach((h, i) => {
    const aiempi = nahty.get(h.tyontekijaId);
    if (aiempi !== undefined) {
      throw new PalkatVirhe(
        'SYOTE',
        `Palkka-ajon henkilöt ${aiempi + 1} ja ${i + 1} ovat sama työntekijä.`,
      );
    }
    nahty.set(h.tyontekijaId, i);
  });

  let tyel: Elementti | undefined;
  const tyelKerran = () => {
    tyel ??= tyelVakuutus(s.asetukset);
    return tyel;
  };
  const tapaturma = tapaturmaVakuutus(s.asetukset);
  const raportit = s.ajo.henkilot
    .map((h, i) => raportti(h, i, s, tapaturma, tyelKerran))
    .filter((r): r is Elementti => r !== null);
  if (raportit.length === 0) {
    throw new PalkatVirhe(
      'SYOTE',
      'Palkka-ajossa ei ole Tulorekisteriin ilmoitettavia suorituksia.',
    );
  }

  return dokumentti(
    'wrtir',
    NIMIAVARUUS,
    e('WageReportsRequestToIR', [
      e('DeliveryData', [
        t('Timestamp', aika),
        t('Source', LAHDE),
        t('DeliveryDataType', 100),
        t('DeliveryId', viite(deliveryId(s.tositeId, aika), 'Tietueen tunniste')),
        t('FaultyControl', VIRHEKASITTELY),
        t('ProductionEnvironment', s.tuotanto),
        ...tietueenOsapuolet(tunnus),
        e('PaymentPeriod', [
          t('PaymentDate', s.maksupaiva),
          t('StartDate', s.ajo.kausiAlkaa),
          t('EndDate', s.ajo.kausiLoppuu),
        ]),
        yhteyshenkilot(s.maksaja),
        // Maksajan tunniste riittää: nimi ja osoite annetaan vain ilman suomalaista tunnistetta tai
        // tilapäiselle työnantajalle (instr. 2026 s. 11; schema 2026 §2.6-2.7).
        e('Payer', [e('PayerIds', [ytunnusId('Id', tunnus)])]),
        e('Reports', raportit),
      ]),
    ]),
  );
}
