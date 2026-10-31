import type { KysyTapahtuma } from '@penni/kysy';
import { KysyVirhe } from '@penni/kysy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KirjaIstunto } from './kirjaIstunto.js';

const { kysyMock, varmistaKysyOllamaMock } = vi.hoisted(() => ({
  kysyMock: vi.fn(),
  varmistaKysyOllamaMock: vi.fn(),
}));

vi.mock('@penni/kysy', async () => {
  const oikea = await vi.importActual<typeof import('@penni/kysy')>('@penni/kysy');
  return {
    ...oikea,
    kysy: kysyMock,
    varmistaKysyOllama: varmistaKysyOllamaMock,
    luoOllamaKutsu: vi.fn(() => vi.fn()),
  };
});

const { kysyKasittelijat, peruutaKaikkiKysyt } = await import('./kysySilta.js');

/** Fake session — only `storage.getAsetukset` is exercised by these handlers. */
function fakeIstunto(asetukset: Record<string, string> = {}): KirjaIstunto {
  return {
    storage: { getAsetukset: async () => asetukset },
  } as unknown as KirjaIstunto;
}

/** Deferred promise, so a test can pause a fake generator mid-loop and resume it explicitly. */
function odottaja<T>(): { promise: Promise<T>; ratkaise: (arvo: T) => void } {
  let ratkaise!: (arvo: T) => void;
  const promise = new Promise<T>((r) => {
    ratkaise = r;
  });
  return { promise, ratkaise };
}

afterEach(() => {
  peruutaKaikkiKysyt();
  vi.clearAllMocks();
});

describe('kysyTila', () => {
  it('palauttaa ei-ok kun kirjaa ei ole auki', async () => {
    const k = kysyKasittelijat(() => null);
    expect(await k.kysyTila()).toEqual({ ok: false, viesti: 'Avaa ensin kirjanpito.' });
    expect(varmistaKysyOllamaMock).not.toHaveBeenCalled();
  });

  it('palauttaa mallin kun Ollama on valmis', async () => {
    varmistaKysyOllamaMock.mockResolvedValue(undefined);
    const k = kysyKasittelijat(() => fakeIstunto({ KysyMalli: 'qwen3.5:7b' }));
    expect(await k.kysyTila()).toEqual({ ok: true, malli: 'qwen3.5:7b' });
    expect(varmistaKysyOllamaMock).toHaveBeenCalledWith(
      expect.objectContaining({ malli: 'qwen3.5:7b' }),
    );
  });

  it('käyttää oletusmallia kun KysyMalli puuttuu tai on tyhjä', async () => {
    varmistaKysyOllamaMock.mockResolvedValue(undefined);
    const k = kysyKasittelijat(() => fakeIstunto({ KysyMalli: '  ' }));
    expect(await k.kysyTila()).toEqual({ ok: true, malli: 'qwen3.5:2b' });
  });

  it('välittää KysyVirheen viestin ja korjauksen', async () => {
    varmistaKysyOllamaMock.mockRejectedValue(
      new KysyVirhe('kutsu', 'Ollamaan ei saatu yhteyttä.', 'ollama serve'),
    );
    const k = kysyKasittelijat(() => fakeIstunto());
    expect(await k.kysyTila()).toEqual({
      ok: false,
      viesti: 'Ollamaan ei saatu yhteyttä.',
      korjaus: 'ollama serve',
    });
  });
});

describe('kysyKysy', () => {
  it('ajaa silmukan ja välittää molemmat tapahtumat kysymysId:llä', async () => {
    kysyMock.mockImplementation(async function* (): AsyncGenerator<KysyTapahtuma> {
      yield { tyyppi: 'tyokalu_alkoi', kutsuId: 1, nimi: 'perustiedot', syote: {} };
      yield { tyyppi: 'vastaus', teksti: 'Vastaus.' };
    });
    const k = kysyKasittelijat(() => fakeIstunto());
    const laheta = vi.fn();
    await k.kysyKysy(42, 'Paljonko kassassa on rahaa?', laheta);

    expect(laheta).toHaveBeenNthCalledWith(
      1,
      'kysy:tapahtuma',
      expect.objectContaining({ tyyppi: 'tyokalu_alkoi', kysymysId: 42 }),
    );
    expect(laheta).toHaveBeenNthCalledWith(
      2,
      'kysy:tapahtuma',
      expect.objectContaining({ tyyppi: 'vastaus', teksti: 'Vastaus.', kysymysId: 42 }),
    );
  });

  it('hylkää toisen samanaikaisen kyselyn', async () => {
    const { promise, ratkaise } = odottaja<void>();
    kysyMock.mockImplementation(async function* (): AsyncGenerator<KysyTapahtuma> {
      await promise;
      yield { tyyppi: 'vastaus', teksti: 'Valmis.' };
    });
    const k = kysyKasittelijat(() => fakeIstunto());
    const eka = k.kysyKysy(1, 'Kysymys yksi', vi.fn());

    await expect(k.kysyKysy(2, 'Kysymys kaksi', vi.fn())).rejects.toThrow('kysely on jo käynnissä');

    ratkaise();
    await eka;
  });

  it('sallii uuden kyselyn kun edellinen on päättynyt', async () => {
    kysyMock.mockImplementation(async function* (): AsyncGenerator<KysyTapahtuma> {
      yield { tyyppi: 'vastaus', teksti: 'Ensimmäinen.' };
    });
    const k = kysyKasittelijat(() => fakeIstunto());
    await k.kysyKysy(1, 'Kysymys yksi', vi.fn());
    await expect(k.kysyKysy(2, 'Kysymys kaksi', vi.fn())).resolves.toBeUndefined();
  });
});

describe('kysyPeruuta', () => {
  it('keskeyttää käynnissä olevan kyselyn signaalin kautta', async () => {
    const { promise, ratkaise } = odottaja<void>();
    let aborttiNahty = false;
    kysyMock.mockImplementation(async function* (
      _client: unknown,
      syote: { keskeyta?: AbortSignal },
    ): AsyncGenerator<KysyTapahtuma> {
      await promise;
      aborttiNahty = syote.keskeyta?.aborted === true;
      yield { tyyppi: 'virhe', koodi: 'peruttu', viesti: 'Kysely peruutettiin.' };
    });
    const k = kysyKasittelijat(() => fakeIstunto());
    const kysely = k.kysyKysy(7, 'Kysymys', vi.fn());

    await k.kysyPeruuta(7);
    ratkaise();
    await kysely;

    expect(aborttiNahty).toBe(true);
  });
});

describe('peruutaKaikkiKysyt', () => {
  it('keskeyttää kaikki käynnissä olevat kyselyt', async () => {
    const { promise, ratkaise } = odottaja<void>();
    let aborttiNahty = false;
    kysyMock.mockImplementation(async function* (
      _client: unknown,
      syote: { keskeyta?: AbortSignal },
    ): AsyncGenerator<KysyTapahtuma> {
      await promise;
      aborttiNahty = syote.keskeyta?.aborted === true;
      yield { tyyppi: 'virhe', koodi: 'peruttu', viesti: 'Kysely peruutettiin.' };
    });
    const k = kysyKasittelijat(() => fakeIstunto());
    const kysely = k.kysyKysy(9, 'Kysymys', vi.fn());

    peruutaKaikkiKysyt();
    ratkaise();
    await kysely;

    expect(aborttiNahty).toBe(true);
  });
});
