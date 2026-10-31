import type { KpClient } from '@penni/asiakas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { avaaLiiteErikseen } from './avaaLiite.js';

const teksti = (s: string) => new TextEncoder().encode(s);

type Liite = { nimi: string; tyyppi: string; data: Uint8Array };

function asiakas(liite: Liite | null | (() => never)): KpClient {
  return {
    haeLiite: async () => {
      if (typeof liite === 'function') liite();
      return liite;
    },
  } as unknown as KpClient;
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
  const avaa = vi.spyOn(window, 'open').mockReturnValue(null);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    lataukset.push({ download: this.download });
  });
  return { luodut, lataukset, avaa };
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(URL, alkuperaiset);
});

describe('avaaLiiteErikseen', () => {
  // Regressio: avaaminen kuuluu avaaErikseen-moduulille. Blob-URL perii sovelluksen originin,
  // joten jos tämä avaisi liitteen tallennetulla tyypillä, text/html-liite ajaisi skriptiä
  // sovelluksen nimissä — työpöydällä myös paikallista, tunnistautumatonta API:a vasten.
  it('ei-esikatseltava liite ladataan tiedostona eikä avata ikkunaan', async () => {
    const { lataukset, avaa, luodut } = tarkkaile();
    const virhe = await avaaLiiteErikseen(
      asiakas({ nimi: 'sivu.html', tyyppi: 'text/html', data: teksti('<script></script>') }),
      1,
    );
    expect(virhe).toBeNull();
    expect(avaa).not.toHaveBeenCalled();
    expect(lataukset).toEqual([{ download: 'sivu.html' }]);
    expect(luodut[0]?.type).toBe('application/octet-stream');
  });

  it('PDF avataan uuteen ikkunaan sisällöstä päätellyllä tyypillä', async () => {
    const { lataukset, avaa, luodut } = tarkkaile();
    const virhe = await avaaLiiteErikseen(
      asiakas({ nimi: 'kuitti.pdf', tyyppi: 'application/pdf', data: teksti('%PDF-1.7\n') }),
      1,
    );
    expect(virhe).toBeNull();
    expect(avaa).toHaveBeenCalledWith('blob:testi/1', '_blank', 'noopener');
    expect(lataukset).toEqual([]);
    expect(luodut[0]?.type).toBe('application/pdf');
  });

  it('puuttuva liite ja hakuvirhe palautuvat viesteinä, eivät poikkeuksina', async () => {
    tarkkaile();
    expect(await avaaLiiteErikseen(asiakas(null), 1)).toBe('Liitettä ei löytynyt.');
    expect(
      await avaaLiiteErikseen(
        asiakas(() => {
          throw new Error('verkko');
        }),
        1,
      ),
    ).toBe('Liitteen avaaminen epäonnistui.');
  });
});
