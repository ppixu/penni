import { describe, expect, it } from 'vitest';
import { kirjoitaTiliLista, lueTiliLista } from './tilisuosio.js';

describe('tililistat', () => {
  it('lukee Kitsaksen muodon ja ohittaa tyhjän joukon "0":n ja roskan', () => {
    expect([...lueTiliLista('3000,8430,0, 1910,abc,')]).toEqual([3000, 8430, 1910]);
    expect(lueTiliLista(undefined).size).toBe(0);
    expect(lueTiliLista('0').size).toBe(0);
  });

  it('kirjoittaa nousevasti ilman toistoja', () => {
    expect(kirjoitaTiliLista([3000, 1910, 3000])).toBe('1910,3000');
    expect(kirjoitaTiliLista([])).toBe('');
  });
});
