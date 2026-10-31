import { describe, expect, it } from 'vitest';
import {
  decodeTili,
  decodeTilikausi,
  encodeTili,
  encodeTilikausi,
  normalisoiNimi,
} from './masterData.js';

describe('normalisoiNimi', () => {
  it('wraps a bare string as {fi}', () => {
    expect(normalisoiNimi('Pankki')).toEqual({ fi: 'Pankki' });
  });
  it('passes a multilingual object through', () => {
    expect(normalisoiNimi({ fi: 'Pankki', sv: 'Bank' })).toEqual({ fi: 'Pankki', sv: 'Bank' });
  });
});

describe('tili codec', () => {
  it('round-trips an account, coercing numero to number and normalizing nimi', () => {
    const wire = { numero: '1900', tyyppi: 'ARP', nimi: 'Pankkitili', iban: 'FI21', laajuus: 1 };
    const t = decodeTili(wire);
    expect(t.numero).toBe(1900);
    expect(t.nimi).toEqual({ fi: 'Pankkitili' });
    expect(t.tyyppi).toBe('ARP');
    expect(t.iban).toBe('FI21'); // extra keys preserved
    // encode keeps numero numeric and nimi as the normalized object
    expect(encodeTili(t)).toMatchObject({
      numero: 1900,
      tyyppi: 'ARP',
      nimi: { fi: 'Pankkitili' },
      iban: 'FI21',
      laajuus: 1,
    });
  });

  it('preserves the heading type code "H{n}"', () => {
    const t = decodeTili({ numero: '100', tyyppi: 'H2', nimi: { fi: 'PYSYVÄT VASTAAVAT' } });
    expect(t.tyyppi).toBe('H2');
    expect(encodeTili(t).tyyppi).toBe('H2');
  });
});

describe('tilikausi codec', () => {
  it('round-trips a fiscal year, preserving extra keys', () => {
    const wire = { alkaa: '2025-01-01', loppuu: '2025-12-31', vahvistettu: true };
    expect(decodeTilikausi(wire)).toEqual(wire);
    expect(encodeTilikausi(decodeTilikausi(wire))).toEqual(wire);
  });
});
