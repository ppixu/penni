import { describe, expect, it } from 'vitest';
import { bic, ibanModulo, muotoileIban, pankki, tarkistaIban } from './iban.js';

describe('iban', () => {
  it('tarkistaIban — mod-97 (spaces sallittu), FI-pituus 18', () => {
    expect(tarkistaIban('FI5847000000000012')).toBe(true);
    expect(tarkistaIban('FI58 4700 0000 0000 12')).toBe(true); // spaces stripped
    expect(tarkistaIban('FI5847000000000013')).toBe(false); // bad check
    expect(tarkistaIban('FI584700000000001')).toBe(false); // 17 chars -> FI must be 18
    expect(tarkistaIban('FI2112345600000785')).toBe(true);
  });

  it('ibanModulo — valid iff 1', () => {
    expect(ibanModulo('FI5847000000000012')).toBe(1);
    expect(ibanModulo('FI5847000000000013')).toBe(28);
  });

  it('muotoileIban — space after every 4th char', () => {
    expect(muotoileIban('FI2112345600000785')).toBe('FI21 1234 5600 0007 85');
  });

  it('bic / pankki — first-match-wins prefix chain', () => {
    expect(bic('FI2112345600000785')).toBe('NDEAFIHH'); // tunnus 1... -> Nordea
    expect(pankki('FI2112345600000785')).toBe('Nordea');
    expect(bic('FI4471300000000019')).toBe('CITIFIHX'); // tunnus 713... -> Citibank
    // mid(4) -> BBAN 470..., prefix 47 -> POP Pankki (legacy iban.cpp:58-59, verbatim mid(4))
    expect(bic('FI5847000000000012')).toBe('POPFFI22');
    expect(bic('XX00')).toBe(''); // non-FI -> empty
  });
});
