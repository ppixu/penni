import { describe, expect, it } from 'vitest';
import {
  EIALV,
  KAYTETYT,
  Maksutapa,
  TositeTila,
  TositeTyyppi,
  VientiTyyppi,
  onKirjanpidossa,
  sailytaKumppani,
} from './enums.js';

describe('voucher enums (verbatim)', () => {
  it('TositeTyyppi values', () => {
    expect(TositeTyyppi.MUU).toBe(0);
    expect(TositeTyyppi.MENO).toBe(100);
    expect(TositeTyyppi.MYYNTILASKU).toBe(210);
    expect(TositeTyyppi.SIIRTO).toBe(300);
    expect(TositeTyyppi.TILINAVAUS).toBe(9010);
    expect(TositeTyyppi.ALVLASKELMA).toBe(9100);
    expect(TositeTyyppi.YKSITYISTILIEN_PAATTAMINEN).toBe(9040);
  });
  it('VientiTyyppi values', () => {
    expect(VientiTyyppi.KIRJAUS).toBe(1);
    expect(VientiTyyppi.VASTAKIRJAUS).toBe(2);
    expect(VientiTyyppi.BRUTTOOIKAISU).toBe(91091);
    expect(VientiTyyppi.POISTO).toBe(99100);
  });
  it('TositeTila values (send-states straddle KIRJANPIDOSSA)', () => {
    expect(TositeTila.POISTETTU).toBe(0);
    expect(TositeTila.LUONNOS).toBe(50);
    expect(TositeTila.VALMISLASKU).toBe(80);
    expect(TositeTila.KIRJANPIDOSSA).toBe(100);
    expect(TositeTila.LAHETETAAN).toBe(101);
    expect(TositeTila.LAHETYSVIRHE).toBe(102);
    expect(TositeTila.MUISTUTETTU).toBe(120);
  });
  it('KAYTETYT / EIALV constants', () => {
    expect(KAYTETYT).toBe(91);
    expect(EIALV).toBe(0);
  });
});

describe('voucher helpers', () => {
  it('onKirjanpidossa is tila >= 100', () => {
    expect(onKirjanpidossa(TositeTila.LUONNOS)).toBe(false);
    expect(onKirjanpidossa(TositeTila.VALMISLASKU)).toBe(false);
    expect(onKirjanpidossa(TositeTila.KIRJANPIDOSSA)).toBe(true);
    expect(onKirjanpidossa(TositeTila.LAHETETAAN)).toBe(true);
  });
  it('sailytaKumppani only for 100 <= tyyppi < 300', () => {
    expect(sailytaKumppani(TositeTyyppi.MUU)).toBe(false);
    expect(sailytaKumppani(TositeTyyppi.MENO)).toBe(true);
    expect(sailytaKumppani(TositeTyyppi.MYYNTILASKU)).toBe(true);
    expect(sailytaKumppani(TositeTyyppi.SIIRTO)).toBe(false);
  });
});

describe('Maksutapa', () => {
  it('has the three 1d payment methods (subset of legacy Lasku::Maksutapa)', () => {
    expect(Maksutapa.LASKU).toBe(0);
    expect(Maksutapa.KATEINEN).toBe(1);
    expect(Maksutapa.KORTTIMAKSU).toBe(5);
  });
});
