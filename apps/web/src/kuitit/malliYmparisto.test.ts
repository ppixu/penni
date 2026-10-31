import { MALLI_ISANTA } from '@penni/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { annaMalliYmparisto } from './malliYmparisto.js';

afterEach(() => {
  window.penni = undefined;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('annaMalliYmparisto', () => {
  it('selaimessa: selaimen välimuisti ja lupa localStoragessa', async () => {
    const y = annaMalliYmparisto();
    expect(y.latausAsetukset).toEqual({ selainValimuisti: true });
    expect(await y.onkoLupa()).toBe(false);
    await y.annaLupa();
    expect(await y.onkoLupa()).toBe(true);
  });

  it('työpöydällä: mallit pääprosessin kautta ja lupa sillalta', async () => {
    const malliLupa = vi.fn().mockResolvedValue(true);
    const annaMalliLupa = vi.fn().mockResolvedValue(undefined);
    window.penni = {
      malliLupa,
      annaMalliLupa,
    } as unknown as typeof window.penni;
    const y = annaMalliYmparisto();
    expect(y.latausAsetukset).toEqual({
      kautta: MALLI_ISANTA,
      selainValimuisti: false,
    });
    expect(await y.onkoLupa()).toBe(true);
    await y.annaLupa();
    expect(annaMalliLupa).toHaveBeenCalledOnce();
  });

  it('estetty localStorage ei kaada: lupaa ei ole', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('estetty');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('estetty');
    });
    const y = annaMalliYmparisto();
    await expect(y.annaLupa()).resolves.toBeUndefined();
    expect(await y.onkoLupa()).toBe(false);
  });
});
