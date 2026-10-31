import { describe, expect, it } from 'vitest';
import { type Aliasryhma, merkitsevatSanat, nimetTasmaavat, normalisoiNimi } from './nimi.js';

describe('normalisoiNimi', () => {
  it('pienaakkostaa, riisuu ääkköset ja muuttaa välimerkit väleiksi', () => {
    expect(normalisoiNimi('GitHub, Inc.')).toBe('github inc');
    expect(normalisoiNimi('VERKKOKAUPPA.COM MYYMALAT')).toBe('verkkokauppa com myymalat');
    expect(normalisoiNimi('Mallisivu Systems OÜ')).toBe('mallisivu systems ou');
  });
});

describe('merkitsevatSanat', () => {
  it('pudottaa yritysmuodot, yleissanat ja lyhyet sanat', () => {
    expect(merkitsevatSanat('GITHUB, INC.')).toEqual(['github']);
    expect(merkitsevatSanat('MALLISIVU SYSTEMS OU')).toEqual(['mallisivu']);
    expect(merkitsevatSanat('CURSOR, AI POWERED IDE')).toEqual(['cursor', 'ide']);
  });
});

describe('nimetTasmaavat', () => {
  it('täsmää kun merkitsevä sana on yhteinen', () => {
    expect(nimetTasmaavat('MALLISIVU SYSTEMS OU', 'Mallisivu Systems OÜ')).toBe(true);
    expect(nimetTasmaavat('CURSOR, AI POWERED IDE', 'Cursor')).toBe(true);
    expect(nimetTasmaavat('GITHUB, INC.', 'GitHub, Inc.')).toBe(true);
  });

  it('ei täsmää kun ei yhteistä merkitsevää sanaa', () => {
    // Pilvipalvelun pankkinimi (ESIMERKKI.AI SUBSCRIPTION) ei jaa sanaa myyjän (Pilvipalvelu) kanssa.
    expect(nimetTasmaavat('ESIMERKKI.AI SUBSCRIPTION', 'Pilvipalvelu, Ltd')).toBe(false);
    expect(nimetTasmaavat('GitHub, Inc.', 'Cursor')).toBe(false);
  });

  it('ei täsmää pelkän yleissanan perusteella', () => {
    // Molemmilla 'systems', mutta se on yleissana -> ei riitä.
    expect(nimetTasmaavat('Foobar Systems Oy', 'Bazqux Systems Ab')).toBe(false);
  });

  it('täsmää aliasryhmän kautta (brändi ↔ juridinen nimi)', () => {
    const aliakset: Aliasryhma[] = [['cursor', 'anysphere']];
    // Pankki käyttää brändiä (CURSOR), kuitti juridista nimeä (Anysphere, Inc.).
    expect(nimetTasmaavat('CURSOR, AI POWERED IDE', 'Anysphere, Inc.', aliakset)).toBe(true);
    // Symmetrinen: kumpi tahansa suunta.
    expect(nimetTasmaavat('Anysphere, Inc.', 'CURSOR, AI POWERED IDE', aliakset)).toBe(true);
    // Ilman aliasta ei täsmää.
    expect(nimetTasmaavat('CURSOR, AI POWERED IDE', 'Anysphere, Inc.')).toBe(false);
  });

  it('ei ristiintäsmää eri aliasryhmiä', () => {
    const aliakset: Aliasryhma[] = [
      ['cursor', 'anysphere'],
      ['mallisivu', 'esimerkkibot'],
    ];
    expect(nimetTasmaavat('Anysphere, Inc.', 'Esimerkkibot.ai', aliakset)).toBe(false);
  });
});
