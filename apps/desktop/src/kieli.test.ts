import { describe, expect, it } from 'vitest';
import { SOVELLUKSEN_KIELI, asetaSovelluksenKieli } from './kieli.js';

describe('asetaSovelluksenKieli', () => {
  it('asettaa Chromiumin kieleksi suomen (päivät muodossa p.k.vvvv)', () => {
    const kutsut: [string, string | undefined][] = [];
    asetaSovelluksenKieli({
      commandLine: {
        appendSwitch: (kytkin: string, arvo?: string) => {
          kutsut.push([kytkin, arvo]);
        },
      },
    });
    expect(SOVELLUKSEN_KIELI).toBe('fi-FI');
    expect(kutsut).toContainEqual(['lang', 'fi-FI']);
  });
});
