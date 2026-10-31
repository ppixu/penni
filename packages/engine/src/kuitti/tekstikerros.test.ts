import { describe, expect, it } from 'vitest';
import { onkoTekstia } from './tekstikerros.js';

describe('onkoTekstia', () => {
  it('pitää vähintään 20 merkin tekstiä tekstikerroksena', () => {
    expect(onkoTekstia('Kahvila Aamu Oy  Yhteensä 6,40')).toBe(true);
  });
  it('pitää tyhjää tai lähes tyhjää skannauksena', () => {
    expect(onkoTekstia('')).toBe(false);
    expect(onkoTekstia('   \n  1 \n')).toBe(false);
  });
});
