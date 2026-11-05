import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { PalkatVirhe } from '../taulukot.js';
import { type ErillisilmoitusSyote, erillisilmoitusXml } from './erillisilmoitus.js';
import { xsdVirheet } from './xsd.testapu.js';

/* Keksitty maksaja; ei henkilötietoja. */

const SYOTE: ErillisilmoitusSyote = {
  kuukausi: '2026-10',
  sava: 5768 as Cents,
  maksaja: {
    ytunnus: '1234567-1',
    nimi: 'Keksitty Oy',
    yhteyshenkilo: { nimi: 'Keksi Yhteyshenkilö', puhelin: '040 000 0000' },
  },
  aikaleima: '2026-11-03T08:00:00+02:00',
  tuotanto: false,
};

const arvo = (xml: string, nimi: string) => new RegExp(`<${nimi}>([^<]*)</${nimi}>`).exec(xml)?.[1];
const arvot = (xml: string, nimi: string) =>
  [...xml.matchAll(new RegExp(`<${nimi}>([^<]*)</${nimi}>`, 'g'))].map((m) => m[1]);

describe('erillisilmoitusXml', () => {
  it('erillisilmoitus validoituu: sava 57,68', async () => {
    const xml = erillisilmoitusXml(SYOTE);
    expect(await xsdVirheet(xml, '2025', 'PayerSummaryReportsToIR.xsd')).toEqual([]);
    expect(await xsdVirheet(xml, '2027', 'PayerSummaryReportsToIR.xsd')).toEqual([]);
    expect(arvo(xml, 'DeliveryDataType')).toBe('101');
    expect(arvo(xml, 'Timestamp')).toBe('2026-11-03T08:00:00+02:00');
    expect(arvo(xml, 'ReportDate')).toBe('2026-11-03');
    expect(arvo(xml, 'DeliveryId')).toBe('E202610-202611030800000200');
    expect(arvo(xml, 'ReportId')).toBe('ES-2026-10');
    expect(arvo(xml, 'FaultyControl')).toBe('2');
    expect(arvo(xml, 'ProductionEnvironment')).toBe('false');
    expect([arvo(xml, 'Month'), arvo(xml, 'Year')]).toEqual(['10', '2026']);
    expect(arvot(xml, 'SummaryTransactionCode')).toEqual(['102']);
    expect(arvo(xml, 'Amount')).toBe('57.68');
    expect(xml).not.toContain('Signature');
    expect(xml).not.toContain('PensionInsurances');
  }, 60_000);

  it('erillisilmoitus validoituu: ei palkanmaksua (101, ei summaa)', async () => {
    const xml = erillisilmoitusXml({ ...SYOTE, kuukausi: '2026-01', sava: null });
    expect(await xsdVirheet(xml, '2025', 'PayerSummaryReportsToIR.xsd')).toEqual([]);
    expect(await xsdVirheet(xml, '2027', 'PayerSummaryReportsToIR.xsd')).toEqual([]);
    expect(arvot(xml, 'SummaryTransactionCode')).toEqual(['101']);
    expect(xml).not.toContain('<Amount>');
    expect([arvo(xml, 'Month'), arvo(xml, 'Year')]).toEqual(['1', '2026']);
  }, 60_000);

  it('ei palkanmaksua: maksajan TyEL-vakuutus mukaan, kun se on asetuksissa', async () => {
    const xml = erillisilmoitusXml({
      ...SYOTE,
      sava: null,
      asetukset: {
        tilapainenTyonantaja: false,
        tvrVapautus: false,
        tyelYhtio: '54',
        tyelSopimus: '5412345678',
      },
    });
    expect([arvo(xml, 'PensionProvIdCode'), arvo(xml, 'PensionPolicyNo')]).toEqual([
      '54',
      '5412345678',
    ]);
    expect(await xsdVirheet(xml, '2027', 'PayerSummaryReportsToIR.xsd')).toEqual([]);
  }, 60_000);

  it('deterministinen ja tuotantolippu', () => {
    expect(erillisilmoitusXml(SYOTE)).toBe(erillisilmoitusXml(SYOTE));
    expect(arvo(erillisilmoitusXml({ ...SYOTE, tuotanto: true }), 'ProductionEnvironment')).toBe(
      'true',
    );
  });

  it('virheellinen syöte -> PalkatVirhe SYOTE', () => {
    for (const s of [
      { ...SYOTE, kuukausi: '2026-13' },
      { ...SYOTE, sava: -1 as Cents },
      { ...SYOTE, sava: 1.5 as Cents },
      { ...SYOTE, aikaleima: '2026-11-03 08:00' },
      { ...SYOTE, maksaja: { ...SYOTE.maksaja, ytunnus: '123' } },
    ]) {
      expect(() => erillisilmoitusXml(s)).toThrow(PalkatVirhe);
    }
  });
});
