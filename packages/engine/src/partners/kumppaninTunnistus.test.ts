import { describe, expect, it } from 'vitest';
import type { Kumppani } from './kumppani.js';
import { etsiKumppaniNimella, tositteenKumppani } from './kumppaninTunnistus.js';

const KUMPPANIT: Kumppani[] = [
  { id: 3, nimi: 'Github' },
  { id: 37, nimi: 'Cursor' },
  { id: 39, nimi: 'Cursor' },
  { id: 12, nimi: 'EA' },
  { id: 20, nimi: 'Art For All ry' },
  { id: 2, nimi: 'Revontuli Oy' },
  { id: 33, nimi: 'X' },
  { id: 41, nimi: 'Proshop' },
  { id: 29, nimi: 'Rajala Proshop' },
];

describe('etsiKumppaniNimella', () => {
  it('löytää kumppanin kirjoitusasusta ja yritysmuodosta riippumatta', () => {
    expect(etsiKumppaniNimella('GitHub', KUMPPANIT)?.id).toBe(3);
    expect(etsiKumppaniNimella('  GITHUB, Inc. ', KUMPPANIT)?.id).toBe(3);
    expect(etsiKumppaniNimella('art for all', KUMPPANIT)?.id).toBe(20);
  });

  it('otsikko saa jatkua kumppanin nimen jälkeen', () => {
    expect(etsiKumppaniNimella('Github developer plan', KUMPPANIT)?.id).toBe(3);
    expect(etsiKumppaniNimella('Revontuli heinäkuu (lasku 311)', KUMPPANIT)?.id).toBe(2);
    expect(etsiKumppaniNimella('X Ads', KUMPPANIT)?.id).toBe(33);
    expect(etsiKumppaniNimella('EA Games', KUMPPANIT)?.id).toBe(12);
  });

  it('ei täsmää nimen keskeltä eikä osittaiseen sanaan', () => {
    expect(etsiKumppaniNimella('YEL Github', KUMPPANIT)).toBeUndefined();
    expect(etsiKumppaniNimella('Githubber', KUMPPANIT)).toBeUndefined();
    expect(etsiKumppaniNimella('Xbox', KUMPPANIT)).toBeUndefined();
    expect(etsiKumppaniNimella('Art', KUMPPANIT)).toBeUndefined();
    expect(etsiKumppaniNimella('', KUMPPANIT)).toBeUndefined();
    expect(etsiKumppaniNimella('Inc', KUMPPANIT)).toBeUndefined();
  });

  it('pisin nimi voittaa, samannimisistä pienin id', () => {
    expect(etsiKumppaniNimella('Rajala Proshop tilaus', KUMPPANIT)?.id).toBe(29);
    expect(etsiKumppaniNimella('Proshop tilaus', KUMPPANIT)?.id).toBe(41);
    expect(etsiKumppaniNimella('cursor pro', KUMPPANIT)?.id).toBe(37);
    expect(etsiKumppaniNimella('cursor', [...KUMPPANIT].reverse())?.id).toBe(37);
  });
});

describe('tositteenKumppani', () => {
  it('tallennettu kumppani voittaa otsikon', () => {
    expect(tositteenKumppani({ kumppani: 12, otsikko: 'GitHub' }, KUMPPANIT)).toBe(12);
  });

  it('kumppaniton tosite tunnistetaan otsikosta', () => {
    expect(tositteenKumppani({ otsikko: 'GitHub' }, KUMPPANIT)).toBe(3);
    expect(tositteenKumppani({ otsikko: 'Kahvi' }, KUMPPANIT)).toBeUndefined();
    expect(tositteenKumppani({}, KUMPPANIT)).toBeUndefined();
  });
});
