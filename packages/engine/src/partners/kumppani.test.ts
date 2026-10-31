import { describe, it } from 'vitest';
import type { UusiKumppani } from './kumppani.js';

describe('UusiKumppani type checks', () => {
  it('requires nimi field', () => {
    // @ts-expect-error nimi is required and cannot be omitted
    const _noNimi: UusiKumppani = { alvtunnus: 'FI123' };
    void _noNimi;
  });

  it('allows id to be optional', () => {
    const withoutId: UusiKumppani = { nimi: 'Partner' };
    const withId: UusiKumppani = { id: 7, nimi: 'Partner' };
    void withoutId;
    void withId;
  });

  it('allows unmapped Kitsas keys to round-trip', () => {
    const withExtras: UusiKumppani = {
      nimi: 'Partner',
      alvtunnus: 'FI123',
      lisatiedot: 'Memo',
      laskutapa: 2,
      ovt: '003712345671',
    };
    void withExtras;
  });
});
