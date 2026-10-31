import { renderRoute } from '@/test/renderRoute';
import { lueListanJarjestys } from '@/tositteet/listanJarjestys';
import type { KpClient } from '@penni/asiakas';
import { ResourceError } from '@penni/engine';
import { Euro } from '@penni/euro';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

function tasapainoinenViennit(pvm: string) {
  return [
    {
      tili: 1910,
      debet: Euro.fromCents(5_000),
      kredit: Euro.fromCents(0),
      pvm,
      alvKoodi: 0,
      alvProsentti: 0,
    },
    {
      tili: 3000,
      debet: Euro.fromCents(0),
      kredit: Euro.fromCents(5_000),
      pvm,
      alvKoodi: 0,
      alvProsentti: 0,
    },
  ];
}

describe('Tositenäyttö', () => {
  it("shows a locked voucher's viennit read-only", async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
        await c.paivitaAsetukset({ TilitPaatetty: '2026-04-30' });
      },
    });
    await waitFor(() => expect(screen.getByLabelText('tosite')).toBeInTheDocument());
    // Viennit taulukossa (yhteenveto taulukon alla toistaa tilit ja summat).
    const taulukko = within(screen.getByRole('table'));
    expect(taulukko.getByText('1910')).toBeInTheDocument();
    expect(taulukko.getByText('3000')).toBeInTheDocument();
    // Tilin nimi näkyy numeron vieressä.
    expect(taulukko.getByText('Pankkitili')).toBeInTheDocument();
    expect(taulukko.getByText('Myynti')).toBeInTheDocument();
    // Tasapainoinen tosite: 50,00 € näkyy sekä debet- että kreditsarakkeessa.
    expect(taulukko.getAllByText('50,00 €')).toHaveLength(2);
  });

  it('vain luku -näkymä näyttää kirjauksen yhteenvedon taulukon alla', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
        await c.paivitaAsetukset({ TilitPaatetty: '2026-04-30' });
      },
    });
    const yhteenveto = await screen.findByRole('region', { name: 'Kirjauksen yhteenveto' });
    expect(screen.getAllByRole('region', { name: 'Kirjauksen yhteenveto' })).toHaveLength(1);
    // Tosite-osion sisällä, taulukon jälkeen.
    const taulukko = within(screen.getByLabelText('tosite')).getByRole('table');
    expect(
      taulukko.compareDocumentPosition(yhteenveto) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('näyttää virheen kun liitettä ei löydy avattaessa', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
        await c.tallennaLiite({
          tosite: t.id,
          nimi: 'kuitti.pdf',
          tyyppi: 'application/pdf',
          luotu: '2026-04-01T00:00:00.000Z',
          data: new Uint8Array([1, 2, 3]),
        });
      },
    });
    await waitFor(() => expect(screen.getAllByText('kuitti.pdf')).toHaveLength(1));
    vi.spyOn(client, 'haeLiite').mockResolvedValue(null);
    await user.click(screen.getByRole('button', { name: 'Avaa kuitti.pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Liitettä ei löytynyt.');
  });

  it('näyttää virheen kun liitteen avaaminen epäonnistuu', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
        await c.tallennaLiite({
          tosite: t.id,
          nimi: 'kuitti.pdf',
          tyyppi: 'application/pdf',
          luotu: '2026-04-01T00:00:00.000Z',
          data: new Uint8Array([1, 2, 3]),
        });
      },
    });
    await waitFor(() => expect(screen.getAllByText('kuitti.pdf')).toHaveLength(1));
    vi.spyOn(client, 'haeLiite').mockRejectedValue(new Error('verkkovirhe'));
    await user.click(screen.getByRole('button', { name: 'Avaa kuitti.pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Liitteen avaaminen epäonnistui.');
  });

  it('näyttää virheen kun liitteen poisto epäonnistuu', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
        await c.tallennaLiite({
          tosite: t.id,
          nimi: 'kuitti.pdf',
          tyyppi: 'application/pdf',
          luotu: '2026-04-01T00:00:00.000Z',
          data: new Uint8Array([1, 2, 3]),
        });
      },
    });
    await waitFor(() => expect(screen.getAllByText('kuitti.pdf')).toHaveLength(1));
    vi.spyOn(client, 'poistaLiite').mockRejectedValue(new Error('verkkovirhe'));
    await user.click(screen.getByRole('button', { name: 'Poista kuitti.pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Liitteen poisto epäonnistui.');
  });
  it('liitteet listataan kerran, lisäys on pudotusalue', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await luoMyynti(c);
        await c.tallennaLiite({
          tosite: t.id,
          nimi: 'kuitti.pdf',
          tyyppi: 'application/pdf',
          luotu: '2026-04-01T00:00:00.000Z',
          data: new Uint8Array([1, 2, 3]),
        });
      },
    });
    const lista = await screen.findByRole('region', { name: 'liitteet' });
    expect(within(lista).getByText('kuitti.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('kuitti.pdf')).toHaveLength(1);
    expect(screen.getByLabelText('Lisää liite')).toHaveClass('sr-only');
  });
});

/** Myyntitosite 50 € (tunniste 1). */
function luoMyynti(c: KpClient, pvm = '2026-04-01') {
  return c.luoTosite({
    pvm,
    tyyppi: 200,
    sarja: '',
    tila: 100,
    otsikko: 'Myynti huhtikuu',
    viennit: tasapainoinenViennit(pvm),
  });
}

describe('Tositteen muokkaus ja poisto', () => {
  it('muokattava tosite avautuu suoraan ruudukkoon ja tallentuu automaattisesti samalla numerolla', async () => {
    const { user, client, storage } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    expect(await screen.findByRole('combobox', { name: /Tili, rivi 1/i })).toHaveValue(
      '1910 Pankkitili',
    );
    expect(screen.queryByRole('button', { name: 'Muokkaa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tallenna' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kirjaa' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Debet, rivi 1/i })).toHaveValue('50,00');
    const selite = screen.getByRole('textbox', { name: 'Selite' });
    expect(selite).toHaveValue('Myynti huhtikuu');
    await user.clear(selite);
    await user.type(selite, 'Myynti korjattu');
    await user.tab();

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    expect(await client.haeTosite(1)).toMatchObject({
      id: 1,
      tunniste: 1,
      tila: 100,
      otsikko: 'Myynti korjattu',
    });
    expect(await storage.getLoki(1)).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'Selite' })).toHaveValue('Myynti korjattu');
  });

  it.each<[string, Record<string, unknown>]>([
    ['era', { era: 12 }],
    ['kohdennus', { kohdennus: 3 }],
    ['jaksotus', { jaksoalkaa: '2026-01-01', jaksoloppuu: '2026-12-31' }],
    ['poikkeava vientipäivä', { pvm: '2026-04-02' }],
  ])('vienti, jolla on %s, avautuu vain luku -tilaan', async (_nimi, lisa) => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const [eka, toka] = tasapainoinenViennit('2026-04-01');
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            { ...eka, ...lisa } as NonNullable<typeof eka>,
            toka as NonNullable<typeof toka>,
          ],
        });
      },
    });
    expect(await screen.findByText(/ei voi muokata ruudukossa/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Tili, rivi 1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tallenna' })).not.toBeInTheDocument();
  });

  it('poistettu tosite avautuu vain luku -tilaan', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
        await c.poistaTosite(1);
      },
    });
    expect(await screen.findByText(/Tosite on poistettu/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Tili, rivi 1/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poista' })).toBeDisabled();
  });

  it('Poista vahvistaa ja poistaa tositteen', async () => {
    const { user, client, router } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    const vahvistus = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(await screen.findByRole('button', { name: 'Poista' }));
    expect(vahvistus).toHaveBeenCalled();
    await waitFor(() => expect(router.state.location.pathname).toBe('/tositteet'));
    expect(await client.listaaTositteet({ bucket: 'kirjanpidossa' })).toHaveLength(0);
    vahvistus.mockRestore();
  });

  it('Poista ei tee mitään, jos käyttäjä peruu', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    const vahvistus = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(await screen.findByRole('button', { name: 'Poista' }));
    expect(await client.listaaTositteet({ bucket: 'kirjanpidossa' })).toHaveLength(1);
    vahvistus.mockRestore();
  });

  it('lukitun kauden tositetta ei voi muokata eikä poistaa', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
        await c.paivitaAsetukset({ TilitPaatetty: '2026-04-30' });
      },
    });
    expect(await screen.findByText(/lukitulla kaudella/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Tili, rivi 1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tallenna' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poista' })).toBeDisabled();
    // Vain luku -näkymässäkin kirjauksen suunta selväkielisenä.
    expect(screen.getByRole('region', { name: 'Kirjauksen yhteenveto' })).toBeInTheDocument();
  });

  it('näyttää moottorin lukitusvirheen tilarivillä ja pitää muutokset', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    await screen.findByRole('combobox', { name: /Tili, rivi 1/i });
    vi.spyOn(client, 'paivitaTosite').mockRejectedValue(
      new ResourceError('PVMLUKITTU', 'Tosite osuu lukittuun tilikauteen'),
    );
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), ' (korjaus)');
    await user.tab();
    expect(
      await screen.findByText(/^Tallennus epäonnistui — yritetään uudelleen/),
    ).toHaveTextContent(/lukittuun tilikauteen/);
    // Editori pysyy auki, jotta muutokset eivät katoa.
    expect(screen.getByRole('textbox', { name: 'Selite' })).toHaveValue(
      'Myynti huhtikuu (korjaus)',
    );
  });
});

describe('Tositteen muokkaus — automaattinen tallennus', () => {
  it('täsmäävä muutos tallentuu tauon jälkeen yhdellä lokirivillä, eikä poistuminen kysy', async () => {
    const { user, client, storage, router } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    const selite = await screen.findByRole('textbox', { name: 'Selite' });
    await user.type(selite, ' (korjaus)');
    await user.tab();
    await screen.findByText('Tallennettu');
    expect(await storage.getLoki(1)).toHaveLength(2);
    await user.type(selite, ' 2');
    await user.tab();
    await waitFor(async () =>
      expect((await client.haeTosite(1))?.otsikko).toBe('Myynti huhtikuu (korjaus) 2'),
    );
    expect(await storage.getLoki(1)).toHaveLength(3);

    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('täsmäämätön muutos ei tallennu, kertoo syyn ja kysyy poistuttaessa', async () => {
    const { user, client, storage, router } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    const debet = await screen.findByRole('textbox', { name: /Debet, rivi 1/i });
    await user.clear(debet);
    await user.type(debet, '60,00');
    await user.tab();
    expect(await screen.findByText('Ei tallennettu — ei täsmää')).toBeInTheDocument();
    expect((await client.haeTosite(1))?.viennit[0]?.debet).toBe(5_000);
    expect(await storage.getLoki(1)).toHaveLength(1);

    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    expect(
      await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Poistu tallentamatta' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect((await client.haeTosite(1))?.viennit[0]?.debet).toBe(5_000);
  });

  it('täsmäämätön ja taas täsmäävä muutos tallentuu kerran', async () => {
    const { user, client, storage } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    const debet = await screen.findByRole('textbox', { name: /Debet, rivi 1/i });
    await user.clear(debet);
    await user.type(debet, '60,00');
    await user.tab();
    expect(await screen.findByText('Ei tallennettu — ei täsmää')).toBeInTheDocument();
    const kredit = screen.getByRole('textbox', { name: /Kredit, rivi 2/i });
    await user.clear(kredit);
    await user.type(kredit, '60,00');
    await user.tab();

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    await waitFor(async () =>
      expect((await client.haeTosite(1))?.viennit).toEqual([
        expect.objectContaining({ tili: 1910, debet: 6_000 }),
        expect.objectContaining({ tili: 3000, kredit: 6_000 }),
      ]),
    );
    expect(await storage.getLoki(1)).toHaveLength(2);
  });

  it('luonnoksen lukitun kauden päivä ei tallennu, kertoo syyn ja kysyy poistuttaessa', async () => {
    const { user, client, router } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 50,
          otsikko: 'Luonnos',
          viennit: tasapainoinenViennit('2026-04-01'),
        });
        await c.paivitaAsetukset({ TilitPaatetty: '2026-03-31' });
      },
    });
    fireEvent.change(await screen.findByLabelText('Päivä'), { target: { value: '2026-03-15' } });
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), ' 2');
    await user.tab();
    expect(
      await screen.findByText('Ei tallennettu — päivä osuu lukittuun kauteen'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    expect(
      await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Poistu tallentamatta' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await client.haeTosite(1)).toMatchObject({
      pvm: '2026-04-01',
      tila: 50,
      otsikko: 'Luonnos',
    });
  });

  it('Palauta palauttaa avaushetken tilan ja tallentaa sen', async () => {
    const { user, client, storage } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    const selite = await screen.findByRole('textbox', { name: 'Selite' });
    expect(screen.queryByRole('button', { name: 'Palauta' })).not.toBeInTheDocument();
    await user.type(selite, ' (korjaus)');
    await user.tab();
    await user.click(await screen.findByRole('button', { name: 'Palauta' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Selite' })).toHaveValue('Myynti huhtikuu'),
    );
    await waitFor(async () => expect((await client.haeTosite(1))?.otsikko).toBe('Myynti huhtikuu'));
    expect(await storage.getLoki(1)).toHaveLength(3);
  });

  it('luonnos tallentuu luonnoksena, ja Kirjaa numeroi sen', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 50,
          otsikko: 'Luonnos',
          viennit: tasapainoinenViennit('2026-04-01'),
        });
      },
    });
    expect(await screen.findByText('Tulo · Luonnos')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), ' 2');
    await user.tab();
    expect(await screen.findByText('Tallennettu luonnoksena')).toBeInTheDocument();
    expect(await client.haeTosite(1)).toMatchObject({
      tila: 50,
      tunniste: 0,
      otsikko: 'Luonnos 2',
    });

    await user.click(screen.getByRole('button', { name: 'Kirjaa' }));
    expect(await screen.findByText('Tulo · 1')).toBeInTheDocument();
    expect(await client.haeTosite(1)).toMatchObject({
      tila: 100,
      tunniste: 1,
      otsikko: 'Luonnos 2',
    });
    expect(screen.queryByRole('button', { name: 'Kirjaa' })).not.toBeInTheDocument();
  });

  it('Kirjaa jälkeen Palauta palauttaa kirjatun tilan, ei luonnoksen avaushetkeä', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 200,
          sarja: '',
          tila: 50,
          otsikko: 'Luonnos',
          viennit: tasapainoinenViennit('2026-04-01'),
        });
      },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Selite' }), ' 2');
    await user.tab();
    await screen.findByText('Tallennettu luonnoksena');
    await user.click(screen.getByRole('button', { name: 'Kirjaa' }));
    expect(await screen.findByText('Tulo · 1')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Selite' }), ' 3');
    await user.tab();
    await user.click(await screen.findByRole('button', { name: 'Palauta' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Selite' })).toHaveValue('Luonnos 2'),
    );
    await waitFor(async () =>
      expect(await client.haeTosite(1)).toMatchObject({
        tila: 100,
        tunniste: 1,
        otsikko: 'Luonnos 2',
      }),
    );
  });

  it('takaisin palattaessa avautuu viimeksi tallennettu sisältö, ei välimuistin vanha versio', async () => {
    const { user, client, router } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    // Muutos tallentuu vasta sivulta poistuttaessa, ja tallennus valmistuu vasta poistumisen
    // jälkeen: välimuistin ['tosite', 1] on yhä avaushetken versio.
    let jatka: () => void = () => {};
    const paivita = client.paivitaTosite.bind(client);
    const paivitaTosite = vi
      .spyOn(client, 'paivitaTosite')
      .mockImplementationOnce(async (id, syote) => {
        await new Promise<void>((res) => {
          jatka = res;
        });
        return paivita(id, syote);
      });
    await user.type(await screen.findByRole('textbox', { name: 'Selite' }), ' (korjaus)');
    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    await waitFor(() => expect(paivitaTosite).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe('/'));
    await act(async () => jatka());
    await waitFor(async () =>
      expect((await client.haeTosite(1))?.otsikko).toBe('Myynti huhtikuu (korjaus)'),
    );

    act(() => router.history.back());
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe('/tositteet/1'));
    expect(await screen.findByRole('textbox', { name: 'Selite' })).toHaveValue(
      'Myynti huhtikuu (korjaus)',
    );
    // Seuraava muutos jatkaa tallennettua sisältöä eikä kirjoita vanhaa sen päälle.
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), ' 2');
    await user.tab();
    await waitFor(async () =>
      expect((await client.haeTosite(1))?.otsikko).toBe('Myynti huhtikuu (korjaus) 2'),
    );
  });
});

const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function uusiLiite(tosite: number, nimi: string, tyyppi: string, data: Uint8Array) {
  return { tosite, nimi, tyyppi, luotu: '2026-04-01T00:00:00.000Z', data };
}

describe('Kuitin esikatselu', () => {
  // jsdom ei toteuta object-URL:eja; korvataan seurattavilla.
  const alkuperaiset = {
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  let n = 0;
  const luo = vi.fn((_b: Blob) => `blob:testi/${++n}`);
  const vapauta = vi.fn((_url: string) => {});
  beforeEach(() => {
    n = 0;
    luo.mockClear();
    vapauta.mockClear();
    localStorage.clear();
    Object.assign(URL, { createObjectURL: luo, revokeObjectURL: vapauta });
  });
  afterEach(() => {
    cleanup(); // irrota ennen palautusta: purku vapauttaa vielä URL:n
    Object.assign(URL, alkuperaiset);
    localStorage.clear();
  });

  it('muokattava tosite avautuu editoriin PDF-kuitti vieressä; URL vapautetaan', async () => {
    const { unmount } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await luoMyynti(c);
        await c.tallennaLiite(uusiLiite(t.id, 'kuitti.pdf', 'application/pdf', PDF));
      },
    });
    expect(await screen.findByRole('combobox', { name: /Tili, rivi 1/i })).toBeInTheDocument();
    const kehys = await screen.findByTitle('Esikatselu: kuitti.pdf');
    expect(kehys.tagName).toBe('IFRAME');
    expect(kehys).toHaveAttribute('src', 'blob:testi/1');
    expect(luo).toHaveBeenCalledTimes(1);
    expect(luo.mock.calls[0]?.[0].type).toBe('application/pdf');
    // Liitelista ja lataus pysyvät käytössä editorin vieressä.
    expect(screen.getByRole('button', { name: 'Poista kuitti.pdf' })).toBeInTheDocument();
    expect(screen.getByLabelText('Lisää liite')).toBeInTheDocument();

    unmount();
    expect(vapauta).toHaveBeenCalledWith('blob:testi/1');
  });

  it('lukittu tosite on vain luku, ja kuvakuitti näkyy vieressä', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await luoMyynti(c);
        await c.tallennaLiite(uusiLiite(t.id, 'kuva.png', 'image/png', PNG));
        await c.paivitaAsetukset({ TilitPaatetty: '2026-04-30' });
      },
    });
    const kuva = await screen.findByRole('img', { name: 'Esikatselu: kuva.png' });
    expect(kuva).toHaveAttribute('src', 'blob:testi/1');
    expect(luo.mock.calls[0]?.[0].type).toBe('image/png');
    expect(screen.getByText(/lukitulla kaudella/i)).toBeInTheDocument();
    expect(screen.getByLabelText('tosite')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tallenna' })).not.toBeInTheDocument();
  });

  it('kuva, jota selain ei pysty näyttämään, vaihtuu avaukseen erikseen', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await luoMyynti(c);
        await c.tallennaLiite(uusiLiite(t.id, 'kuva.jpg', 'image/jpeg', new Uint8Array([1, 2])));
      },
    });
    fireEvent.error(await screen.findByRole('img', { name: 'Esikatselu: kuva.jpg' }));
    expect(await screen.findByText(/ei voi esikatsella/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Esikatselu: kuva.jpg' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avaa erikseen' })).toBeInTheDocument();
  });

  it('usean liitteen välillä vaihdetaan välilehdillä', async () => {
    const { user } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await luoMyynti(c);
        await c.tallennaLiite(uusiLiite(t.id, 'kuitti.pdf', 'application/pdf', PDF));
        await c.tallennaLiite(uusiLiite(t.id, 'kuva.png', 'image/png', PNG));
      },
    });
    expect(await screen.findByTitle('Esikatselu: kuitti.pdf')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'kuitti.pdf' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('tab', { name: 'kuva.png' }));
    expect(await screen.findByRole('img', { name: 'Esikatselu: kuva.png' })).toHaveAttribute(
      'src',
      'blob:testi/2',
    );
    expect(screen.queryByTitle('Esikatselu: kuitti.pdf')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'kuva.png' })).toHaveAttribute('aria-selected', 'true');
    expect(vapauta).toHaveBeenCalledWith('blob:testi/1');
  });

  it('esikatselun voi piilottaa, ja valinta muistetaan', async () => {
    const arrange = async (c: KpClient) => {
      const t = await luoMyynti(c);
      await c.tallennaLiite(uusiLiite(t.id, 'kuitti.pdf', 'application/pdf', PDF));
    };
    const { user, unmount } = await renderRoute('/tositteet/1', { seed: SEED, arrange });
    expect(await screen.findByTitle('Esikatselu: kuitti.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Piilota esikatselu' }));
    expect(screen.queryByTitle('Esikatselu: kuitti.pdf')).not.toBeInTheDocument();
    expect(vapauta).toHaveBeenCalledWith('blob:testi/1');
    expect(localStorage.getItem('penni.liiteEsikatselu.piilotettu')).toBe('1');
    unmount();

    const toinen = await renderRoute('/tositteet/1', { seed: SEED, arrange });
    const nayta = await screen.findByRole('button', { name: 'Näytä esikatselu' });
    expect(screen.queryByTitle('Esikatselu: kuitti.pdf')).not.toBeInTheDocument();
    await toinen.user.click(nayta);
    expect(await screen.findByTitle('Esikatselu: kuitti.pdf')).toBeInTheDocument();
    expect(localStorage.getItem('penni.liiteEsikatselu.piilotettu')).toBeNull();
  });

  it('ei-esikatseltava liite ladataan tiedostona eikä avata sovelluksen originissa', async () => {
    const { user } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await luoMyynti(c);
        await c.tallennaLiite(
          uusiLiite(t.id, 'sivu.html', 'text/html', new TextEncoder().encode('<script></script>')),
        );
      },
    });
    expect(await screen.findByText(/ei voi esikatsella/)).toBeInTheDocument();
    expect(luo).not.toHaveBeenCalled();
    const avaa = vi.spyOn(window, 'open').mockReturnValue(null);
    const lataukset: { href: string; download: string }[] = [];
    const klikkaus = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      lataukset.push({ href: this.href, download: this.download });
    });
    await user.click(screen.getByRole('button', { name: 'Avaa erikseen' }));
    await waitFor(() =>
      expect(lataukset).toEqual([{ href: 'blob:testi/1', download: 'sivu.html' }]),
    );
    expect(luo.mock.calls[0]?.[0].type).toBe('application/octet-stream');
    expect(avaa).not.toHaveBeenCalled();
    avaa.mockRestore();
    klikkaus.mockRestore();
  });

  it('PDF:n avaus erikseen käyttää sisällöstä pääteltyä tyyppiä', async () => {
    const { user } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await luoMyynti(c);
        await c.tallennaLiite(uusiLiite(t.id, 'kuitti.pdf', 'text/html', PDF));
      },
    });
    await screen.findByTitle('Esikatselu: kuitti.pdf');
    const avaa = vi.spyOn(window, 'open').mockReturnValue(null);
    await user.click(screen.getByRole('button', { name: 'Avaa kuitti.pdf' }));
    await waitFor(() => expect(avaa).toHaveBeenCalledWith('blob:testi/2', '_blank', 'noopener'));
    expect(luo.mock.calls[1]?.[0].type).toBe('application/pdf');
    avaa.mockRestore();
  });

  it('Palauta palauttaa avaushetken tilan, ja kuitti pysyy näkyvissä', async () => {
    const { user } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        const t = await luoMyynti(c);
        await c.tallennaLiite(uusiLiite(t.id, 'kuitti.pdf', 'application/pdf', PDF));
      },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Selite' }), ' (korjaus)');
    await user.tab();
    await user.click(await screen.findByRole('button', { name: 'Palauta' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Selite' })).toHaveValue('Myynti huhtikuu'),
    );
    expect(screen.getByTitle('Esikatselu: kuitti.pdf')).toBeInTheDocument();
  });

  it('poisto muokkauksen aikana ei kysy eikä keskeneräinen muutos palauta poistettua tositetta', async () => {
    const { user, router, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await luoMyynti(c);
      },
    });
    await user.type(await screen.findByRole('textbox', { name: 'Selite' }), ' (korjaus)');
    const vahvistus = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Poista' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tositteet'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(await client.listaaTositteet({ bucket: 'kirjanpidossa' })).toHaveLength(0);
    expect(await client.listaaTositteet({ bucket: 'poistetut' })).toHaveLength(1);
    vahvistus.mockRestore();
  });
});

describe('Edellinen / Seuraava', () => {
  /** Kolme kirjattua tositetta: numerot 1–3 luontijärjestyksessä, päivät käänteisessä. */
  async function kolmeKirjattua(c: KpClient) {
    await luoMyynti(c, '2026-04-03');
    await luoMyynti(c, '2026-04-02');
    await luoMyynti(c, '2026-04-01');
  }
  const polku = (router: { state: { location: { pathname: string } } }) =>
    router.state.location.pathname;

  it('selaa kirjattuja tositteita numerojärjestyksessä; päissä nappi on pois käytöstä', async () => {
    const { user, router } = await renderRoute('/tositteet/2', {
      seed: SEED,
      arrange: kolmeKirjattua,
    });
    const seuraava = await screen.findByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    await user.click(seuraava);
    await waitFor(() => expect(polku(router)).toBe('/tositteet/3'));
    expect(await screen.findByText('Tulo · 3')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Seuraava tosite' })).toBeDisabled(),
    );

    await user.click(screen.getByRole('button', { name: 'Edellinen tosite' }));
    await waitFor(() => expect(polku(router)).toBe('/tositteet/2'));
    await user.click(await screen.findByRole('button', { name: 'Edellinen tosite' }));
    await waitFor(() => expect(polku(router)).toBe('/tositteet/1'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edellinen tosite' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Seuraava tosite' })).toBeEnabled();
  });

  it('näkyy myös vain luku -näkymässä (lukittu kausi)', async () => {
    const { user, router } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await kolmeKirjattua(c);
        await c.paivitaAsetukset({ TilitPaatetty: '2026-04-30' });
      },
    });
    expect(await screen.findByText(/lukitulla kaudella/i)).toBeInTheDocument();
    const seuraava = screen.getByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    await user.click(seuraava);
    await waitFor(() => expect(polku(router)).toBe('/tositteet/2'));
  });

  it('luonnoksissa selataan luonnoksia päiväjärjestyksessä', async () => {
    const { user, router } = await renderRoute('/tositteet/3', {
      seed: SEED,
      arrange: async (c) => {
        const luonnos = (pvm: string) =>
          c.luoTosite({
            pvm,
            tyyppi: 200,
            sarja: '',
            tila: 50,
            otsikko: 'Luonnos',
            viennit: tasapainoinenViennit(pvm),
          });
        await luonnos('2026-05-10'); // id 1
        await luoMyynti(c, '2026-05-05'); // id 2, kirjattu: ei mukana
        await luonnos('2026-05-01'); // id 3
      },
    });
    expect(await screen.findByText('Tulo · Luonnos')).toBeInTheDocument();
    const seuraava = screen.getByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Edellinen tosite' })).toBeDisabled();
    await user.click(seuraava);
    await waitFor(() => expect(polku(router)).toBe('/tositteet/1'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edellinen tosite' })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: 'Seuraava tosite' })).toBeDisabled();
  });

  it('täsmäävä muutos tallentuu siirryttäessä seuraavaan ilman kysymistä', async () => {
    const { user, router, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: kolmeKirjattua,
    });
    const seuraava = await screen.findByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), ' (korjaus)');
    await user.click(seuraava);
    await waitFor(() => expect(polku(router)).toBe('/tositteet/2'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(async () =>
      expect((await client.haeTosite(1))?.otsikko).toBe('Myynti huhtikuu (korjaus)'),
    );
  });

  it('täsmäämätön muutos kysyy ennen siirtymistä', async () => {
    const { user, router } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: kolmeKirjattua,
    });
    const seuraava = await screen.findByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    const debet = screen.getByRole('textbox', { name: /Debet, rivi 1/i });
    await user.clear(debet);
    await user.type(debet, '60,00');
    await user.tab();
    await user.click(seuraava);

    expect(
      await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jää sivulle' }));
    expect(polku(router)).toBe('/tositteet/1');
    expect(screen.getByRole('textbox', { name: /Debet, rivi 1/i })).toHaveValue('60,00');

    await user.click(screen.getByRole('button', { name: 'Seuraava tosite' }));
    await user.click(await screen.findByRole('button', { name: 'Poistu tallentamatta' }));
    await waitFor(() => expect(polku(router)).toBe('/tositteet/2'));
    expect(await screen.findByRole('textbox', { name: 'Selite' })).toHaveValue('Myynti huhtikuu');
  });

  it('Alt+nuolet selaavat, mutta eivät kentässä kirjoitettaessa', async () => {
    const { user, router } = await renderRoute('/tositteet/2', {
      seed: SEED,
      arrange: kolmeKirjattua,
    });
    const seuraava = await screen.findByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());

    await user.click(screen.getByRole('textbox', { name: 'Selite' }));
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(polku(router)).toBe('/tositteet/2');

    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() => expect(polku(router)).toBe('/tositteet/3'));
    await screen.findByText('Tulo · 3');
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await waitFor(() => expect(polku(router)).toBe('/tositteet/2'));
  });
});

describe('Edellinen / Seuraava listan järjestyksessä', () => {
  /** Kirjattu myynti annetulla summalla (sentit) ja otsikolla. */
  function myynti(c: KpClient, pvm: string, snt: number, otsikko: string) {
    const viennit = tasapainoinenViennit(pvm).map((v, i) =>
      i === 0 ? { ...v, debet: Euro.fromCents(snt) } : { ...v, kredit: Euro.fromCents(snt) },
    );
    return c.luoTosite({ pvm, tyyppi: 200, sarja: '', tila: 100, otsikko, viennit });
  }
  /** Numerot 1–3; summat 300 €, 100 € ja 200 € → summajärjestys 2, 3, 1. */
  async function kolmeSummaa(c: KpClient) {
    await myynti(c, '2026-04-01', 30_000, 'Eka');
    await myynti(c, '2026-04-02', 10_000, 'Toka');
    await myynti(c, '2026-04-03', 20_000, 'Kolmas');
  }
  const polku = (router: { state: { location: { pathname: string } } }) =>
    router.state.location.pathname;

  it('summan mukaan lajitellulta listalta avattu tosite selaa listan järjestyksessä', async () => {
    const { user, router } = await renderRoute('/tositteet?jarj=summa&suunta=nouseva', {
      seed: SEED,
      arrange: kolmeSummaa,
    });
    await user.click(await screen.findByText('200,00 €'));
    await waitFor(() => expect(polku(router)).toBe('/tositteet/3'));
    // Numerojärjestyksessä 3 on viimeinen; listalla sen jälkeen tulee 300 € (tosite 1).
    const seuraava = await screen.findByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    await user.click(seuraava);
    await waitFor(() => expect(polku(router)).toBe('/tositteet/1'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Seuraava tosite' })).toBeDisabled(),
    );

    // Alt+← kulkee samaa järjestystä takaisin: 1 → 3 → 2, ja alussa Edellinen on pois käytöstä.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await waitFor(() => expect(polku(router)).toBe('/tositteet/3'));
    await screen.findByText('Tulo · 3');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edellinen tosite' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Edellinen tosite' }));
    await waitFor(() => expect(polku(router)).toBe('/tositteet/2'));
    await screen.findByText('Tulo · 2');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edellinen tosite' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Seuraava tosite' })).toBeEnabled();
  });

  it('listalta puuttuva tosite (esim. linkistä avattu) selaa numerojärjestyksessä', async () => {
    const { user, router } = await renderRoute('/tositteet?jarj=summa&suunta=nouseva', {
      seed: SEED,
      arrange: kolmeSummaa,
    });
    // Haku rajaa listan pelkkään tositteeseen 1; tosite 2 avataan muualta.
    await user.type(await screen.findByRole('searchbox', { name: 'Hae tositteita' }), 'Eka');
    await waitFor(() => expect(screen.queryByText('100,00 €')).not.toBeInTheDocument());
    await router.navigate({ to: '/tositteet/$id', params: { id: '2' } });
    await screen.findByText('Tulo · 2');
    const seuraava = screen.getByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    await user.click(seuraava);
    await waitFor(() => expect(polku(router)).toBe('/tositteet/3'));
  });

  it('ohittaa listalla olleen tositteen, joka on sittemmin poistettu', async () => {
    const { user, router, client, queryClient } = await renderRoute(
      '/tositteet?jarj=summa&suunta=nouseva',
      { seed: SEED, arrange: kolmeSummaa },
    );
    // Lista: 2 (100 €), 3 (200 €), 1 (300 €). Avataan 2 listalta, jolloin lista poistuu näkyvistä
    // eikä tallenna järjestystä uudelleen; vasta sitten tosite 3 poistetaan.
    await user.click(await screen.findByText('100,00 €'));
    await screen.findByText('Tulo · 2');
    await client.poistaTosite(3);
    await queryClient.invalidateQueries();
    expect(lueListanJarjestys()?.idt).toEqual([2, 3, 1]);
    const seuraava = screen.getByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    await user.click(seuraava);
    await waitFor(() => expect(polku(router)).toBe('/tositteet/1'));
  });

  it('listalla käynnin jälkeen muualta avattu sama tosite selaa numerojärjestyksessä', async () => {
    const { user, router } = await renderRoute('/tositteet?jarj=summa&suunta=nouseva', {
      seed: SEED,
      arrange: kolmeSummaa,
    });
    await screen.findByText('200,00 €');
    expect(lueListanJarjestys()?.idt).toEqual([2, 3, 1]);
    // Esim. kojelaudalta tai raportista: tavallinen siirtymä ilman listan merkintää.
    await router.navigate({ to: '/' });
    await router.navigate({ to: '/tositteet/$id', params: { id: '3' } });
    await screen.findByText('Tulo · 3');
    // Numerojärjestyksessä 3 on viimeinen (listalla sen jälkeen olisi 1).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edellinen tosite' })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: 'Seuraava tosite' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Edellinen tosite' }));
    await waitFor(() => expect(polku(router)).toBe('/tositteet/2'));
  });

  it('Tulot-listalta avattu tosite selaa Tulot-listan järjestyksessä', async () => {
    const { user, router } = await renderRoute('/tositteet?laji=tulot&jarj=summa&suunta=nouseva', {
      seed: SEED,
      arrange: kolmeSummaa,
    });
    await user.click(await screen.findByText('Kolmas'));
    await waitFor(() => expect(polku(router)).toBe('/tositteet/3'));
    const seuraava = await screen.findByRole('button', { name: 'Seuraava tosite' });
    await waitFor(() => expect(seuraava).toBeEnabled());
    await user.click(seuraava);
    await waitFor(() => expect(polku(router)).toBe('/tositteet/1'));
  });
});

describe('Tositteen tyypin vaihto', () => {
  /** Ruudukkoon palautumaton tosite: irrallinen alv-vienti ilman perusvientiä. */
  const SEED_ALV = {
    ...SEED,
    tilit: [...SEED.tilit, { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } }],
  };
  function palautumatonViennit(pvm: string) {
    return [
      {
        tili: 3000,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(5_000),
        pvm,
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 1763,
        debet: Euro.fromCents(1_275),
        kredit: Euro.fromCents(0),
        pvm,
        alvKoodi: 221,
        alvProsentti: 25.5,
      },
      {
        tili: 1910,
        debet: Euro.fromCents(3_725),
        kredit: Euro.fromCents(0),
        pvm,
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ];
  }
  const tyyppiValitsin = () => screen.queryByRole('radiogroup', { name: 'Tyyppi' });

  it('viennitön muistio avautuu editoriin; tyypin vaihto tallentuu ilman vientejä samalla numerolla', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-09-30',
          tyyppi: 700,
          sarja: '',
          tila: 100,
          otsikko: '09/26 Tiliote',
          viennit: [],
        });
      },
    });
    const muistio = await screen.findByRole('radio', { name: 'Muistio' });
    expect(muistio).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(/ei voi muokata ruudukossa/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Selite' })).toHaveValue('09/26 Tiliote');
    // Tyhjä ruudukko ei ole muutos: mitään ei tallenneta ennen tyypin vaihtoa.
    expect(screen.queryByText('Tallennettu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Meno' }));
    await user.tab();
    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();

    const tallennettu = await client.haeTosite(1);
    expect(tallennettu).toMatchObject({
      tyyppi: 100,
      tunniste: 1,
      sarja: '',
      pvm: '2026-09-30',
      otsikko: '09/26 Tiliote',
      viennit: [],
    });
  });

  it('ruudukkoon palautumattoman tositteen tyypin voi vaihtaa; viennit ja numero säilyvät', async () => {
    const { user, client, storage } = await renderRoute('/tositteet/1', {
      seed: SEED_ALV,
      arrange: async (c) => {
        const t = await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 100,
          sarja: '',
          tila: 100,
          otsikko: 'Vanha kirjaus',
          viite: '1232',
          viennit: palautumatonViennit('2026-04-01'),
        });
        await c.tallennaLiite(uusiLiite(t.id, 'tiliote.pdf', 'application/pdf', PDF));
      },
    });
    const syy = await screen.findByText(/ei voi muokata ruudukossa/);
    expect(syy).toHaveTextContent(/alv-erittely/);
    expect(syy).not.toHaveTextContent(/lasku/);
    const ennen = await client.haeTosite(1);
    const liitteetEnnen = await client.haeLiitteet(1);
    const lokiEnnen = await storage.getLoki(1);
    expect(liitteetEnnen).toHaveLength(1);
    expect(
      within(screen.getByLabelText('tosite')).getByRole('radio', { name: 'Meno' }),
    ).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'Tulo' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Tulo' })).toHaveAttribute('aria-checked', 'true'),
    );
    expect(await screen.findByText('Tulo · 1')).toBeInTheDocument();

    const jalkeen = await client.haeTosite(1);
    expect(jalkeen?.tyyppi).toBe(200);
    // Kaikki muu (numero, sarja, päivä, otsikko, tila, viite, viennit) täsmälleen ennallaan.
    expect({ ...jalkeen, tyyppi: ennen?.tyyppi }).toEqual(ennen);
    expect(JSON.stringify(jalkeen?.viennit)).toBe(JSON.stringify(ennen?.viennit));
    expect(await client.haeLiitteet(1)).toEqual(liitteetEnnen);
    // Moottorin tavallinen päivityspolku kirjasi lokirivin uudella tyypillä.
    const loki = await storage.getLoki(1);
    expect(loki).toHaveLength(lokiEnnen.length + 1);
    expect(loki.at(-1)?.data).toEqual(jalkeen);
    // Vain luku -näkymä pysyy, viennit koskemattomina.
    expect(screen.getByText(/ei voi muokata ruudukossa/)).toBeInTheDocument();
  });

  it('tyypin vaihdon virhe näytetään', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED_ALV,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 100,
          sarja: '',
          tila: 100,
          viennit: palautumatonViennit('2026-04-01'),
        });
      },
    });
    await screen.findByText(/ei voi muokata ruudukossa/);
    vi.spyOn(client, 'paivitaTosite').mockRejectedValue(
      new ResourceError('PVMLUKITTU', 'Tosite osuu lukittuun tilikauteen'),
    );
    await user.click(screen.getByRole('radio', { name: 'Tulo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/lukittuun tilikauteen/);
    expect(screen.getByRole('radio', { name: 'Meno' })).toHaveAttribute('aria-checked', 'true');
  });

  it('myyntilaskulla ei ole tyyppivalitsinta', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 210,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
      },
    });
    expect(await screen.findByText(/ei voi muokata ruudukossa \(lasku\)/)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(tyyppiValitsin()).not.toBeInTheDocument();
  });

  it('laskutiedot (eräpäivä) sisältävällä tositteella ei ole tyyppivalitsinta', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED_ALV,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 100,
          sarja: '',
          tila: 100,
          erapvm: '2026-04-15',
          viennit: palautumatonViennit('2026-04-01'),
        });
      },
    });
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(tyyppiValitsin()).not.toBeInTheDocument();
  });

  it('viennitön tosite, jolla on laskutiedot, ei avaudu editoriin eikä saa tyyppivalitsinta', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 100,
          sarja: '',
          tila: 100,
          erapvm: '2026-04-15',
          viennit: [],
        });
      },
    });
    expect(await screen.findByText(/ei voi muokata ruudukossa \(lasku\)/)).toBeInTheDocument();
    expect(tyyppiValitsin()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tallenna' })).not.toBeInTheDocument();
  });

  it('järjestelmätositteella (≥ 9000) ei ole tyyppivalitsinta', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 9100,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
      },
    });
    const syy = await screen.findByText(/ei voi muokata ruudukossa/);
    expect(syy).toHaveTextContent(/järjestelmän muodostama/);
    expect(syy).not.toHaveTextContent(/lasku/);
    expect(tyyppiValitsin()).not.toBeInTheDocument();
  });

  it('liitetiedon viennit näytetään vain luku, tyyppivalitsimen kanssa; syynä tyyppi', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 800,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
      },
    });
    const syy = await screen.findByText(/ei voi muokata ruudukossa/);
    expect(syy).toHaveTextContent(/Liitetieto/);
    expect(syy).not.toHaveTextContent(/lasku/);
    await user.click(screen.getByRole('radio', { name: 'Siirto' }));
    await waitFor(async () => expect((await client.haeTosite(1))?.tyyppi).toBe(300));
  });

  it('palkka- ja tiliotetosite avautuvat ruudukkoon kuten siirto', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 500,
          sarja: '',
          tila: 100,
          viennit: tasapainoinenViennit('2026-04-01'),
        });
      },
    });
    expect(await screen.findByRole('radio', { name: 'Palkka' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Tiliote' })).toBeInTheDocument();
    expect(screen.queryByText(/ei voi muokata ruudukossa/)).not.toBeInTheDocument();
  });

  it('tiliotetositteella on tiliotepaneeli, ja loppusaldon muutos tallentuu', async () => {
    const { user, client } = await renderRoute('/tositteet/1', {
      seed: SEED,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-09-30',
          tyyppi: 400,
          sarja: '',
          tila: 100,
          otsikko: 'Tiliote 9/2026',
          viennit: [],
          tiliote: { tili: 1910, alkupvm: '2026-09-01', loppupvm: '2026-09-30' },
        });
      },
    });
    const paneeli = await screen.findByRole('region', { name: 'tiliote' });
    expect(within(paneeli).getByLabelText('Tiliotteen kausi alkaen')).toHaveValue('2026-09-01');
    expect(within(paneeli).getByRole('button', { name: 'Lue liitteestä' })).toBeInTheDocument();
    await user.type(within(paneeli).getByLabelText('Tiliotteen loppusaldo'), '6031,76');
    await user.tab();
    await waitFor(async () =>
      expect((await client.haeTosite(1))?.tiliote?.loppusaldo).toBe(603_176),
    );
  });

  it('lukitun kauden tositteella ei ole tyyppivalitsinta', async () => {
    await renderRoute('/tositteet/1', {
      seed: SEED_ALV,
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-04-01',
          tyyppi: 100,
          sarja: '',
          tila: 100,
          viennit: palautumatonViennit('2026-04-01'),
        });
        await c.paivitaAsetukset({ TilitPaatetty: '2026-04-30' });
      },
    });
    expect(await screen.findByText(/lukitulla kaudella/i)).toBeInTheDocument();
    expect(tyyppiValitsin()).not.toBeInTheDocument();
  });
});

describe('Laskun viennit', () => {
  const SEED_OSTO = {
    ...SEED,
    tilit: [
      ...SEED.tilit,
      { numero: 2361, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    ],
  };

  it('ostolasku (erä + ostovelkavienti) ei avaudu ruudukkoon eikä muutu käynnillä', async () => {
    const pvm = '2026-04-01';
    const { user, client, router } = await renderRoute('/tositteet/1', {
      seed: SEED_OSTO,
      arrange: async (c) => {
        await c.luoTosite({
          pvm,
          tyyppi: 100,
          sarja: '',
          tila: 100,
          otsikko: 'Ostolasku',
          viennit: [
            {
              tili: 4000,
              debet: Euro.fromCents(5_000),
              kredit: Euro.fromCents(0),
              pvm,
              alvKoodi: 0,
              alvProsentti: 0,
              tyyppi: 101,
            },
            {
              tili: 2361,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(5_000),
              pvm,
              alvKoodi: 0,
              alvProsentti: 0,
              tyyppi: 102,
              era: 1,
            },
          ],
        });
      },
    });
    const ennen = await client.haeTosite(1);
    expect(await screen.findByText(/ei voi muokata ruudukossa/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Tili, rivi 1/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await client.haeTosite(1)).toEqual(ennen);
  });
});
