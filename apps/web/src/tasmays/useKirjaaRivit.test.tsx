import {
  type StoredTosite,
  type Tili,
  type TositeSyote,
  type TyolistaRivi,
  lataaKartta,
} from '@penni/engine';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KpClientProvider } from '@/app/KpClientProvider';
import type { KpClient } from '@penni/asiakas';
import { type KirjausTulos, useKirjaaRivit } from './useKirjaaRivit';

afterEach(() => {
  window.penni = undefined;
});

const CHART: Tili[] = lataaKartta([
  { numero: 1910, nimi: 'Pankkitili', tyyppi: 'ARP' },
  { numero: 7690, nimi: 'Atk-palvelut', tyyppi: 'D' },
]);
const ASETUKSET = { pankkitili: 1910, menotili: 7690 };

const rivi = (avain: string, nimi: string, maara: number): TyolistaRivi =>
  ({
    avain,
    tapahtuma: { pvm: '2026-06-02', nimi, maara },
    tila: 'kuittiPuuttuu',
    valittu: true,
  }) as TyolistaRivi;

// Kolme riviä ilman kuittia (kuitti pidetään pois, jotta liitepolku ei sekoitu tähän
// testiin — se on Task 8:n hyväksymisajon vastuulla). Keskimmäinen rivi hylätään, jotta
// nähdään ettei yhden rivin virhe (esim. lukittu tilikausi) keskeytä muiden käsittelyä.
const RIVIT: TyolistaRivi[] = [
  rivi('a', 'Rivi A', -1000),
  rivi('b', 'Rivi B', -2000),
  rivi('c', 'Rivi C', -3000),
];

function wrapper(client: KpClient, qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <KpClientProvider client={client}>{children}</KpClientProvider>
    </QueryClientProvider>
  );
}

/** Ajaa RIVIT läpi kannalla, jonka luoTosite hylkää rivin 'Rivi B' ja hyväksyy muut. */
async function kirjaaRivit() {
  let kutsuja = 0;
  const luoTosite = vi.fn(async (syote: TositeSyote): Promise<StoredTosite> => {
    kutsuja += 1;
    if (syote.otsikko === 'Rivi B') throw new Error('Tilikausi on lukittu');
    return { ...syote, id: kutsuja } as StoredTosite;
  });
  const tallennaLiite = vi.fn();
  const client = { luoTosite, tallennaLiite } as unknown as KpClient;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useKirjaaRivit(), { wrapper: wrapper(client, qc) });

  let tulokset: KirjausTulos[] = [];
  await act(async () => {
    tulokset = await result.current.kirjaa(RIVIT, CHART, ASETUKSET);
  });

  return { luoTosite, tallennaLiite, tulokset };
}

/** Yksi kuitillinen rivi kannalla, jonka liitteen tallennus hylkää. */
async function kirjaaKuitillinenLiiteHylaten() {
  const luoTosite = vi.fn(async (syote: TositeSyote): Promise<StoredTosite> => {
    return { ...syote, id: 7 } as StoredTosite;
  });
  const tallennaLiite = vi.fn(async () => {
    throw new Error('Levy on täynnä');
  });
  const client = { luoTosite, tallennaLiite } as unknown as KpClient;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // annaTasmaysSilta vaatii lueAineisto-metodin olemassaolon portikseen.
  window.penni = {
    lueAineisto: vi.fn(),
    lueTiedosto: vi.fn(async () => new Uint8Array([1, 2, 3])),
  } as unknown as typeof window.penni;
  const { result } = renderHook(() => useKirjaaRivit(), { wrapper: wrapper(client, qc) });

  const kuitillinen: TyolistaRivi = {
    ...rivi('d', 'Rivi D', -4000),
    kuitti: { tiedosto: '/tmp/kuitit/d.pdf', kuitti: { valuutta: 'EUR', alv: [] } },
  };
  let tulokset: KirjausTulos[] = [];
  await act(async () => {
    tulokset = await result.current.kirjaa([kuitillinen], CHART, ASETUKSET);
  });
  return { luoTosite, tallennaLiite, tulokset };
}

describe('useKirjaaRivit', () => {
  it('yrittää jokaisen rivin, myös hylätyn jälkeiset', async () => {
    const { luoTosite } = await kirjaaRivit();
    expect(luoTosite).toHaveBeenCalledTimes(3);
  });

  it('palauttaa onnistuneet tositeId:llä ja epäonnistuneen virheviestillä', async () => {
    const { tulokset } = await kirjaaRivit();
    expect(tulokset).toEqual([
      { avain: 'a', ok: true, tositeId: 1 },
      { avain: 'b', ok: false, virhe: 'Tilikausi on lukittu' },
      { avain: 'c', ok: true, tositeId: 3 },
    ]);
  });

  it('ei kutsu liitteen tallennusta rivillä ilman kuittia', async () => {
    const { tallennaLiite } = await kirjaaRivit();
    expect(tallennaLiite).not.toHaveBeenCalled();
  });

  // Tosite on jo kirjassa, kun liite kaatuu: jos rivi raportoitaisiin ok:false, se jäisi
  // valituksi ryhmäänsä ja seuraava "Kirjaa valitut" loisi saman tositteen toiseen kertaan.
  it('raportoi rivin onnistuneeksi varoituksella kun vain liite epäonnistuu', async () => {
    const { luoTosite, tulokset } = await kirjaaKuitillinenLiiteHylaten();
    expect(luoTosite).toHaveBeenCalledTimes(1);
    expect(tulokset).toHaveLength(1);
    expect(tulokset[0]?.ok).toBe(true);
    expect(tulokset[0]?.tositeId).toBe(7);
    expect(tulokset[0]?.varoitus).toContain('Levy on täynnä');
  });

  it('tallentaa käyttäjän riville lisäämät tiedostot tositteen liitteiksi', async () => {
    const luoTosite = vi.fn(async (syote: TositeSyote) => ({ ...syote, id: 5 }) as StoredTosite);
    const tallennaLiite = vi.fn(async () => ({}));
    const client = { luoTosite, tallennaLiite } as unknown as KpClient;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useKirjaaRivit(), { wrapper: wrapper(client, qc) });
    const data = new Uint8Array([9, 9]);
    await act(async () => {
      await result.current.kirjaa([rivi('a', 'Rivi A', -1000)], CHART, ASETUKSET, {
        a: [{ nimi: 'kuitti.png', tyyppi: 'image/png', data }],
      });
    });
    expect(tallennaLiite).toHaveBeenCalledWith(
      expect.objectContaining({ tosite: 5, nimi: 'kuitti.png', tyyppi: 'image/png', data }),
    );
  });

  it('mitätöi tosite-, meno- ja tulolistat kirjauksen jälkeen', async () => {
    const luoTosite = vi.fn(async (syote: TositeSyote) => ({ ...syote, id: 1 }) as StoredTosite);
    const client = { luoTosite, tallennaLiite: vi.fn() } as unknown as KpClient;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mitatoi = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useKirjaaRivit(), { wrapper: wrapper(client, qc) });
    await act(async () => {
      await result.current.kirjaa([rivi('a', 'Rivi A', -1000)], CHART, ASETUKSET);
    });
    for (const avain of ['tositteet', 'menot', 'tulot'])
      expect(mitatoi).toHaveBeenCalledWith({ queryKey: [avain] });
  });
});
