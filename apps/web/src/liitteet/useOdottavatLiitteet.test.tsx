import { InProcessClient } from '@penni/asiakas';
import { createMemoryStorage } from '@penni/storage-memory';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KpClientProvider } from '@/app/KpClientProvider';
import type { LadattavaLiite } from './LiitteidenLataus.js';
import { useOdottavatLiitteet } from './useOdottavatLiitteet.js';

const teksti = (s: string) => new TextEncoder().encode(s);

function wrapper() {
  const client = new InProcessClient(createMemoryStorage({}), () => '2026-06-01T00:00:00.000Z');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <KpClientProvider client={client}>{children}</KpClientProvider>
    </QueryClientProvider>
  );
}

// jsdom ei toteuta object-URL:eja lainkaan, joten ne asetetaan paikalleen (ei spyOn).
const alkuperaiset = {
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

function tarkkaile() {
  const luodut: Blob[] = [];
  const lataukset: { download: string }[] = [];
  Object.assign(URL, {
    createObjectURL: (b: Blob) => {
      luodut.push(b);
      return 'blob:testi/1';
    },
    revokeObjectURL: () => {},
  });
  const avaaIkkuna = vi.spyOn(window, 'open').mockReturnValue(null);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    lataukset.push({ download: this.download });
  });
  return { luodut, lataukset, avaaIkkuna };
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(URL, alkuperaiset);
});

/** Hook yhdellä odottavalla liitteellä; palauttaa myös sen väliaikaisen id:n. */
function yhdellaLiitteella(liite: LadattavaLiite) {
  const { result } = renderHook(() => useOdottavatLiitteet([liite]), { wrapper: wrapper() });
  const [odottava] = result.current.odottavat;
  if (!odottava) throw new Error('odottava liite puuttuu');
  return { result, id: odottava.id };
}

describe('useOdottavatLiitteet: avaa', () => {
  // Regressio: odottava liite on käyttäjän juuri valitsema tiedosto, mutta blob-URL perii
  // sovelluksen originin — tallennetulla tyypillä avattu text/html ajaisi skriptiä sovelluksen
  // nimissä. Avaaminen kuuluu avaaErikseen-moduulille, kuten tallennetuilla liitteillä.
  it('ei-esikatseltava liite ladataan tiedostona eikä avata ikkunaan', () => {
    const { lataukset, avaaIkkuna, luodut } = tarkkaile();
    const { result, id } = yhdellaLiitteella({
      nimi: 'sivu.html',
      tyyppi: 'text/html',
      data: teksti('<script></script>'),
    });
    result.current.avaa(id);
    expect(avaaIkkuna).not.toHaveBeenCalled();
    expect(lataukset).toEqual([{ download: 'sivu.html' }]);
    expect(luodut[0]?.type).toBe('application/octet-stream');
  });

  it('PDF avataan uuteen ikkunaan sisällöstä päätellyllä tyypillä', () => {
    const { lataukset, avaaIkkuna, luodut } = tarkkaile();
    const { result, id } = yhdellaLiitteella({
      nimi: 'kuitti.pdf',
      tyyppi: 'application/pdf',
      data: teksti('%PDF-1.7\n'),
    });
    result.current.avaa(id);
    expect(avaaIkkuna).toHaveBeenCalledWith('blob:testi/1', '_blank', 'noopener');
    expect(lataukset).toEqual([]);
    expect(luodut[0]?.type).toBe('application/pdf');
  });

  it('tuntematon id ei avaa eikä lataa mitään', () => {
    const { avaaIkkuna, luodut } = tarkkaile();
    const { result } = yhdellaLiitteella({
      nimi: 'kuitti.pdf',
      tyyppi: 'application/pdf',
      data: teksti('%PDF-1.7\n'),
    });
    result.current.avaa(12345);
    expect(avaaIkkuna).not.toHaveBeenCalled();
    expect(luodut).toEqual([]);
  });
});
