import { LEHTI_SIEMEN, valitseTili } from '@/editori/testHelpers';
import { KuitinLukuKonteksti, type KuitinLukuRiippuvuudet } from '@/kuitit/useKuitinLuku';
import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import type { MemorySeed } from '@penni/storage-memory';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const KUITTI_TEKSTI = [
  'Kahvila   Aamu   Oy',
  'Laskun   paivays   15.07.2026',
  'Alv   14   %   0,79',
  'Yhteensa   EUR   6,40',
].join('\n');

function fakeLuku(
  pdfTeksti: () => Promise<string> = async () => KUITTI_TEKSTI,
): KuitinLukuRiippuvuudet {
  return {
    pdfTeksti: vi.fn(pdfTeksti),
    rasteroiPdf: vi.fn(),
    malli: () => ({ saatavilla: async () => false, lataa: vi.fn(), tulkitse: vi.fn() }),
    ymparisto: () => ({
      latausAsetukset: { selainValimuisti: true },
      onkoLupa: async () => true,
      annaLupa: vi.fn(),
    }),
  };
}

interface UusiAsetukset {
  seed?: MemorySeed;
  polku?: string;
  arrange?: (client: KpClient) => Promise<void>;
}

/** Reitti oletuksena feikatulla kuitinluvulla: liitetestit eivät käynnistä oikeaa työntekijää tai pdf.js:ää. */
function renderUusi(
  luku: KuitinLukuRiippuvuudet = fakeLuku(),
  { seed = LEHTI_SIEMEN, polku = '/tositteet/uusi', arrange }: UusiAsetukset = {},
) {
  return renderRoute(polku, {
    seed,
    ...(arrange ? { arrange } : {}),
    wrapper: (lapset) => (
      <KuitinLukuKonteksti.Provider value={luku}>{lapset}</KuitinLukuKonteksti.Provider>
    ),
  });
}

/** Luku, jonka tulos vapautetaan testissä käsin (luku on kesken, kunnes `vapauta` kutsutaan). */
function viivastettyLuku() {
  let vapauta: (t: string) => void = () => {};
  const r = fakeLuku(
    () =>
      new Promise<string>((res) => {
        vapauta = res;
      }),
  );
  return { r, vapauta: (t: string) => vapauta(t) };
}

const kuitti = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])], 'kuitti.pdf', {
    type: 'application/pdf',
  });

describe('Uusi tosite — ⌘S round-trip (sketch 5)', () => {
  it('tallentaa tasapainoisen tositteen kirjanpitoon oikein sentein', async () => {
    const { user, client } = await renderRoute('/tositteet/uusi', { seed: LEHTI_SIEMEN });
    await valitseTili(user, 1, '7800');
    const debet1 = await screen.findByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '86,40');
    await user.keyboard('{Enter}'); // balancing kredit row 2 = 86,40
    // Meno: tasaava rivi esitäytetään kirjanpidon pankkitilillä.
    expect(screen.getByRole('combobox', { name: /Tili, rivi 2/i })).toHaveValue('1900 Pankkitili');
    await valitseTili(user, 2, '1900'); // give the balancing row an account
    await user.keyboard('{Control>}s{/Control}'); // ⌘S (Control for cross-platform jsdom)

    // Assert via the SAME client the UI used — no mocks.
    await waitFor(async () => {
      const lista = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
      expect(lista).toHaveLength(1);
    });
    const [tosite] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    expect(tosite?.tunniste).toBe(1); // numbered on finalize
    expect(tosite?.viennit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tili: 7800, debet: 8_640, kredit: 0 }),
        expect.objectContaining({ tili: 1900, debet: 0, kredit: 8_640 }),
      ]),
    ); // 8640 = integer cents, not 86.4 float
  });

  it('verollinen osto tuottaa netto- + alv-viennin ja tallentuu tasapainoisena', async () => {
    const { user, client } = await renderRoute('/tositteet/uusi', { seed: LEHTI_SIEMEN });
    await valitseTili(user, 1, '4000'); // expense
    const debet1 = await screen.findByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '125,50'); // gross
    // pick VAT code on row 1
    await user.click(await screen.findByRole('button', { name: /ALV, rivi 1/i }));
    await user.click(await screen.findByRole('option', { name: /^Verollinen osto$/i }));
    await user.keyboard('{Enter}'); // balancing kredit row 2 = 125,50
    await valitseTili(user, 2, '1900'); // bank
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(async () => {
      const lista = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
      expect(lista).toHaveLength(1);
    });
    const [tosite] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    expect(tosite?.viennit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tili: 4000, debet: 10000, alvKoodi: 21 }),
        expect.objectContaining({ debet: 2550, alvKoodi: 221 }), // ALV-saatava
        expect.objectContaining({ tili: 1900, kredit: 12550 }),
      ]),
    );
  });
});

describe('Uusi tosite — Kirjaa ja uusi', () => {
  it('kertoo kirjatun tositteen numeron, linkittää siihen ja aloittaa lomakkeen ilman luonnosta', async () => {
    const { user, client, router } = await renderUusi();
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('10,00{Enter}');
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));

    const linkki = await screen.findByRole('link', { name: 'Meno 1' });
    expect(linkki.closest('p')).toHaveTextContent('Kirjattu: Meno 1');
    const [tosite] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    expect(linkki).toHaveAttribute('href', `/tositteet/${tosite?.id}`);
    expect(screen.getByRole('combobox', { name: /Tili, rivi 1/i })).toHaveValue('');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await client.listaaTositteet({ bucket: 'luonnos' })).toHaveLength(0);
    expect(screen.queryByText('Tallennettu luonnoksena')).not.toBeInTheDocument();

    // Seuraava muutos luo uuden luonnoksen.
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), 'Seuraava');
    await user.tab();
    await waitFor(async () =>
      expect(await client.listaaTositteet({ bucket: 'luonnos' })).toEqual([
        expect.objectContaining({ otsikko: 'Seuraava' }),
      ]),
    );
  });
});

/** Alv-velvollinen kirja: tileillä Kitsas-tyyliset alv-oletukset (alvlaji/alvprosentti). */
const ALV_SIEMEN: MemorySeed = {
  tilit: [
    { numero: 1161, tyyppi: 'A', nimi: { fi: 'Ennakkomaksut' } },
    { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2361, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
    // Tuodun tilikartan vanhentunut 24 %:n oletus -> päivän yleinen kanta (25,5 %).
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' }, alvlaji: 11, alvprosentti: 24 },
    {
      numero: 3010,
      tyyppi: 'CL',
      nimi: { fi: 'Elintarvikemyynti' },
      alvlaji: 11,
      alvprosentti: 14,
    },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Alv Oy', AlvVelvollinen: 'true' },
};

describe('Uusi tosite — alv-koodit', () => {
  it('käänteinen alv (24): syötetty summa on veroton, vero molemmille puolille, tosite täsmää', async () => {
    const { user, client } = await renderRoute('/tositteet/uusi', { seed: ALV_SIEMEN });
    await valitseTili(user, 1, '1161');
    const debet1 = await screen.findByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '1282,31');
    await user.click(await screen.findByRole('button', { name: /ALV, rivi 1/i }));
    await user.click(await screen.findByRole('option', { name: /Tavaroiden yhteisöhankinnat/i }));
    await user.keyboard('{Enter}'); // tasaava kredit-rivi 2 = 1 282,31
    await valitseTili(user, 2, '2361');
    expect(await screen.findByText(/Täsmää/)).toBeInTheDocument();

    await user.keyboard('{Control>}s{/Control}');
    await waitFor(async () => {
      const lista = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
      expect(lista).toHaveLength(1);
    });
    const [tosite] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    expect(tosite?.viennit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tili: 1161, debet: 128231, alvKoodi: 24 }),
        expect.objectContaining({ tili: 1763, debet: 32699, alvKoodi: 224 }),
        expect.objectContaining({ tili: 2939, kredit: 32699, alvKoodi: 124 }),
        expect.objectContaining({ tili: 2361, kredit: 128231 }),
      ]),
    );
  });

  it('esitäyttää rivin alv-koodin tilin oletuksesta päivän kannalla', async () => {
    const { user } = await renderRoute('/tositteet/uusi', { seed: ALV_SIEMEN });
    await valitseTili(user, 1, '3000');
    expect(await screen.findByRole('button', { name: /ALV, rivi 1/i })).toHaveTextContent(
      'Verollinen 25,5 %',
    );
    await user.keyboard('{Enter}');
    await valitseTili(user, 2, '3010');
    expect(await screen.findByRole('button', { name: /ALV, rivi 2/i })).toHaveTextContent(
      'Verollinen 13,5 %', // vanha 14 % -> päivän keskimmäinen kanta (2026: 13,5 %)
    );
  });

  it('ei esitäytä alv-koodia, kun kirjanpito ei ole alv-velvollinen', async () => {
    const { user } = await renderRoute('/tositteet/uusi', {
      seed: { ...ALV_SIEMEN, asetukset: { Nimi: 'Alv Oy', AlvVelvollinen: 'false' } },
    });
    await valitseTili(user, 1, '3000');
    expect(await screen.findByRole('button', { name: /ALV, rivi 1/i })).toHaveTextContent('—');
  });
});

describe('Uusi tosite — poistuminen', () => {
  it('Kirjaa navigoi kirjattuun tositteeseen ilman varoitusta', async () => {
    const { user, router } = await renderUusi();
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('10,00{Enter}');
    await valitseTili(user, 2, '1900');
    await user.click(screen.getByRole('button', { name: 'Kirjaa' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/tositteet\/\d+$/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Kirjaa ja uusi: poistuminen ei varoita', async () => {
    const { user, router } = await renderUusi();
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('10,00{Enter}');
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));
    await screen.findByRole('link', { name: 'Meno 1' });

    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('poistuminen ei kysy, ja kesken jäänyt muutos tallentuu luonnokseksi', async () => {
    const { user, client, router } = await renderUusi();
    // Luonnoksen luonti jää kesken, kunnes navigointi pois on jo alkanut.
    let jatka: () => void = () => {};
    const luo = client.luoTosite.bind(client);
    const luoTosite = vi.spyOn(client, 'luoTosite').mockImplementationOnce(async (syote) => {
      await new Promise<void>((res) => {
        jatka = res;
      });
      return luo(syote);
    });
    await user.type(await screen.findByRole('textbox', { name: 'Selite' }), 'Kesken');
    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    await waitFor(() => expect(luoTosite).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.latestLocation.pathname).toBe('/'));
    await act(async () => jatka());

    await waitFor(async () =>
      expect(await client.listaaTositteet({ bucket: 'luonnos' })).toEqual([
        expect.objectContaining({ otsikko: 'Kesken', tila: 50, tunniste: 0 }),
      ]),
    );
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe('/'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Luonnoksen luonti valmistui vasta poistumisen alettua: osoite ei palaa lomakkeelle.
    await waitFor(() => expect(router.state.isLoading).toBe(false));
    expect(router.latestLocation.pathname).toBe('/');
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toEqual({});
  });

  it('tilikartassa piilotettu tili ei näy tilivalitsimessa', async () => {
    const seed: MemorySeed = {
      ...LEHTI_SIEMEN,
      asetukset: { ...LEHTI_SIEMEN.asetukset, piilotilit: '7800' },
    };
    const { user } = await renderRoute('/tositteet/uusi', { seed });
    const tili = await screen.findByRole('combobox', { name: /Tili, rivi 1/i });
    await user.click(tili);
    await user.type(tili, '7800');
    expect(screen.queryByRole('option', { name: /7800/ })).not.toBeInTheDocument();
    await user.clear(tili);
    await user.type(tili, '1900');
    expect(await screen.findByRole('option', { name: /1900/ })).toBeInTheDocument();
  });
});

describe('Uusi tosite — automaattinen tallennus', () => {
  it('kirjoitus luo yhden luonnoksen ja päivittää sitä; osoite saa ?luonnos= ilman uudelleenlatausta', async () => {
    const { user, client, router, storage } = await renderUusi();
    const selite = await screen.findByRole('textbox', { name: 'Selite' });
    await user.type(selite, 'Kahvit');
    await user.tab();
    expect(await screen.findByText('Tallennettu luonnoksena')).toBeInTheDocument();
    const [luonnos] = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(luonnos).toMatchObject({ otsikko: 'Kahvit', tila: 50, tunniste: 0 });
    await waitFor(() => expect(router.state.location.search).toEqual({ luonnos: luonnos?.id }));
    expect(screen.getByRole('textbox', { name: 'Selite' })).toBe(selite);

    await user.type(selite, ' ja pullat');
    await user.tab();
    await waitFor(async () =>
      expect((await client.haeTosite(luonnos?.id ?? 0))?.otsikko).toBe('Kahvit ja pullat'),
    );
    expect(await client.listaaTositteet({ bucket: 'luonnos' })).toHaveLength(1);
    expect(await storage.getLoki(luonnos?.id ?? 0)).toHaveLength(2);
  });

  it('osoitteen luonnos jatkuu uudelleenlatauksessa', async () => {
    const { user, client } = await renderUusi(fakeLuku(), {
      polku: '/tositteet/uusi?luonnos=1',
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-05-04',
          tyyppi: 100,
          sarja: '',
          tila: 50,
          otsikko: 'Kesken',
          viennit: [],
        });
      },
    });
    const selite = await screen.findByRole('textbox', { name: 'Selite' });
    expect(selite).toHaveValue('Kesken');
    expect(screen.getByLabelText('Päivä')).toHaveValue('2026-05-04');
    await user.type(selite, ' jatkuu');
    await user.tab();
    await waitFor(async () => expect((await client.haeTosite(1))?.otsikko).toBe('Kesken jatkuu'));
    expect(await client.listaaTositteet({ bucket: 'luonnos' })).toHaveLength(1);
  });

  it('paluu jatkettuun luonnokseen näyttää viimeksi tallennetun sisällön', async () => {
    const { user, client, router } = await renderUusi(fakeLuku(), {
      polku: '/tositteet/uusi?luonnos=1',
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-05-04',
          tyyppi: 100,
          sarja: '',
          tila: 50,
          otsikko: 'Kesken',
          viennit: [],
        });
      },
    });
    const selite = await screen.findByRole('textbox', { name: 'Selite' });
    expect(selite).toHaveValue('Kesken');
    await user.type(selite, ' jatkuu');
    await user.tab();
    await waitFor(async () => expect((await client.haeTosite(1))?.otsikko).toBe('Kesken jatkuu'));
    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe('/'));

    // Takaisin: välimuistin ['tosite', 1] on avaushetken versio, lomake avautuu tallennetusta.
    act(() => router.history.back());
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe('/tositteet/uusi'));
    expect(await screen.findByRole('textbox', { name: 'Selite' })).toHaveValue('Kesken jatkuu');
  });

  it('jatketun luonnoksen Kirjaa ja uusi jää uudelle lomakkeelle', async () => {
    const { user, client, router, queryClient } = await renderUusi(fakeLuku(), {
      polku: '/tositteet/uusi?luonnos=1',
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-05-04',
          tyyppi: 100,
          sarja: '',
          tila: 50,
          otsikko: 'Kesken',
          viennit: [],
        });
      },
    });
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('10,00{Enter}');
    await valitseTili(user, 2, '1900');
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));

    await screen.findByRole('link', { name: 'Meno 1' });
    expect((await client.haeTosite(1))?.tila).toBe(100);
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    // Kirjatun luonnoksen uudelleenhaku ei vie pois uudelta lomakkeelta.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(router.state.location.pathname).toBe('/tositteet/uusi');
    expect(screen.getByRole('textbox', { name: 'Selite' })).toHaveValue('');
  });

  it('osoitteen kirjattu tosite avautuu omalle sivulleen', async () => {
    const { router } = await renderUusi(fakeLuku(), {
      polku: '/tositteet/uusi?luonnos=1',
      arrange: async (c) => {
        await c.luoTosite({
          pvm: '2026-05-04',
          tyyppi: 100,
          sarja: '',
          tila: 100,
          otsikko: 'Kirjattu',
          viennit: [],
        });
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/tositteet/1'));
  });

  it('Kirjaa numeroi luonnoksen', async () => {
    const { user, client, router } = await renderUusi();
    await user.type(await screen.findByRole('textbox', { name: 'Selite' }), 'Kahvit');
    await user.tab();
    await screen.findByText('Tallennettu luonnoksena');
    const [luonnos] = await client.listaaTositteet({ bucket: 'luonnos' });
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('10,00{Enter}');
    await valitseTili(user, 2, '1900');
    await user.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(router.state.location.pathname).toBe(`/tositteet/${luonnos?.id}`));
    expect(await client.listaaTositteet({ bucket: 'kirjanpidossa' })).toEqual([
      expect.objectContaining({ id: luonnos?.id, tunniste: 1, otsikko: 'Kahvit' }),
    ]);
    expect(await client.listaaTositteet({ bucket: 'luonnos' })).toHaveLength(0);
  });

  it('lukitun kauden päivä: ei tallennu, kertoo syyn ja kysyy poistuttaessa', async () => {
    const { user, client, router } = await renderUusi(fakeLuku(), {
      seed: {
        ...LEHTI_SIEMEN,
        asetukset: { ...LEHTI_SIEMEN.asetukset, TilitPaatetty: '2026-03-31' },
      },
    });
    fireEvent.change(await screen.findByLabelText('Päivä'), { target: { value: '2026-03-15' } });
    await user.type(screen.getByRole('textbox', { name: 'Selite' }), 'Vanha kuitti');
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
    expect(await client.listaaTositteet({ bucket: 'luonnos' })).toHaveLength(0);
  });

  it('kentästä poistuminen tallentaa juuri ennen poistumista kirjoitetun arvon', async () => {
    const { user, client } = await renderUusi();
    await valitseTili(user, 1, '7800');
    const debet1 = await screen.findByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '12,34'); // summa vahvistuu vasta poistuttaessa
    await user.tab();
    await waitFor(async () => {
      const [luonnos] = await client.listaaTositteet({ bucket: 'luonnos' });
      expect(luonnos?.viennit).toEqual([expect.objectContaining({ tili: 7800, debet: 1_234 })]);
    });
  });

  it('Kirjaa odottaa kesken olevan luonnoksen luonnin: yksi tosite, kirjattuna', async () => {
    const { user, client, router } = await renderUusi();
    // Ensimmäinen luonnoksen luonti jää kesken, kunnes testi päästää sen jatkamaan.
    let jatka: () => void = () => {};
    const luo = client.luoTosite.bind(client);
    const luoTosite = vi.spyOn(client, 'luoTosite').mockImplementationOnce(async (syote) => {
      await new Promise<void>((res) => {
        jatka = res;
      });
      return luo(syote);
    });
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await waitFor(() => expect(luoTosite).toHaveBeenCalledTimes(1));
    await user.keyboard('10,00{Enter}');
    await valitseTili(user, 2, '1900');
    await user.click(screen.getByRole('button', { name: 'Kirjaa' }));
    await act(async () => jatka());

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/tositteet\/\d+$/));
    expect(luoTosite).toHaveBeenCalledTimes(1);
    expect(await client.listaaTositteet({ bucket: 'luonnos' })).toHaveLength(0);
    expect(await client.listaaTositteet({ bucket: 'kirjanpidossa' })).toEqual([
      expect.objectContaining({ tunniste: 1 }),
    ]);
    expect((await client.listaaTositteet({ bucket: 'kirjanpidossa' }))[0]?.viennit).toHaveLength(2);
  });
});

describe('Uusi tosite — liitteet', () => {
  it('näyttää liitteen lisäyksen jo ennen tallennusta', async () => {
    await renderUusi();
    expect(await screen.findByRole('complementary', { name: 'liitepaneeli' })).toBeInTheDocument();
    expect(screen.getByLabelText('Lisää liite')).toBeInTheDocument();
  });

  it('liite luo luonnoksen, tallentuu sille heti ja säilyy kirjattaessa', async () => {
    const { user, client, router } = await renderUusi();
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    const lista = await screen.findByRole('region', { name: 'liitteet' });
    expect(within(lista).getByText('kuitti.pdf')).toBeInTheDocument();
    const [luonnos] = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(luonnos).toMatchObject({ tila: 50, tunniste: 0 });
    await waitFor(() => expect(router.state.location.search).toEqual({ luonnos: luonnos?.id }));
    const liitteet = await client.haeLiitteet(luonnos?.id ?? 0);
    expect(liitteet).toEqual([
      expect.objectContaining({ nimi: 'kuitti.pdf', tyyppi: 'application/pdf' }),
    ]);
    expect(liitteet[0]?.sha).toMatch(/^[0-9a-f]{64}$/);

    await screen.findByText(/Täytetty kuitista/); // kuitti täytti täsmäävät rivit
    await user.click(screen.getByRole('button', { name: 'Kirjaa' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/tositteet/${luonnos?.id}`));
    expect(await client.haeLiitteet(luonnos?.id ?? 0)).toHaveLength(1);
  });

  it('liitteen voi poistaa luonnokselta', async () => {
    const { user, client } = await renderUusi();
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await screen.findByRole('region', { name: 'liitteet' });
    await user.click(await screen.findByRole('button', { name: 'Poista kuitti.pdf' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'liitteet' })).not.toBeInTheDocument(),
    );
    const [luonnos] = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(await client.haeLiitteet(luonnos?.id ?? 0)).toEqual([]);
  });

  it('Kirjaa ja uusi: liite jää kirjatulle, uusi lomake on ilman liitteitä', async () => {
    const { user, client } = await renderUusi();
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await screen.findByText(/Täytetty kuitista/);
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));

    await screen.findByRole('link', { name: 'Meno 1' });
    const [tosite] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    expect(await client.haeLiitteet(tosite?.id ?? 0)).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'liitteet' })).not.toBeInTheDocument(),
    );
  });
});

describe('uusi tosite — kuitin automaattinen luku', () => {
  it('ensimmäinen liite täyttää tyhjän lomakkeen', async () => {
    const { user } = await renderUusi();
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    expect(
      await screen.findByText(
        'Täytetty kuitista (pvm, myyjä, summa) — tarkista ennen tallennusta.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Selite')).toHaveValue('Kahvila Aamu Oy');
  });

  it('käyttäjän lukemisen aikana kirjoittama otsikko säilyy', async () => {
    let vapauta: (t: string) => void = () => {};
    const r = fakeLuku(
      () =>
        new Promise<string>((res) => {
          vapauta = res;
        }),
    );
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() => expect(r.pdfTeksti).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText('Selite'), 'Oma');
    await act(async () => vapauta(KUITTI_TEKSTI));
    // Täyttö tapahtui (pvm + rivit), mutta myyjää ei kirjoitettu käyttäjän otsikon päälle.
    expect(
      await screen.findByText('Täytetty kuitista (pvm, summa) — tarkista ennen tallennusta.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Selite')).toHaveValue('Oma');
    expect(screen.getByLabelText('Päivä')).toHaveValue('2026-07-15');
  });

  it('toinen liite ei täytä uudelleen', async () => {
    const r = fakeLuku();
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await screen.findByText(/Täytetty kuitista/);
    await user.click(screen.getByRole('button', { name: 'Kumoa' }));
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'liitteet' })).getAllByText('kuitti.pdf'),
      ).toHaveLength(2),
    );
    expect(r.pdfTeksti).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument();
    // Kumoa palautti lomakkeen, eikä toinen liite täyttänyt sitä uudelleen.
    expect(screen.getByLabelText('Selite')).toHaveValue('');
  });

  it('liitteen poisto kesken luvun ei täytä mitään', async () => {
    let vapauta: (t: string) => void = () => {};
    let kutsut = 0;
    const r = fakeLuku(() => {
      kutsut += 1;
      if (kutsut > 1)
        return Promise.resolve(KUITTI_TEKSTI.replace('Kahvila   Aamu   Oy', 'Toinen   Oy'));
      return new Promise<string>((res) => {
        vapauta = res;
      });
    });
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() => expect(r.pdfTeksti).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('button', { name: 'Poista kuitti.pdf' }));
    await act(async () => vapauta(KUITTI_TEKSTI)); // hylätyn luvun tulos saapuu
    expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument();
    // Synkronointipiste: uusi liite luetaan; vuotanut vanha tulos antaisi selitteeksi "Kahvila Aamu Oy".
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await screen.findByText(/Täytetty kuitista/);
    expect(screen.getByLabelText('Selite')).toHaveValue('Toinen Oy');
  });

  it('Kirjaa ja uusi kesken liitteen tallennuksen: liitettä ei lueta uudelle lomakkeelle', async () => {
    const r = fakeLuku();
    const { user, client } = await renderUusi(r);
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('10,00{Enter}');
    await valitseTili(user, 2, '1900');
    // Liitteen tallennus jää kesken, kunnes testi päästää sen jatkamaan.
    let jatka: () => void = () => {};
    const tallenna = client.tallennaLiite.bind(client);
    const tallennaLiite = vi.spyOn(client, 'tallennaLiite').mockImplementationOnce(async (l) => {
      await new Promise<void>((res) => {
        jatka = res;
      });
      return tallenna(l);
    });
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() => expect(tallennaLiite).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));
    await screen.findByRole('link', { name: 'Meno 1' });
    await act(async () => jatka());

    // Liite jää kirjatulle tositteelle, mutta sitä ei lueta uuteen lomakkeeseen.
    const [kirjattu] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    await waitFor(async () => expect(await client.haeLiitteet(kirjattu?.id ?? 0)).toHaveLength(1));
    await act(async () => new Promise((res) => setTimeout(res, 20)));
    expect(r.pdfTeksti).not.toHaveBeenCalled();
    expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Selite')).toHaveValue('');
  });

  it('Kirjaa ja uusi liitteiden haun aikana: liitettä ei lueta uudelle lomakkeelle', async () => {
    const r = fakeLuku();
    const { user, client } = await renderUusi(r);
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('10,00{Enter}');
    await valitseTili(user, 2, '1900');
    // Liite tallentuu, mutta liitteiden haku (ensimmäisen liitteen tunnistus) jää kesken.
    const odottavat: (() => void)[] = [];
    const hae = client.haeLiitteet.bind(client);
    const haeLiitteet = vi.spyOn(client, 'haeLiitteet').mockImplementation(async (id) => {
      await new Promise<void>((res) => {
        odottavat.push(res);
      });
      return hae(id);
    });
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    const [luonnos] = await client.listaaTositteet({ bucket: 'luonnos' });
    await waitFor(async () => expect(await hae(luonnos?.id ?? 0)).toHaveLength(1));
    await waitFor(() => expect(haeLiitteet).toHaveBeenCalledWith(luonnos?.id));
    await act(async () => new Promise((res) => setTimeout(res, 20)));
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));
    await screen.findByRole('link', { name: 'Meno 1' });
    haeLiitteet.mockImplementation(hae);
    await act(async () => {
      for (const jatka of odottavat) jatka();
      await new Promise((res) => setTimeout(res, 20));
    });

    expect(r.pdfTeksti).not.toHaveBeenCalled();
    expect(screen.queryByText(/Täytetty kuitista/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Selite')).toHaveValue('');
  });

  it('Tallenna ja uusi: seuraavan tositteen ensimmäinen liite luetaan taas', async () => {
    const r = fakeLuku();
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await screen.findByText(/Täytetty kuitista/);
    expect(r.pdfTeksti).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));
    await screen.findByRole('link', { name: 'Meno 1' });
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() => expect(r.pdfTeksti).toHaveBeenCalledTimes(2));
  });

  it('Tallenna ja uusi: seuraavan kuitin päivä täytetään säilytetyn päivän tilalle', async () => {
    const toinen = KUITTI_TEKSTI.replace('Kahvila   Aamu   Oy', 'Kioski   Oy').replace(
      '15.07.2026',
      '20.07.2026',
    );
    let kutsut = 0;
    const r = fakeLuku(async () => {
      kutsut += 1;
      return kutsut === 1 ? KUITTI_TEKSTI : toinen;
    });
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await screen.findByText(/Täytetty kuitista/);
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));
    await screen.findByRole('link', { name: 'Meno 1' });
    // Nollaus säilyttää edellisen päivän; siitä tulee lomakkeen uusi oletus.
    expect(screen.getByLabelText('Päivä')).toHaveValue('2026-07-15');

    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    expect(
      await screen.findByText(
        'Täytetty kuitista (pvm, myyjä, summa) — tarkista ennen tallennusta.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Päivä')).toHaveValue('2026-07-20');
    expect(screen.getByLabelText('Selite')).toHaveValue('Kioski Oy');
  });

  it('Tallenna ja uusi: seuraavan kuitin täyttö jättää fokuksen ensimmäiseen tilisoluun', async () => {
    let kutsut = 0;
    let vapauta: (t: string) => void = () => {};
    const r = fakeLuku(() => {
      kutsut += 1;
      if (kutsut === 1) return Promise.resolve(KUITTI_TEKSTI);
      return new Promise<string>((res) => {
        vapauta = res;
      });
    });
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await screen.findByText(/Täytetty kuitista/);
    await user.click(screen.getByRole('button', { name: 'Kirjaa ja uusi' }));
    await screen.findByRole('link', { name: 'Meno 1' });
    const tili1 = screen.getByRole('combobox', { name: /Tili, rivi 1/i });
    await waitFor(() => expect(tili1).toHaveFocus());

    // Kuitti pudotetaan: fokus ei liiku tilisolusta.
    fireEvent.change(screen.getByLabelText('Lisää liite'), { target: { files: [kuitti()] } });
    await waitFor(() => expect(r.pdfTeksti).toHaveBeenCalledTimes(2));
    expect(tili1).toHaveFocus();
    await act(async () => vapauta(KUITTI_TEKSTI));
    await screen.findByText(/Täytetty kuitista/);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /Tili, rivi 2/i })).toHaveValue(
        '1900 Pankkitili',
      ),
    );
    expect(screen.getByRole('combobox', { name: /Tili, rivi 1/i })).toHaveFocus();
    for (const lista of screen.queryAllByRole('listbox')) {
      expect(lista.id).toBe(tili1.getAttribute('aria-controls'));
    }
  });

  it('lukemisen aikana riviin kirjoitettu, vahvistamaton summa säilyy', async () => {
    const { r, vapauta } = viivastettyLuku();
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() => expect(r.pdfTeksti).toHaveBeenCalledTimes(1));
    const debet1 = screen.getByRole('textbox', { name: /Debet, rivi 1/i });
    await user.click(debet1);
    await user.type(debet1, '12,00'); // ei vielä vahvistettu (ei Enteriä eikä poistumista)
    await act(async () => vapauta(KUITTI_TEKSTI));
    // Päivä ja otsikko täytetään, rivejä ei.
    expect(
      await screen.findByText('Täytetty kuitista (pvm, myyjä) — tarkista ennen tallennusta.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Debet, rivi 1/i })).toHaveValue('12,00');
    expect(screen.getByRole('textbox', { name: /Debet, rivi 1/i })).toHaveFocus();
    expect(screen.queryByRole('textbox', { name: /Debet, rivi 2/i })).not.toBeInTheDocument();
    // Kirjoitettu summa vahvistuu normaalisti.
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: /Kredit, rivi 2/i })).toHaveValue('12,00');
  });

  it('lukemisen aikana tilisoluun kirjoitettu haku säilyy', async () => {
    const { r, vapauta } = viivastettyLuku();
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() => expect(r.pdfTeksti).toHaveBeenCalledTimes(1));
    const tili1 = screen.getByRole('combobox', { name: /Tili, rivi 1/i });
    await user.click(tili1);
    await user.type(tili1, '78');
    await act(async () => vapauta(KUITTI_TEKSTI));
    await screen.findByText('Täytetty kuitista (pvm, myyjä) — tarkista ennen tallennusta.');
    expect(screen.getByRole('combobox', { name: /Tili, rivi 1/i })).toHaveValue('78');
    expect(screen.getByRole('combobox', { name: /Tili, rivi 1/i })).toHaveFocus();
  });

  it('täyttö ei siirrä fokusta: otsikkoon kirjoittaminen jatkuu', async () => {
    const { r, vapauta } = viivastettyLuku();
    const { user } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() => expect(r.pdfTeksti).toHaveBeenCalledTimes(1));
    const selite = screen.getByLabelText('Selite');
    await user.type(selite, 'Oma');
    await act(async () => vapauta(KUITTI_TEKSTI));
    await screen.findByText('Täytetty kuitista (pvm, summa) — tarkista ennen tallennusta.');
    expect(screen.getByRole('textbox', { name: /Debet, rivi 1/i })).toHaveValue('6,40');
    expect(selite).toHaveFocus();
    await user.keyboard(' lisää');
    expect(selite).toHaveValue('Oma lisää');
  });

  it('kirjauksen aikana saapuva tulos ei muuta lomaketta eikä estä poistumista', async () => {
    const { r, vapauta } = viivastettyLuku();
    const { user, client, router } = await renderUusi(r);
    await user.upload(await screen.findByLabelText('Lisää liite'), kuitti());
    await waitFor(() => expect(r.pdfTeksti).toHaveBeenCalledTimes(1));
    await valitseTili(user, 1, '7800');
    await user.click(await screen.findByRole('textbox', { name: /Debet, rivi 1/i }));
    await user.keyboard('10,00{Enter}');
    await valitseTili(user, 2, '1900');
    // Liite loi jo luonnoksen, joten kirjaus päivittää sen; kirjaus jää kesken, kunnes testi päästää.
    let jatka: () => void = () => {};
    const paivita = client.paivitaTosite.bind(client);
    const paivitaTosite = vi
      .spyOn(client, 'paivitaTosite')
      .mockImplementation(async (id, syote) => {
        if (syote.tila === 100)
          await new Promise<void>((res) => {
            jatka = res;
          });
        return paivita(id, syote);
      });
    await user.click(screen.getByRole('button', { name: 'Kirjaa' }));
    await waitFor(() =>
      expect(paivitaTosite).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ tila: 100 }),
      ),
    );
    await act(async () => vapauta(KUITTI_TEKSTI)); // tulos saapuu kesken kirjauksen
    await act(async () => jatka());

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/tositteet\/\d+$/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
