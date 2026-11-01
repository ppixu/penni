import type { Cents } from '@penni/euro';
import { jasennaKuukausi } from '../pvm.js';
import { PalkatVirhe } from '../taulukot.js';
import type { PalkatAsetukset } from '../tyontekija.js';
import {
  LAHDE,
  type Maksaja,
  UUSI_ILMOITUS,
  VIRHEKASITTELY,
  aikaleima,
  dokumentti,
  e,
  euroa,
  numerot,
  t,
  tietueenOsapuolet,
  tyelTiedot,
  viite,
  yhteyshenkilot,
  ytunnus,
  ytunnusId,
} from './xml.js';

/**
 * Työnantajan erillisilmoitus (DeliveryDataType 101): yksi tiedosto ja yksi raportti per
 * maksukuukausi. Skeema PayerSummaryReportsToIR. Lähteet: "Data delivery – Schemas – Employer's
 * separate reports 2026" (schema 2026) ja "Application instructions for the employer's separate
 * report 2027" (instr. 2027), https://www.vero.fi/en/incomes-register/software-developers/documentation/.
 */

export interface ErillisilmoitusSyote {
  /** Maksukuukausi VVVV-KK. */
  kuukausi: string;
  /** Kuukauden työnantajan sairausvakuutusmaksu (palkka-ajojen summa); null = ei palkanmaksua. */
  sava: Cents | null;
  maksaja: Maksaja;
  /** Tietueen luontiaika (ISO, aikavyöhykkeen kanssa); myös ilmoituspäivä. */
  aikaleima: string;
  tuotanto: boolean;
  /**
   * Palkka-asetukset "ei palkanmaksua" -ilmoitusta varten: maksajan TyEL-vakuutus on silloin
   * ilmoitettava (instr. 2027 s. 11), paitsi jos maksajalla on vain YEL-vakuutettuja.
   * Ilman TyEL-tietoja ryhmä jätetään pois.
   */
  asetukset?: PalkatAsetukset;
}

const NIMIAVARUUS = 'http://www.tulorekisteri.fi/2017/1/PayerSummaryReportsToIR';

/** Codes "Wages – Codes – Income types 2026", Employer's separate report. */
const EI_PALKANMAKSUA = 101;
const SAVA_YHTEENSA = 102;

export function erillisilmoitusXml(s: ErillisilmoitusSyote): string {
  const { v, k } = jasennaKuukausi(s.kuukausi);
  const kk = String(k).padStart(2, '0');
  const tunnus = ytunnus(s.maksaja.ytunnus, 'Maksajan Y-tunnus');
  const aika = aikaleima(s.aikaleima, 'Ilmoituksen aikaleima');
  if (s.sava !== null && (!Number.isSafeInteger(s.sava) || s.sava < 0)) {
    throw new PalkatVirhe('SYOTE', 'Sairausvakuutusmaksun on oltava ei-negatiivinen senttimäärä.');
  }

  // "Ei palkanmaksua" -ilmoitukseen maksajan eläkevakuutus (instr. 2027 s. 11: "This information
  // must be reported, if the No wages payable information was specified in the report").
  // Eläkelaitoksen tunnus on vakuutusnumeron alku (schema 2026 §2.9).
  const tyel = s.sava === null ? tyelTiedot(s.asetukset) : null;
  const elakevakuutus =
    tyel &&
    e('PensionInsurances', [
      e('PensionInsurance', [
        t('PensionProvIdCode', tyel.yhtio),
        t('PensionPolicyNo', tyel.sopimus),
      ]),
    ]);

  // "Ei palkanmaksua" ilmoitetaan ilman summaa (schema 2026 §2.14: Amount pakollinen, jos koodi ei
  // ole 101; instr. 2027 s. 15: "No amount is reported").
  const tulolaji =
    s.sava === null
      ? e('TransactionBasic', [t('SummaryTransactionCode', EI_PALKANMAKSUA)])
      : e('TransactionBasic', [
          t('SummaryTransactionCode', SAVA_YHTEENSA),
          t('Amount', euroa(s.sava)),
        ]);

  return dokumentti(
    'psrtir',
    NIMIAVARUUS,
    e('PayerSummaryReportsRequestToIR', [
      e('DeliveryData', [
        t('Timestamp', aika),
        t('Source', LAHDE),
        t('DeliveryDataType', 101),
        // Tunniste yksilöi maksajan erillisilmoitustietueet (schema 2026 §2.1).
        t('DeliveryId', viite(`E${v}${kk}-${numerot(aika)}`, 'Tietueen tunniste')),
        t('FaultyControl', VIRHEKASITTELY),
        t('ProductionEnvironment', s.tuotanto),
        ...tietueenOsapuolet(tunnus),
        yhteyshenkilot(s.maksaja),
        // Ilmoituspäivä ei saa olla tulevaisuudessa (schema 2026 §2.1); aikaleiman päiväosa. UTC-
        // aikaleiman päivä on aina sama tai aiempi kuin Suomen aikaan.
        t('ReportDate', aika.slice(0, 10)),
        e('Payer', [e('PayerIds', [ytunnusId('Id', tunnus)]), elakevakuutus]),
        e('Reports', [
          e('Report', [
            // Kuukaudelle voi olla vain yksi erillisilmoitus (instr. 2027 s. 9), joten pysyvä
            // kuukausitunniste kohdistaa mahdollisen korvaavan ilmoituksen.
            e('ReportData', [
              t('ActionCode', UUSI_ILMOITUS),
              t('ReportId', viite(`ES-${v}-${kk}`, 'Raportin tunniste')),
            ]),
            e('PaymentMonth', [t('Month', k), t('Year', v)]),
            e('Transactions', [e('Transaction', [tulolaji])]),
          ]),
        ]),
      ]),
    ]),
  );
}
