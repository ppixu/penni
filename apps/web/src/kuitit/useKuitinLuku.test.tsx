import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Lukumalli } from './lueKuitti.js';
import {
  KuitinLukuKonteksti,
  type KuitinLukuRiippuvuudet,
  useKuitinLuku,
} from './useKuitinLuku.js';

const TEKSTI = [
  'Kahvila   Aamu   Oy',
  'Laskun   paivays   15.07.2026',
  'Yhteensa   EUR   6,40',
].join('\n');
const KUVA = { id: -1, tyyppi: 'image/png', data: new Uint8Array([1]) };

function asetelma(muuta: Partial<Lukumalli> = {}, lupa = true) {
  const malli: Lukumalli = {
    saatavilla: vi.fn().mockResolvedValue(true),
    lataa: vi.fn().mockResolvedValue(undefined),
    tulkitse: vi.fn().mockResolvedValue(TEKSTI),
    ...muuta,
  };
  const ymparisto = {
    latausAsetukset: { selainValimuisti: true },
    onkoLupa: vi.fn().mockResolvedValue(lupa),
    annaLupa: vi.fn().mockResolvedValue(undefined),
  };
  const r: KuitinLukuRiippuvuudet = {
    malli: () => malli,
    ymparisto: () => ymparisto,
    pdfTeksti: vi.fn().mockResolvedValue(''),
    rasteroiPdf: vi.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <KuitinLukuKonteksti.Provider value={r}>{children}</KuitinLukuKonteksti.Provider>
  );
  return { malli, ymparisto, wrapper };
}

describe('useKuitinLuku', () => {
  it('lukee kuvan ja päätyy luettuun kuittiin', async () => {
    const { wrapper } = asetelma();
    const { result } = renderHook(() => useKuitinLuku(), { wrapper });
    act(() => result.current.lue(KUVA));
    await waitFor(() => expect(result.current.tila.vaihe).toBe('luettu'));
    expect(result.current.tila).toMatchObject({
      liiteId: -1,
      kuitti: { myyja: 'Kahvila Aamu Oy' },
    });
    act(() => result.current.kuittaa());
    expect(result.current.tila).toEqual({ vaihe: 'lepo' });
  });

  it('kysyy luvan ja jatkaa vasta myöntymisen jälkeen', async () => {
    const { malli, ymparisto, wrapper } = asetelma({}, false);
    const { result } = renderHook(() => useKuitinLuku(), { wrapper });
    act(() => result.current.lue(KUVA));
    await waitFor(() => expect(result.current.tila.vaihe).toBe('tarvitseeLuvan'));
    expect(malli.lataa).not.toHaveBeenCalled();
    act(() => result.current.vastaaLupaan(true));
    await waitFor(() => expect(result.current.tila.vaihe).toBe('luettu'));
    expect(ymparisto.annaLupa).toHaveBeenCalledOnce();
  });

  it('"Ei nyt" palauttaa lepoon ilman virheilmoitusta eikä tallenna lupaa', async () => {
    const { ymparisto, wrapper } = asetelma({}, false);
    const { result } = renderHook(() => useKuitinLuku(), { wrapper });
    act(() => result.current.lue(KUVA));
    await waitFor(() => expect(result.current.tila.vaihe).toBe('tarvitseeLuvan'));
    act(() => result.current.vastaaLupaan(false));
    await waitFor(() => expect(result.current.tila).toEqual({ vaihe: 'lepo' }));
    expect(ymparisto.annaLupa).not.toHaveBeenCalled();
  });

  it('peru lupakysymyksen aikana sulkee kysymyksen eikä täytä mitään', async () => {
    const { malli, wrapper } = asetelma({}, false);
    const { result } = renderHook(() => useKuitinLuku(), { wrapper });
    act(() => result.current.lue(KUVA));
    await waitFor(() => expect(result.current.tila.vaihe).toBe('tarvitseeLuvan'));
    act(() => result.current.peru());
    expect(result.current.tila).toEqual({ vaihe: 'lepo' });
    await new Promise((r) => setTimeout(r, 0));
    expect(malli.lataa).not.toHaveBeenCalled();
    expect(result.current.tila).toEqual({ vaihe: 'lepo' });
  });

  it('peru lukemisen aikana hylkää myöhemmin valmistuvan tuloksen', async () => {
    let valmis: (t: string) => void = () => {};
    const { wrapper } = asetelma({
      tulkitse: vi.fn(
        () =>
          new Promise<string>((r) => {
            valmis = r;
          }),
      ),
    });
    const { result } = renderHook(() => useKuitinLuku(), { wrapper });
    act(() => result.current.lue(KUVA));
    await waitFor(() => expect(result.current.tila.vaihe).toBe('luetaan'));
    act(() => result.current.peru());
    await act(async () => valmis(TEKSTI));
    expect(result.current.tila).toEqual({ vaihe: 'lepo' });
  });

  it('mallivirhe näkyy eiLuettu-tilana, tukematon tiedosto ei näy mitenkään', async () => {
    const varoitus = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const kaatuva = asetelma({ tulkitse: vi.fn().mockRejectedValue(new Error('x')) });
    const a = renderHook(() => useKuitinLuku(), { wrapper: kaatuva.wrapper });
    act(() => a.result.current.lue(KUVA));
    await waitFor(() => expect(a.result.current.tila).toEqual({ vaihe: 'eiLuettu', syy: 'virhe' }));
    expect(varoitus).toHaveBeenCalledOnce();
    const b = renderHook(() => useKuitinLuku(), { wrapper: asetelma().wrapper });
    act(() => b.result.current.lue({ ...KUVA, tyyppi: 'text/csv' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(b.result.current.tila).toEqual({ vaihe: 'lepo' });
  });

  it('sarjoittaa mallikutsut: toinen luku ei aja tulkintaa rinnakkain', async () => {
    let kaynnissa = 0;
    let enintaan = 0;
    const vapauta: Array<() => void> = [];
    const tulkitse = vi.fn(async () => {
      kaynnissa++;
      enintaan = Math.max(enintaan, kaynnissa);
      await new Promise<void>((r) => vapauta.push(r));
      kaynnissa--;
      return TEKSTI;
    });
    const { wrapper } = asetelma({ tulkitse });
    const { result } = renderHook(() => useKuitinLuku(), { wrapper });
    act(() => result.current.lue(KUVA));
    await waitFor(() => expect(tulkitse).toHaveBeenCalledTimes(1));
    act(() => result.current.lue({ ...KUVA, id: -2 }));
    // Toinen luku ehtii jonoon, mutta ei käynnistä tulkintaa ennen ensimmäisen valmistumista.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(tulkitse).toHaveBeenCalledTimes(1);
    await act(async () => vapauta[0]?.());
    await waitFor(() => expect(tulkitse).toHaveBeenCalledTimes(2));
    await act(async () => vapauta[1]?.());
    await waitFor(() =>
      expect(result.current.tila).toMatchObject({ vaihe: 'luettu', liiteId: -2 }),
    );
    expect(enintaan).toBe(1);
  });

  it('ei käynnistä jonossa perutun kuitin mallikutsuja', async () => {
    let vapauta: (teksti: string) => void = () => {};
    const a = asetelma({
      tulkitse: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            vapauta = resolve;
          }),
      ),
    });
    const b = asetelma();
    const alku = renderHook(() => useKuitinLuku(), { wrapper: a.wrapper });
    const jonossa = renderHook(() => useKuitinLuku(), { wrapper: b.wrapper });
    act(() => alku.result.current.lue(KUVA));
    await waitFor(() => expect(a.malli.tulkitse).toHaveBeenCalledOnce());
    act(() => jonossa.result.current.lue({ ...KUVA, id: -2 }));
    await waitFor(() => expect(jonossa.result.current.tila.vaihe).toBe('ladataanMallia'));
    act(() => jonossa.result.current.peru());
    await act(async () => vapauta(TEKSTI));
    await waitFor(() => expect(alku.result.current.tila.vaihe).toBe('luettu'));
    expect(b.malli.lataa).not.toHaveBeenCalled();
    expect(b.malli.tulkitse).not.toHaveBeenCalled();
    expect(jonossa.result.current.tila).toEqual({ vaihe: 'lepo' });
  });
});
