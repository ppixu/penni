import { createMemoryHistory } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { annaSeuranta, seuraavaTila, voiEdeta, voiPalata } from './historia.js';

describe('seuraavaTila', () => {
  it('PUSH katkaisee eteenpäin-pinon: suurin = uusi indeksi', () => {
    expect(seuraavaTila({ indeksi: 1, suurin: 4 }, 'PUSH', 2)).toEqual({ indeksi: 2, suurin: 2 });
  });

  it('BACK/FORWARD/GO säilyttävät suurimman saavutetun indeksin', () => {
    expect(seuraavaTila({ indeksi: 3, suurin: 3 }, 'BACK', 2)).toEqual({ indeksi: 2, suurin: 3 });
    expect(seuraavaTila({ indeksi: 2, suurin: 3 }, 'FORWARD', 3)).toEqual({
      indeksi: 3,
      suurin: 3,
    });
    expect(seuraavaTila({ indeksi: 3, suurin: 3 }, 'GO', 0)).toEqual({ indeksi: 0, suurin: 3 });
  });

  it('paluu tuntemattomaan eteenpäin-merkintään (esim. uudelleenlatauksen jälkeen) kasvattaa suurinta', () => {
    expect(seuraavaTila({ indeksi: 2, suurin: 2 }, 'FORWARD', 3)).toEqual({
      indeksi: 3,
      suurin: 3,
    });
  });

  it('REPLACE ei muuta pinoa', () => {
    expect(seuraavaTila({ indeksi: 1, suurin: 3 }, 'REPLACE', 1)).toEqual({
      indeksi: 1,
      suurin: 3,
    });
  });
});

describe('voiPalata / voiEdeta', () => {
  it('ensimmäiseltä merkinnältä ei voi palata, viimeiseltä ei voi edetä', () => {
    expect(voiPalata({ indeksi: 0, suurin: 0 })).toBe(false);
    expect(voiEdeta({ indeksi: 0, suurin: 0 })).toBe(false);
    expect(voiPalata({ indeksi: 1, suurin: 2 })).toBe(true);
    expect(voiEdeta({ indeksi: 1, suurin: 2 })).toBe(true);
  });
});

describe('annaSeuranta', () => {
  it('seuraa historiaa: push, back, forward ja uusi push katkaisee', () => {
    const historia = createMemoryHistory({ initialEntries: ['/'] });
    const seuranta = annaSeuranta(historia);
    expect(seuranta.tila()).toEqual({ indeksi: 0, suurin: 0 });

    historia.push('/a');
    historia.push('/b');
    expect(seuranta.tila()).toEqual({ indeksi: 2, suurin: 2 });

    historia.back();
    expect(seuranta.tila()).toEqual({ indeksi: 1, suurin: 2 });
    expect(voiEdeta(seuranta.tila())).toBe(true);

    historia.push('/c');
    expect(seuranta.tila()).toEqual({ indeksi: 2, suurin: 2 });
    expect(voiEdeta(seuranta.tila())).toBe(false);
  });

  it('palauttaa saman seurannan samalle historialle ja ilmoittaa tilaajille', () => {
    const historia = createMemoryHistory({ initialEntries: ['/'] });
    const seuranta = annaSeuranta(historia);
    expect(annaSeuranta(historia)).toBe(seuranta);
    let kutsut = 0;
    const lopeta = seuranta.tilaa(() => kutsut++);
    historia.push('/a');
    lopeta();
    historia.push('/b');
    expect(kutsut).toBe(1);
  });
});
