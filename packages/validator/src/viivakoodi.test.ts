import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { sepaQr, virtuaaliviivakoodi } from './viivakoodi.js';

const c = (n: number): Cents => n as Cents;

describe('viivakoodi', () => {
  it('virtuaaliviivakoodi v4 — 54 merkkiä, oikea kenttäpakkaus', () => {
    const koodi = virtuaaliviivakoodi({
      iban: 'FI2112345600000785',
      maara: c(48225),
      viite: '3012396',
    });
    expect(koodi).toHaveLength(54);
    // 4 | 2112345600000785 | 00048225 | 000 | 00000000000003012396 | 000000
    expect(koodi).toBe('421123456000007850004822500000000000000003012396000000');
  });

  it('virtuaaliviivakoodi v5 — RF-viite', () => {
    const koodi = virtuaaliviivakoodi({
      iban: 'FI2112345600000785',
      maara: c(48225),
      viite: 'RF063012396',
      rf: true,
    });
    expect(koodi).toHaveLength(54);
    // 5 | 2112345600000785 | 00048225 | 06 | 000000000000003012396 | 000000
    expect(koodi).toBe('521123456000007850004822506000000000000003012396000000');
  });

  it('virtuaaliviivakoodi — hylkää epäkelvon summan', () => {
    expect(virtuaaliviivakoodi({ iban: 'FI2112345600000785', maara: c(0), viite: '3012396' })).toBe(
      '',
    );
  });

  it.each(['LT121000011101001000', 'DE89370400440532013000', 'EE382200221020145685'])(
    'virtuaaliviivakoodi — ei-suomalainen IBAN %s → tyhjä',
    (iban) => {
      expect(virtuaaliviivakoodi({ iban, maara: c(48225), viite: '3012396' })).toBe('');
    },
  );

  it('virtuaaliviivakoodi — suomalainen IBAN välilyönneillä ja pienillä kirjaimilla toimii', () => {
    expect(
      virtuaaliviivakoodi({ iban: 'fi21 1234 5600 0007 85', maara: c(48225), viite: '3012396' }),
    ).toBe('421123456000007850004822500000000000000003012396000000');
  });

  it('sepaQr — BCD/SCT payload', () => {
    const qr = sepaQr({
      iban: 'FI2112345600000785',
      saaja: 'Yritys Oy',
      maara: c(48225),
      viite: '3012396',
      erapvm: '2026-06-30',
    });
    expect(qr).toBe(
      'BCD\n001\n1\nSCT\nNDEAFIHH\nYritys Oy\nFI2112345600000785\nEUR482.25\n\n3012396\n\nReqdExctnDt/2026-06-30',
    );
  });
});
