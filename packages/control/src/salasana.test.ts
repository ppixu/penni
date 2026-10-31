import { describe, expect, it } from 'vitest';
import { hashaaSalasana, tarkistaSalasana } from './salasana.js';

describe('salasana', () => {
  it('tiiviste kelpaa oikealla salasanalla ja hylkää väärän', async () => {
    const koodattu = await hashaaSalasana('salasana123');
    expect(koodattu.startsWith('scrypt$')).toBe(true);
    expect(await tarkistaSalasana('salasana123', koodattu)).toBe(true);
    expect(await tarkistaSalasana('vaara', koodattu)).toBe(false);
  });

  it('sama salasana tuottaa eri tiivisteen (satunnaissuola)', async () => {
    const a = await hashaaSalasana('sama-salasana');
    const b = await hashaaSalasana('sama-salasana');
    expect(a).not.toBe(b);
    expect(await tarkistaSalasana('sama-salasana', a)).toBe(true);
    expect(await tarkistaSalasana('sama-salasana', b)).toBe(true);
  });

  it('tarkistaSalasana palauttaa false muodottomalle tiivisteelle', async () => {
    expect(await tarkistaSalasana('x', 'roska')).toBe(false);
  });
});
