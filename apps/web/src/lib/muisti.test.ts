import { lueTositeSuodattimet } from '@/tositteet/suodattimet';
import type { SuodatinSilta } from '@penni/tuonti';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alustaMuisti, lueMuisti, muistinAvain, tallennaMuisti } from './muisti';

function valeSilta(alku: unknown = {}) {
  return {
    suodattimet: vi.fn(async () => alku as Record<string, unknown>),
    tallennaSuodatin: vi.fn(async (_nakyma: string, _arvo: unknown) => {}),
  } satisfies SuodatinSilta;
}

afterEach(async () => {
  await alustaMuisti(null);
  window.penni = undefined;
  vi.restoreAllMocks();
});

describe('muisti selaimessa (ei siltaa)', () => {
  it('lukee ja kirjoittaa localStorageen kuten ennenkin', () => {
    tallennaMuisti('tositteet', { bucket: 'luonnos' });
    expect(window.localStorage.getItem(muistinAvain('tositteet'))).toBe('{"bucket":"luonnos"}');
    expect(lueMuisti('tositteet')).toEqual({ bucket: 'luonnos' });
  });

  it('alustus ilman siltaa jättää localStoragen käyttöön', async () => {
    await alustaMuisti();
    tallennaMuisti('tositteet', 1);
    expect(window.localStorage.getItem(muistinAvain('tositteet'))).toBe('1');
  });
});

describe('muisti työpöydällä (silta asetukset.json:iin)', () => {
  it('lataa valinnat kerran ja lukee ne synkronisesti välimuistista', async () => {
    const silta = valeSilta({ tositteet: { bucket: 'poistetut' } });
    await alustaMuisti(silta);
    expect(lueMuisti('tositteet')).toEqual({ bucket: 'poistetut' });
    expect(lueMuisti('raportit')).toBeUndefined();
    expect(silta.suodattimet).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(muistinAvain('tositteet'))).toBeNull();
  });

  it('käyttää oletuksena sivulle annettua siltaa (window.penni)', async () => {
    const silta = valeSilta({ tositteet: { laji: 'menot' } });
    window.penni = silta as unknown as NonNullable<typeof window.penni>;
    await alustaMuisti();
    expect(lueMuisti('tositteet')).toEqual({ laji: 'menot' });
  });

  it('kirjoittaa välimuistiin ja sillalle, ei localStorageen', async () => {
    const silta = valeSilta();
    await alustaMuisti(silta);
    tallennaMuisti('tositteet', { bucket: 'luonnos' });
    expect(lueMuisti('tositteet')).toEqual({ bucket: 'luonnos' });
    expect(silta.tallennaSuodatin).toHaveBeenCalledWith('tositteet', { bucket: 'luonnos' });
    expect(window.localStorage.getItem(muistinAvain('tositteet'))).toBeNull();
  });

  it('palautettu arvo on kopio: sen muokkaus ei muuta muistia', async () => {
    await alustaMuisti(valeSilta({ tositteet: { bucket: 'luonnos' } }));
    (lueMuisti('tositteet') as Record<string, unknown>).bucket = 'x';
    expect(lueMuisti('tositteet')).toEqual({ bucket: 'luonnos' });
  });

  it('latauksen epäonnistuessa varoittaa ja toimii oletuksilla; valinta pätee istunnon ajan', async () => {
    const varoitus = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const silta = valeSilta();
    silta.suodattimet.mockRejectedValueOnce(new Error('IPC-kutsu hylättiin'));
    await alustaMuisti(silta);
    expect(varoitus).toHaveBeenCalled();
    expect(lueMuisti('tositteet')).toBeUndefined();
    tallennaMuisti('tositteet', { bucket: 'luonnos' });
    expect(lueMuisti('tositteet')).toEqual({ bucket: 'luonnos' });
    expect(silta.tallennaSuodatin).toHaveBeenCalledOnce();
  });

  it('kirjoituksen epäonnistuminen sillalla varoittaa eikä kaada; arvo pysyy muistissa', async () => {
    const varoitus = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const silta = valeSilta();
    silta.tallennaSuodatin.mockRejectedValueOnce(new Error('levy täynnä'));
    await alustaMuisti(silta);
    expect(() => tallennaMuisti('tositteet', { laji: 'tulot' })).not.toThrow();
    await vi.waitFor(() => expect(varoitus).toHaveBeenCalled());
    expect(lueMuisti('tositteet')).toEqual({ laji: 'tulot' });

    silta.tallennaSuodatin.mockImplementationOnce(() => {
      throw new Error('silta rikki');
    });
    expect(() => tallennaMuisti('tositteet', { laji: 'menot' })).not.toThrow();
    expect(lueMuisti('tositteet')).toEqual({ laji: 'menot' });
  });

  it('sietää vioittuneen sillan vastauksen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const roska of [null, 42, 'x', ['a']]) {
      await alustaMuisti(valeSilta(roska));
      expect(lueMuisti('tositteet')).toBeUndefined();
    }
  });

  it('tallennettu arvo tulkitaan kuten ennenkin: rikkinäinen kenttä putoaa oletukseen', async () => {
    await alustaMuisti(valeSilta({ tositteet: { bucket: 'roska', laji: 'tulot', jarj: 7 } }));
    const s = lueTositeSuodattimet();
    expect(s.bucket).toBe('kirjanpidossa');
    expect(s.laji).toBe('tulot');
    expect(s.jarj).toBeUndefined();
  });
});
