import { KpClientProvider } from '@/app/KpClientProvider';
import { InProcessClient } from '@penni/asiakas';
import { type StoredTosite, TositeTyyppi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { type MemorySeed, createMemoryStorage } from '@penni/storage-memory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { alustaTila, uusiRivi } from './reducer.js';
import { CHART, LEHTI_SIEMEN } from './testHelpers.js';
import type { TositeEditoriTila } from './types.js';
import { useTositeTallennus } from './useTositeTallennus.js';

function lomake(selite: string, kredit = 1_000, paiva = '2026-06-01'): TositeEditoriTila {
  return alustaTila({
    paiva,
    tyyppi: TositeTyyppi.MENO,
    selite,
    rows: [
      uusiRivi({
        tili: 7800,
        debetSnt: Euro.fromCents(1_000),
        kreditSnt: Euro.fromCents(0),
        alvKoodi: 0,
        alvProsentti: 0,
        bruttoSyotto: true,
      }),
      uusiRivi({
        tili: 1900,
        debetSnt: Euro.fromCents(0),
        kreditSnt: Euro.fromCents(kredit),
        alvKoodi: 0,
        alvProsentti: 0,
        bruttoSyotto: true,
      }),
    ],
  });
}

function ymparisto(seed: MemorySeed = LEHTI_SIEMEN) {
  const storage = createMemoryStorage(seed);
  const client = new InProcessClient(storage, () => '2026-06-01T00:00:00.000Z');
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <KpClientProvider client={client}>{children}</KpClientProvider>
    </QueryClientProvider>
  );
  return { storage, client, qc, wrapper };
}

describe('useTositeTallennus', () => {
  it('luoLuonnos luo luonnoksen ja paivita päivittää samaa tositetta', async () => {
    const { client, storage, wrapper } = ymparisto();
    const { result } = renderHook(() => useTositeTallennus(CHART), { wrapper });
    let luonnos: StoredTosite | undefined;
    await act(async () => {
      luonnos = await result.current.luoLuonnos(lomake('Kahvit'));
    });
    expect(luonnos).toMatchObject({ tila: 50, tunniste: 0, otsikko: 'Kahvit' });
    expect(result.current.id()).toBe(luonnos?.id);
    await act(async () => {
      await result.current.paivita(lomake('Kahvit ja pullat'));
    });
    const luonnokset = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(luonnokset).toEqual([
      expect.objectContaining({ id: luonnos?.id, tila: 50, otsikko: 'Kahvit ja pullat' }),
    ]);
    expect(await storage.getLoki(luonnos?.id ?? 0)).toHaveLength(2);
  });

  it('kirjaa numeroi luonnoksen; myöhempi paivita ei palauta sitä luonnokseksi', async () => {
    const { client, wrapper } = ymparisto();
    const { result } = renderHook(() => useTositeTallennus(CHART), { wrapper });
    await act(async () => {
      await result.current.luoLuonnos(lomake('Kahvit'));
    });
    const id = result.current.id();
    let kirjattu: StoredTosite | undefined;
    await act(async () => {
      kirjattu = await result.current.kirjaa(lomake('Kahvit'));
    });
    expect(kirjattu).toMatchObject({ id, tila: 100, tunniste: 1 });
    await act(async () => {
      await result.current.paivita(lomake('Kahvit korjattu'));
    });
    expect(await client.haeTosite(id ?? 0)).toMatchObject({
      tila: 100,
      tunniste: 1,
      otsikko: 'Kahvit korjattu',
    });
  });

  it('kirjaa ilman luonnosta luo kirjatun tositteen', async () => {
    const { wrapper } = ymparisto();
    const { result } = renderHook(() => useTositeTallennus(CHART), { wrapper });
    let kirjattu: StoredTosite | undefined;
    await act(async () => {
      kirjattu = await result.current.kirjaa(lomake('Kahvit'));
    });
    expect(kirjattu).toMatchObject({ tila: 100, tunniste: 1 });
  });

  it('kirjaa kertoo moottorin estävän virheen', async () => {
    const { wrapper } = ymparisto();
    const { result } = renderHook(() => useTositeTallennus(CHART), { wrapper });
    let kirjattu: StoredTosite | undefined;
    await act(async () => {
      kirjattu = await result.current.kirjaa(lomake('Vino', 900));
    });
    expect(kirjattu).toBeUndefined();
    expect(result.current.virheviesti).toMatch(/EITASMAA/);
  });

  it('paivita säilyttää tallennetun tositteen muut kentät ja numeron', async () => {
    const { client, wrapper } = ymparisto();
    const vanha = await client.luoTosite({
      pvm: '2026-06-01',
      tyyppi: TositeTyyppi.MENO,
      sarja: '',
      tila: 100,
      otsikko: 'Vanha',
      viite: '1232',
      viennit: [],
    });
    const { result } = renderHook(() => useTositeTallennus(CHART, vanha), { wrapper });
    await act(async () => {
      await result.current.paivita(lomake('Uusi'));
    });
    expect(await client.haeTosite(vanha.id)).toMatchObject({
      tila: 100,
      tunniste: vanha.tunniste,
      viite: '1232',
      otsikko: 'Uusi',
    });
  });

  it('automaattinen tallennus ei mitätöi kyselyitä; irrotus ja kirjaus mitätöivät', async () => {
    const { qc, wrapper } = ymparisto();
    const mitatoi = vi.spyOn(qc, 'invalidateQueries');
    const { result, unmount } = renderHook(() => useTositeTallennus(CHART), { wrapper });
    await act(async () => {
      await result.current.luoLuonnos(lomake('Kahvit'));
      await result.current.paivita(lomake('Kahvit 2'));
    });
    expect(mitatoi).not.toHaveBeenCalled();
    unmount();
    expect(mitatoi).toHaveBeenCalledWith({ queryKey: ['tositteet'] });

    mitatoi.mockClear();
    const toinen = renderHook(() => useTositeTallennus(CHART), { wrapper });
    await act(async () => {
      await toinen.result.current.kirjaa(lomake('Kirjattu'));
    });
    expect(mitatoi).toHaveBeenCalledWith({ queryKey: ['tositteet'] });
  });

  it('este: luonnokselle vain lukittu kausi, kirjatulle myös täsmäys', async () => {
    const { wrapper } = ymparisto({
      ...LEHTI_SIEMEN,
      asetukset: { ...LEHTI_SIEMEN.asetukset, TilitPaatetty: '2026-03-31' },
    });
    const { result } = renderHook(() => useTositeTallennus(CHART), { wrapper });
    await waitFor(() =>
      expect(result.current.este(lomake('Lukittu', 1_000, '2026-03-15'))).toBe(
        'päivä osuu lukittuun kauteen',
      ),
    );
    expect(result.current.este(lomake('Vino', 900))).toBeNull();
    await act(async () => {
      await result.current.kirjaa(lomake('Kirjattu'));
    });
    expect(result.current.este(lomake('Vino', 900))).toBe('ei täsmää');
  });

  it('nollaa unohtaa tositteen: seuraava luonnos on uusi', async () => {
    const { client, wrapper } = ymparisto();
    const { result } = renderHook(() => useTositeTallennus(CHART), { wrapper });
    await act(async () => {
      await result.current.luoLuonnos(lomake('Eka'));
    });
    act(() => result.current.nollaa());
    expect(result.current.id()).toBeUndefined();
    await act(async () => {
      await result.current.luoLuonnos(lomake('Toka'));
    });
    expect(await client.listaaTositteet({ bucket: 'luonnos' })).toHaveLength(2);
  });
});
