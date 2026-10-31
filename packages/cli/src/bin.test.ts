import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { luoTestikirja, siemennaTositteet } from './testi/kirja.js';

const bin = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe('cli bin smoke test', () => {
  it('the built bin answers ohje --json', () => {
    const ulos = execFileSync(process.execPath, [bin, 'ohje', '--json'], { encoding: 'utf8' });
    const dump = JSON.parse(ulos);
    expect(dump.tyokalut.some((t: { nimi: string }) => t.nimi === 'tosite_luonnos')).toBe(true);
  });

  it('the built bin reads a fixture book end to end', async () => {
    const polku = luoTestikirja();
    await siemennaTositteet(polku);

    const ulos = execFileSync(process.execPath, [bin, '--kirja', polku, 'perustiedot', '--json'], {
      encoding: 'utf8',
    });
    expect(JSON.parse(ulos).nimi).toBe('Testi Oy');
  });
});
