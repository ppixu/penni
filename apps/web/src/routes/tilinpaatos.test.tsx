import { pura } from '@/arkisto/zip';
import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TULOS = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Yleinen' },
  rivit: [{ fi: 'Liikevaihto', L: '3', M: 'bold' }],
});
const TASE = JSON.stringify({
  nimi: { fi: 'Tase' },
  muoto: { fi: 'Yleinen' },
  rivit: [
    { fi: 'Vastaavaa', L: '1', M: 'bold' },
    { fi: 'Vastattavaa', L: '2', M: 'bold' },
  ],
});
const TULOS_PIEN = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Pienyritys' },
  rivit: [{ fi: 'Liikevaihto', L: '3', M: 'bold' }],
});
const TASE_PMA = JSON.stringify({
  nimi: { fi: 'Tase' },
  muoto: { fi: 'PMA' },
  rivit: [
    { fi: 'Vastaavaa', L: '1', M: 'bold' },
    { fi: 'Vastattavaa', L: '2', M: 'bold' },
  ],
});
const TILIT = [
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
  { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tulos' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
];
const ASETUKSET = {
  Nimi: 'Demo Oy',
  AlvVelvollinen: 'false',
  'tulos/yleinen': TULOS,
  'tase/yleinen': TASE,
  'tulos/pienbrutto': TULOS_PIEN,
  'tase/PMA': TASE_PMA,
};

/** Tulokirjaus 1900/3000 (myynti 1000,00), jotta Liikevaihto- ja Vastaavaa-rivit
 *  (ilman S-pakotusta kaavassaan) saavat tilin joka niiden alue kattaa. */
async function LUO_TOSITE(c: KpClient): Promise<void> {
  await c.luoTosite({
    pvm: '2026-03-01',
    tyyppi: 200,
    sarja: '',
    tila: 100,
    viennit: [
      {
        tili: 1900,
        debet: Euro.fromCents(100_000),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 3000,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(100_000),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  });
}

/** jsdomin Blobilla ei ole arrayBuffer()-metodia: luetaan FileReaderilla. */
function lueBlob(b: Blob): Promise<ArrayBuffer> {
  return new Promise((ok, virhe) => {
    const lukija = new FileReader();
    lukija.onload = () => ok(lukija.result as ArrayBuffer);
    lukija.onerror = () => virhe(lukija.error);
    lukija.readAsArrayBuffer(b);
  });
}

describe('/tilinpaatos', () => {
  it('vie tilinpäätöksen läpi: lukitse → vahvista → peru → avaa', async () => {
    const { user } = await renderRoute('/tilinpaatos', {
      seed: {
        tilit: TILIT,
        tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
        asetukset: ASETUKSET,
      },
      arrange: LUO_TOSITE,
    });
    // Tuloslaskelma + tase renderöityvät.
    expect(await screen.findByText('Liikevaihto')).toBeInTheDocument();
    expect(screen.getByText('Vastaavaa')).toBeInTheDocument();
    // Avoin → Lukitse.
    expect(screen.getByText('Tilikausi auki')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lukitse tilikausi' }));
    // Lukittu → Vahvista.
    expect(await screen.findByText('Tilikausi lukittu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vahvista tilinpäätös' }));
    // Vahvistettu (kello 2026-06-01) → liitetiedot vain luku.
    expect(await screen.findByText(/Tilinpäätös vahvistettu/)).toBeInTheDocument();
    expect(screen.getByLabelText('Liitetiedot')).toHaveAttribute('readonly');
    // Peru → Avaa.
    await user.click(screen.getByRole('button', { name: 'Peru vahvistus' }));
    expect(await screen.findByText('Tilikausi lukittu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avaa tilikausi' }));
    expect(await screen.findByText('Tilikausi auki')).toBeInTheDocument();
  });

  it('estää lukituksen kun aiempi tilikausi on auki', async () => {
    const { user } = await renderRoute('/tilinpaatos', {
      seed: {
        tilit: TILIT,
        tilikaudet: [
          { alkaa: '2025-01-01', loppuu: '2025-12-31' },
          { alkaa: '2026-01-01', loppuu: '2026-12-31' },
        ],
        asetukset: ASETUKSET,
      },
    });
    // Oletus valitsee viimeisimmän kauden (2026); sen lukitus estyy koska 2025 on auki.
    expect(await screen.findByText('Tilikausi auki')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lukitse tilikausi' }));
    expect(await screen.findByText('Aiempi tilikausi on vielä auki.')).toBeInTheDocument();
  });

  it('käyttää kirjan omaa tilinpäätösmuotoa ilman muotovalitsinta', async () => {
    await renderRoute('/tilinpaatos', {
      seed: {
        tilit: TILIT,
        tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
        asetukset: { ...ASETUKSET, Tilinpaatosmuoto: 'pien' },
      },
      arrange: async (c) => {
        await LUO_TOSITE(c);
      },
    });
    expect(await screen.findByText('Liikevaihto')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tilinpäätöksen muoto')).not.toBeInTheDocument();
  });

  describe('Arkistoi', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('ei näy avoimelle kaudelle, mutta lukitulle kaudelle lataa arkiston ja kirjaa sen asetuksiin', async () => {
      const ladatut: string[] = [];
      const blobit: Blob[] = [];
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: (b: Blob) => {
          blobit.push(b);
          return 'blob:testi';
        },
        revokeObjectURL: () => undefined,
      });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        ladatut.push(this.download);
      });
      const { user, client } = await renderRoute('/tilinpaatos', {
        seed: {
          tilit: TILIT,
          tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
          asetukset: ASETUKSET,
        },
        arrange: LUO_TOSITE,
      });
      expect(await screen.findByText('Tilikausi auki')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Arkistoi' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Lukitse tilikausi' }));
      expect(await screen.findByText('Tilikausi lukittu')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Arkistoi' }));

      await waitFor(() => expect(ladatut).toEqual(['Demo Oy-arkisto-2026.zip']), {
        timeout: 25_000,
      });
      const kirjattu = await waitFor(
        async () => {
          const arvo = (await client.haeAsetukset())['Arkistoitu/2026-12-31'];
          expect(arvo).toBeDefined();
          return JSON.parse(arvo as string) as { aika: string; tiiviste: string };
        },
        { timeout: 25_000 },
      );
      expect(kirjattu.tiiviste).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isNaN(Date.parse(kirjattu.aika))).toBe(false);
      // Kirjattu aika on arkiston oma luontihetki (manifestin luotu), ei latauksen jälkeinen.
      const zip = pura(new Uint8Array(await lueBlob(blobit[0] as Blob)));
      const manifest = JSON.parse(new TextDecoder().decode(zip.get('2026/manifest.json')));
      expect(kirjattu.aika).toBe(manifest.luotu);
      expect(
        await screen.findByText(
          new RegExp(`^Arkistoitu .* · tiiviste ${kirjattu.tiiviste.slice(0, 12)}…$`),
        ),
      ).toBeInTheDocument();
      expect(ladatut).toHaveLength(1);
    }, 60_000);

    it('estää arkistoinnin, kun liitetiedoissa on tallentamattomia muutoksia', async () => {
      const { user } = await renderRoute('/tilinpaatos', {
        seed: {
          tilit: TILIT,
          tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
          asetukset: { ...ASETUKSET, TilitPaatetty: '2026-12-31' },
        },
      });
      expect(await screen.findByText('Tilikausi lukittu')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Arkistoi' })).toBeEnabled();

      await user.type(screen.getByLabelText('Liitetiedot'), 'Uusi liitetieto');
      expect(screen.getByRole('button', { name: 'Arkistoi' })).toBeDisabled();
      expect(screen.getByText('Tallenna liitetiedot ennen arkistointia.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Tallenna liitetiedot' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Arkistoi' })).toBeEnabled());
      expect(
        screen.queryByText('Tallenna liitetiedot ennen arkistointia.'),
      ).not.toBeInTheDocument();
    });

    it('näyttää kirjatun arkistointipäivän paikallisena, ei UTC-päivänä', async () => {
      vi.stubEnv('TZ', 'Europe/Helsinki');
      try {
        await renderRoute('/tilinpaatos', {
          seed: {
            tilit: TILIT,
            tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
            asetukset: {
              ...ASETUKSET,
              TilitPaatetty: '2026-12-31',
              // 23.30 UTC on jo seuraava päivä Suomessa.
              'Arkistoitu/2026-12-31': JSON.stringify({
                aika: '2026-03-04T23:30:00.000Z',
                tiiviste: 'ab'.repeat(32),
              }),
            },
          },
        });
        expect(
          await screen.findByText(`Arkistoitu 5.3.2026 · tiiviste ${'ab'.repeat(6)}…`),
        ).toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
