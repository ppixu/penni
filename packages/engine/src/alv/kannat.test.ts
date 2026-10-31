import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import {
  alvKannat,
  bruttoNetosta,
  keskimainenAlv,
  nettoBrutosta,
  veroBrutosta,
  yleinenAlv,
} from './kannat.js';

const c = (n: number): Cents => n as Cents;

describe('alv/kannat', () => {
  it('yleinen verokanta: 24% ennen 2024-09-01, 25.5% siitä alkaen', () => {
    expect(yleinenAlv('2024-08-31')).toBe(24);
    expect(yleinenAlv('2024-09-01')).toBe(25.5);
    expect(yleinenAlv('2026-06-30')).toBe(25.5);
  });

  it('keskimääräinen verokanta: 14% ennen 2026-01-01, 13.5% siitä alkaen', () => {
    expect(keskimainenAlv('2025-12-31')).toBe(14);
    expect(keskimainenAlv('2026-01-01')).toBe(13.5);
  });

  it('alvKannat listaa voimassa olevat kannat päivälle', () => {
    expect(alvKannat('2026-06-30')).toEqual([25.5, 13.5, 10]);
    expect(alvKannat('2024-01-01')).toEqual([24, 14, 10]);
  });

  it('netto/brutto/vero — kokonaissentit, yksi pyöristysraja', () => {
    // 25.5% on 100,00 € brutto (10000 snt): netto = round(10000*100/125.5) = 7968; vero = 2032
    expect(nettoBrutosta(c(10000), 25.5)).toBe(7968);
    expect(veroBrutosta(c(10000), 25.5)).toBe(2032);
    // net 10000 -> brutto = round(10000*125.5/100) = 12550
    expect(bruttoNetosta(c(10000), 25.5)).toBe(12550);
    // 0% -> identity
    expect(nettoBrutosta(c(5000), 0)).toBe(5000);
    expect(veroBrutosta(c(5000), 0)).toBe(0);
  });
});
