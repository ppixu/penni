import { describe, expect, it } from 'vitest';
import { env, luoTestikirja } from '../testi/kirja.js';
import { alvTilanne } from './alvTilanne.js';

describe('alvTilanne', () => {
  it('defaults the period to current fiscal year start .. today', async () => {
    const tulos = (await alvTilanne.suorita((await luoTestikirja()).client, {}, env)) as {
      alkupvm: string;
      loppupvm: string;
    };
    expect(tulos.alkupvm).toBe('2026-01-01');
    expect(tulos.loppupvm).toBe('2026-08-15');
  });

  it('reports alv liability and zero maksettava with no alv-coded viennit', async () => {
    const tulos = (await alvTilanne.suorita((await luoTestikirja()).client, {}, env)) as {
      alvVelvollinen: boolean;
      alvIlmoitettu: string | null;
      maksettava: { sentit: number; eur: string };
      koodit: unknown[];
    };
    expect(tulos.alvVelvollinen).toBe(true);
    expect(tulos.alvIlmoitettu).toBeNull();
    expect(tulos.maksettava).toEqual({ sentit: 0, eur: '0,00\u00a0€' });
    expect(tulos.koodit).toEqual([]);
  });

  it('honors an explicit alkupvm/loppupvm', async () => {
    const tulos = (await alvTilanne.suorita(
      (
        await luoTestikirja()
      ).client,
      { alkupvm: '2026-02-01', loppupvm: '2026-02-28' },
      env,
    )) as { alkupvm: string; loppupvm: string };
    expect(tulos.alkupvm).toBe('2026-02-01');
    expect(tulos.loppupvm).toBe('2026-02-28');
  });

  it('rejects a malformed alkupvm via zod', async () => {
    await expect(
      alvTilanne.suorita((await luoTestikirja()).client, { alkupvm: '1.2.2026' }, env),
    ).rejects.toThrow();
  });
});
