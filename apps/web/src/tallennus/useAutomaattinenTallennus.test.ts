import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AutotallennusAsetukset,
  useAutomaattinenTallennus,
} from './useAutomaattinenTallennus.js';

interface Lomake {
  teksti: string;
}
const lomake = (teksti: string): Lomake => ({ teksti });

/** Hook oletusajoin (1 s / 5 s); ensimmäinen raportoitu tila ('') on pohja. */
function kaynnista(lisa: Partial<AutotallennusAsetukset<Lomake>> = {}) {
  const asetukset: AutotallennusAsetukset<Lomake> = {
    tallenna: vi.fn(async (_t: Lomake): Promise<unknown> => undefined),
    vertailuun: (t) => t.teksti,
    kuvaaVirhe: (e) => (e instanceof Error ? e.message : 'virhe'),
    ...lisa,
  };
  const hook = renderHook(() => useAutomaattinenTallennus(asetukset));
  act(() => hook.result.current.muuttui(lomake('')));
  return { ...hook, tallenna: vi.mocked(asetukset.tallenna) };
}

async function kulu(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Tallennus, joka jää kesken, kunnes testi vapauttaa sen. */
function viivastetty() {
  let vapauta: () => void = () => {};
  const tallenna = vi.fn(
    (_t: Lomake) =>
      new Promise<unknown>((r) => {
        vapauta = () => r(undefined);
      }),
  );
  return { tallenna, vapauta: () => vapauta() };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAutomaattinenTallennus', () => {
  it('ei tallenna ennen ensimmäistä todellista muutosta', async () => {
    const { result, tallenna } = kaynnista();
    await kulu(10_000);
    act(() => result.current.muuttui(lomake('')));
    await kulu(10_000);
    expect(tallenna).not.toHaveBeenCalled();
    expect(result.current.tila).toBe('tallennettu');
    expect(result.current.tallennettuKerran).toBe(false);
  });

  it('tallentaa sekunnin tauon jälkeen viimeisimmän tilan', async () => {
    const { result, tallenna } = kaynnista();
    act(() => result.current.muuttui(lomake('a')));
    expect(result.current.tila).toBe('tallennetaan');
    await kulu(500);
    act(() => result.current.muuttui(lomake('ab')));
    await kulu(999);
    expect(tallenna).not.toHaveBeenCalled();
    await kulu(1);
    expect(tallenna).toHaveBeenCalledTimes(1);
    expect(tallenna).toHaveBeenCalledWith(lomake('ab'));
    expect(result.current.tila).toBe('tallennettu');
    expect(result.current.tallennettuKerran).toBe(true);
  });

  it('kentästä poistuminen tallentaa odottavan muutoksen heti', async () => {
    const { result, tallenna } = kaynnista();
    act(() => result.current.muuttui(lomake('a')));
    act(() => result.current.kenttaPoistui());
    await kulu(0);
    expect(tallenna).toHaveBeenCalledTimes(1);
    await kulu(5_000);
    expect(tallenna).toHaveBeenCalledTimes(1);
  });

  it('kentästä poistuminen ilman muutosta ei tallenna', async () => {
    const { result, tallenna } = kaynnista();
    act(() => result.current.kenttaPoistui());
    await kulu(5_000);
    expect(tallenna).not.toHaveBeenCalled();
  });

  it('yksi tallennus kerrallaan, viimeisin tila voittaa', async () => {
    const v = viivastetty();
    const { result } = kaynnista({ tallenna: v.tallenna });
    act(() => result.current.muuttui(lomake('a')));
    await kulu(1_000);
    expect(v.tallenna).toHaveBeenCalledTimes(1);
    act(() => result.current.muuttui(lomake('ab')));
    await kulu(1_000);
    act(() => result.current.muuttui(lomake('abc')));
    await kulu(1_000);
    expect(v.tallenna).toHaveBeenCalledTimes(1);

    await act(async () => v.vapauta());
    await kulu(0);
    expect(v.tallenna).toHaveBeenCalledTimes(2);
    expect(v.tallenna).toHaveBeenLastCalledWith(lomake('abc'));
    await act(async () => v.vapauta());
    await kulu(5_000);
    expect(v.tallenna).toHaveBeenCalledTimes(2);
    expect(result.current.tila).toBe('tallennettu');
  });

  it('pohjaan palannut muutos tallennetaan, jos välitila ehti tallentua', async () => {
    const v = viivastetty();
    const { result } = kaynnista({ tallenna: v.tallenna });
    act(() => result.current.muuttui(lomake('a')));
    await kulu(1_000); // 'a' tallentumassa
    act(() => result.current.muuttui(lomake(''))); // käyttäjä perui käsin
    await act(async () => v.vapauta());
    await kulu(1_000);
    expect(v.tallenna).toHaveBeenCalledTimes(2);
    expect(v.tallenna).toHaveBeenLastCalledWith(lomake(''));
  });

  it('epäonnistunut tallennus yritetään uudelleen 5 s kuluttua', async () => {
    const tallenna = vi
      .fn(async (_t: Lomake): Promise<unknown> => undefined)
      .mockRejectedValueOnce(new Error('verkko'));
    const { result } = kaynnista({ tallenna });
    act(() => result.current.muuttui(lomake('a')));
    await kulu(1_000);
    expect(result.current.tila).toBe('virhe');
    expect(result.current.syy).toBe('verkko');
    expect(result.current.onkoMenossaHukkaan()).toBe(true);
    await kulu(4_999);
    expect(tallenna).toHaveBeenCalledTimes(1);
    await kulu(1);
    expect(tallenna).toHaveBeenCalledTimes(2);
    expect(result.current.tila).toBe('tallennettu');
    expect(result.current.onkoMenossaHukkaan()).toBe(false);
  });

  it('virheen jälkeen seuraava muutos yrittää tauon jälkeen', async () => {
    const tallenna = vi
      .fn(async (_t: Lomake): Promise<unknown> => undefined)
      .mockRejectedValueOnce(new Error('verkko'));
    const { result } = kaynnista({ tallenna });
    act(() => result.current.muuttui(lomake('a')));
    await kulu(1_000);
    act(() => result.current.muuttui(lomake('ab')));
    await kulu(1_000);
    expect(tallenna).toHaveBeenCalledTimes(2);
    expect(tallenna).toHaveBeenLastCalledWith(lomake('ab'));
  });

  it('irrotus tallentaa odottavan muutoksen', async () => {
    const { result, tallenna, unmount } = kaynnista();
    act(() => result.current.muuttui(lomake('a')));
    unmount();
    await kulu(0);
    expect(tallenna).toHaveBeenCalledTimes(1);
    expect(tallenna).toHaveBeenCalledWith(lomake('a'));
  });

  it('sivun sulkeminen (pagehide) tallentaa odottavan muutoksen', async () => {
    const { result, tallenna } = kaynnista();
    act(() => result.current.muuttui(lomake('a')));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await kulu(0);
    expect(tallenna).toHaveBeenCalledTimes(1);
  });

  it('este estää tallennuksen, näyttää syyn ja pitää poistumisvaroituksen päällä', async () => {
    const { result, tallenna } = kaynnista({
      este: (t) => (t.teksti.includes('!') ? 'ei täsmää' : null),
    });
    act(() => result.current.muuttui(lomake('a!')));
    expect(result.current.tila).toBe('eiKelpaa');
    expect(result.current.syy).toBe('ei täsmää');
    expect(result.current.onkoMenossaHukkaan()).toBe(true);
    await kulu(10_000);
    expect(tallenna).not.toHaveBeenCalled();

    act(() => result.current.muuttui(lomake('a')));
    expect(result.current.tila).toBe('tallennetaan');
    await kulu(1_000);
    expect(tallenna).toHaveBeenCalledTimes(1);
    expect(result.current.onkoMenossaHukkaan()).toBe(false);
  });

  it('jonossa odottaa kesken olevan tallennuksen eikä päästä uutta tallennusta väliin', async () => {
    const v = viivastetty();
    const { result } = kaynnista({ tallenna: v.tallenna });
    act(() => result.current.muuttui(lomake('a')));
    await kulu(1_000);
    expect(v.tallenna).toHaveBeenCalledTimes(1);

    let kirjausValmis: () => void = () => {};
    const kirjaus = vi.fn(
      () =>
        new Promise<string>((r) => {
          kirjausValmis = () => r('kirjattu');
        }),
    );
    let tulos: Promise<string> = Promise.resolve('');
    act(() => {
      tulos = result.current.jonossa(kirjaus);
    });
    expect(kirjaus).not.toHaveBeenCalled();
    await act(async () => v.vapauta());
    await kulu(0);
    expect(kirjaus).toHaveBeenCalledTimes(1);

    // Kirjauksen aikana tullut muutos tallentuu vasta kirjauksen jälkeen.
    act(() => result.current.muuttui(lomake('ab')));
    await kulu(1_000);
    expect(v.tallenna).toHaveBeenCalledTimes(1);
    await act(async () => kirjausValmis());
    await expect(tulos).resolves.toBe('kirjattu');
    await kulu(0);
    expect(v.tallenna).toHaveBeenCalledTimes(2);
    expect(v.tallenna).toHaveBeenLastCalledWith(lomake('ab'));
  });

  it('pakotaTallennus tallentaa myös muuttumattoman tai annetun tilan', async () => {
    const { result, tallenna } = kaynnista();
    let ok = false;
    await act(async () => {
      ok = await result.current.pakotaTallennus();
    });
    expect(ok).toBe(true);
    expect(tallenna).toHaveBeenLastCalledWith(lomake(''));
    await act(async () => {
      ok = await result.current.pakotaTallennus(lomake('x'));
    });
    expect(tallenna).toHaveBeenLastCalledWith(lomake('x'));
    act(() => result.current.muuttui(lomake('x')));
    await kulu(5_000);
    expect(tallenna).toHaveBeenCalledTimes(2);
  });

  it('pakotaTallennus palauttaa false, kun este estää', async () => {
    const { result, tallenna } = kaynnista({ este: () => 'päivä osuu lukittuun kauteen' });
    let ok = true;
    await act(async () => {
      ok = await result.current.pakotaTallennus();
    });
    expect(ok).toBe(false);
    expect(tallenna).not.toHaveBeenCalled();
    expect(result.current.syy).toBe('päivä osuu lukittuun kauteen');
  });

  it('asetaPohja: kirjattu tila ei jää odottamaan tallennusta', async () => {
    const { result, tallenna } = kaynnista();
    act(() => result.current.muuttui(lomake('a')));
    act(() => result.current.asetaPohja(lomake('a')));
    expect(result.current.tila).toBe('tallennettu');
    await kulu(5_000);
    expect(tallenna).not.toHaveBeenCalled();
  });

  it('nollaa aloittaa uuden pohjan ja unohtaa tallennetun', async () => {
    const { result, tallenna } = kaynnista();
    act(() => result.current.muuttui(lomake('a')));
    await kulu(1_000);
    expect(result.current.tallennettuKerran).toBe(true);
    act(() => result.current.nollaa(lomake('')));
    expect(result.current.tallennettuKerran).toBe(false);
    act(() => result.current.muuttui(lomake('')));
    await kulu(5_000);
    expect(tallenna).toHaveBeenCalledTimes(1);
  });

  it('lopeta estää tallennukset, myös irrotettaessa; jatka palauttaa ne', async () => {
    const { result, tallenna, unmount } = kaynnista();
    act(() => result.current.muuttui(lomake('a')));
    await act(async () => {
      await result.current.lopeta();
    });
    await kulu(5_000);
    expect(tallenna).not.toHaveBeenCalled();
    expect(result.current.onkoMenossaHukkaan()).toBe(false);
    act(() => result.current.jatka());
    await kulu(1_000);
    expect(tallenna).toHaveBeenCalledTimes(1);

    act(() => result.current.muuttui(lomake('ab')));
    await act(async () => {
      await result.current.lopeta();
    });
    unmount();
    await kulu(0);
    expect(tallenna).toHaveBeenCalledTimes(1);
  });

  it('irrotuksen yksi yritys ei uusiudu epäonnistuttuaan', async () => {
    const tallenna = vi
      .fn(async (_t: Lomake): Promise<unknown> => undefined)
      .mockRejectedValue(new Error('verkko'));
    const { result, unmount } = kaynnista({ tallenna });
    act(() => result.current.muuttui(lomake('a')));
    await kulu(1_000);
    expect(tallenna).toHaveBeenCalledTimes(1); // uusinta odottaa
    act(() => result.current.muuttui(lomake('ab')));
    unmount();
    await kulu(30_000);
    expect(tallenna).toHaveBeenCalledTimes(2);
    expect(tallenna).toHaveBeenLastCalledWith(lomake('ab'));
  });

  it('irrotettaessa epäonnistunut yritys ei jätä uusintaajastinta', async () => {
    const tallenna = vi
      .fn(async (_t: Lomake): Promise<unknown> => undefined)
      .mockRejectedValue(new Error('verkko'));
    const { result, unmount } = kaynnista({ tallenna });
    act(() => result.current.muuttui(lomake('a')));
    unmount();
    await kulu(30_000);
    expect(tallenna).toHaveBeenCalledTimes(1);
  });

  it('nollaa kesken tallennuksen: vanhan tallennuksen valmistuminen ei kosketa uutta lomaketta', async () => {
    const v = viivastetty();
    const { result } = kaynnista({ tallenna: v.tallenna });
    act(() => result.current.muuttui(lomake('a')));
    await kulu(1_000);
    expect(v.tallenna).toHaveBeenCalledTimes(1);
    act(() => result.current.nollaa(lomake('')));
    act(() => result.current.muuttui(lomake('')));
    expect(result.current.tila).toBe('tallennettu');
    await act(async () => v.vapauta());
    await kulu(10_000);
    expect(result.current.tila).toBe('tallennettu');
    expect(result.current.tallennettuKerran).toBe(false);
    expect(v.tallenna).toHaveBeenCalledTimes(1);
  });
});
