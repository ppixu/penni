import { renderRoute } from '@/test/renderRoute';
import type {
  CsvEsikatselu,
  CsvSarakkeet as CsvSarakejako,
  Kuittilahde,
  Tilitapahtuma,
} from '@penni/engine';
import { AlvKoodi, TositeTila, TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import type { TasmaysAineisto, TasmaysSilta } from '@penni/luku';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasmaysNakyma } from './TasmaysNakyma.js';

afterEach(() => {
  window.penni = undefined;
});

// Cents on brändätty tyyppi (@penni/euro); testien literaalit tarvitsevat pienen castin.
const c = (n: number): Cents => n as Cents;

const SEED = {
  tilit: [
    { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 7690, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy' },
};

function tapahtuma(pvm: string, nimi: string, maara: number): Tilitapahtuma {
  return { pvm, nimi, maara: c(maara) };
}

function kuitti(tiedosto: string, kuitti: Kuittilahde['kuitti']): Kuittilahde {
  return { tiedosto, kuitti };
}

/**
 * window.penni tukee vain täsmäytysmetodeja — Tuonti-metodit eivät kuulu tähän testiin.
 * Oletussilta on vanha työpöytäversio ilman `tiliotePolku`a (Valitse tiliote -nappi);
 * pudotusta testaavat antavat sen yliajona.
 */
function luoSilta(yliajot: Partial<TasmaysSilta> = {}): TasmaysSilta {
  return {
    valitseTiliote: vi.fn(async () => '/tmp/tiliote.pdf'),
    valitseKuittikansio: vi.fn(async () => '/tmp/kuitit'),
    lueAineisto: vi.fn(async () => ({
      tiliote: { tiedosto: '', muoto: 'tapahtumat' as const, tapahtumat: [] },
      kuitit: [],
      lukematta: [],
    })),
    esikatseleTiliote: vi.fn(async () => ({ lahde: 'pdf' as const })),
    lueTiedosto: vi.fn(async () => new Uint8Array()),
    ...yliajot,
  };
}

function asetaSilta(silta: TasmaysSilta): void {
  window.penni = silta as unknown as typeof window.penni;
}

describe('TasmaysNakyma', () => {
  it('kertoo selaimessa että toiminto on vain työpöytäsovelluksessa', () => {
    render(<TasmaysNakyma />);
    expect(screen.getByText(/vain työpöytäsovelluksessa/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /valitse tiliote/i })).not.toBeInTheDocument();
  });

  it('valitsee molemmat tiedostot, lukee aineiston ja ryhmittelee rivit', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'tapahtumat',
        tapahtumat: [
          tapahtuma('2026-06-02', 'PILVIPALVELU OY', -2500),
          tapahtuma('2026-06-03', 'TUNTEMATON KAHVILA', -1500),
          tapahtuma('2026-06-04', 'CURSOR INC', -1000),
        ],
      },
      kuitit: [
        kuitti('/tmp/kuitit/pilvi.pdf', {
          valuutta: 'EUR',
          myyja: 'Pilvipalvelu Oy',
          pvm: '2026-06-02',
          bruttoSumma: c(2500),
          alv: [{ kanta: 24, brutto: c(2500) }],
        }),
        kuitti('/tmp/kuitit/cursor.pdf', {
          valuutta: 'EUR',
          myyja: 'Cursor Inc',
          pvm: '2026-06-04',
          bruttoSumma: c(1200), // eri summa kuin tapahtuma → nimitäsmäys, ei tasmays
          alv: [{ kanta: 24, brutto: c(1200) }],
        }),
      ],
      lukematta: [],
    };
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto) }));

    const { user } = await renderRoute('/tasmays', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));

    const tyolista = await screen.findByLabelText('työlista');
    expect(within(tyolista).getByText('Valmiina kirjattavaksi (1)')).toBeInTheDocument();
    expect(within(tyolista).getByText('Kuitti puuttuu (1)')).toBeInTheDocument();
    expect(within(tyolista).getByText('Summa ei täsmää (1)')).toBeInTheDocument();
    // 'Valmiina kirjattavaksi' on oletuksena kasassa — vain nimitäsmäys ja kuittiPuuttuu
    // renderöityvät auki suoraan.
    await user.click(within(tyolista).getByRole('button', { name: 'Näytä' }));
    expect(within(tyolista).getByText('PILVIPALVELU OY')).toBeInTheDocument();
    expect(within(tyolista).getByText('TUNTEMATON KAHVILA')).toBeInTheDocument();
    expect(within(tyolista).getByText('CURSOR INC')).toBeInTheDocument();
  });

  it('katsoo sekä kirjanpidossa- että luonnos-tositteet ettei osittain kirjattua erää ehdoteta uudelleen', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'tapahtumat',
        tapahtumat: [tapahtuma('2026-06-03', 'JO KIRJATTU OY', -2500)],
      },
      kuitit: [],
      lukematta: [],
    };
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto) }));

    const { user } = await renderRoute('/tasmays', {
      seed: SEED,
      // Ennalta luotu LUONNOS-tosite samalla päivällä + summalla pankkitilille — täytyy
      // löytyä vaikka se ei ole vielä kirjanpidossa (bucket: 'kirjanpidossa' ei riittäisi).
      arrange: async (client) => {
        await client.luoTosite({
          pvm: '2026-06-03',
          tyyppi: TositeTyyppi.MENO,
          tila: TositeTila.LUONNOS,
          sarja: '',
          viennit: [
            {
              tili: 7690,
              debet: c(2500),
              kredit: c(0),
              pvm: '2026-06-03',
              alvKoodi: AlvKoodi.EIALV,
              alvProsentti: 0,
            },
            {
              tili: 1910,
              debet: c(0),
              kredit: c(2500),
              pvm: '2026-06-03',
              alvKoodi: AlvKoodi.EIALV,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));

    const tyolista = await screen.findByLabelText('työlista');
    expect(within(tyolista).getByText('Jo kirjattu (1)')).toBeInTheDocument();
    expect(within(tyolista).getByText('Kuitti puuttuu (0)')).toBeInTheDocument();
  });

  it('kirjaa valitut rivit luonnoksiksi ja siirtää ne Jo kirjattu -ryhmään', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'tapahtumat',
        tapahtumat: [tapahtuma('2026-06-02', 'PILVIPALVELU OY', -2500)],
      },
      kuitit: [
        // kanta 0 (veroton): pitää testin tilikartan pelkkänä pankkitili+menotili-parina,
        // ei vaadi omaa ALV-saatava-tiliä (generoiVeroviennit).
        kuitti('/tmp/kuitit/pilvi.pdf', {
          valuutta: 'EUR',
          myyja: 'Pilvipalvelu Oy',
          pvm: '2026-06-02',
          bruttoSumma: c(2500),
          alv: [{ kanta: 0, brutto: c(2500) }],
        }),
      ],
      lukematta: [],
    };
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto) }));

    const { user } = await renderRoute('/tasmays', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));

    const tyolista = await screen.findByLabelText('työlista');
    await user.click(within(tyolista).getByRole('button', { name: 'Näytä' }));
    // Täsmätty rivi on valmiiksi valittuna (rakennaTyolista: valittu = ei vielä kirjattu).
    expect(within(tyolista).getByRole('checkbox', { name: /PILVIPALVELU OY/i })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Kirjaa valitut (1)' }));

    expect(await within(tyolista).findByText('Jo kirjattu (1)')).toBeInTheDocument();
    expect(within(tyolista).getByText('Valmiina kirjattavaksi (0)')).toBeInTheDocument();
  });

  it('näyttää LukuVirhe-viestin ilman Electronin IPC-etuliitettä', async () => {
    asetaSilta(
      luoSilta({
        lueAineisto: vi.fn(async () => {
          throw new Error(
            "Error invoking remote method 'tasmays:lueAineisto': LukuVirhe: " +
              'Tiedostosta ei löytynyt yhtään tapahtumaa.',
          );
        }),
      }),
    );

    const { user } = await renderRoute('/tasmays', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));

    const virhe = await screen.findByRole('alert');
    expect(virhe).toHaveTextContent('Tiedostosta ei löytynyt yhtään tapahtumaa.');
    expect(virhe.textContent).not.toMatch(/Error invoking remote method/);
  });

  it('näyttää kuitit ilman tapahtumaa ja lukematta jääneet omina ryhminään', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'tapahtumat',
        tapahtumat: [tapahtuma('2026-06-02', 'TUNTEMATON KAHVILA', -1500)],
      },
      // Summa ei täsmää eikä nimi osu tapahtumaan → kuitti jää ilman tapahtumaa.
      kuitit: [
        kuitti('/tmp/kuitit/orpo.pdf', {
          valuutta: 'EUR',
          myyja: 'Orpo Oy',
          pvm: '2026-06-02',
          bruttoSumma: c(999),
          alv: [{ kanta: 24, brutto: c(999) }],
        }),
      ],
      lukematta: [{ tiedosto: '/tmp/kuitit/skannattu.pdf', syy: 'Ei tekstikerrosta' }],
    };
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto) }));

    const { user } = await renderRoute('/tasmays', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));

    const tyolista = await screen.findByLabelText('työlista');
    expect(within(tyolista).getByText('Kuitit ilman tapahtumaa (1)')).toBeInTheDocument();
    expect(within(tyolista).getByText('Lukematta jääneet kuitit (1)')).toBeInTheDocument();
    for (const nappi of within(tyolista).getAllByRole('button', { name: 'Näytä' })) {
      await user.click(nappi);
    }
    expect(within(tyolista).getByText('orpo.pdf')).toBeInTheDocument();
    expect(within(tyolista).getByText('skannattu.pdf — Ei tekstikerrosta')).toBeInTheDocument();
  });

  it('ei jätä riviä uudelleenkirjattavaksi kun tosite syntyi mutta liite ei', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'tapahtumat',
        tapahtumat: [tapahtuma('2026-06-02', 'PILVIPALVELU OY', -2500)],
      },
      kuitit: [
        kuitti('/tmp/kuitit/pilvi.pdf', {
          valuutta: 'EUR',
          myyja: 'Pilvipalvelu Oy',
          pvm: '2026-06-02',
          bruttoSumma: c(2500),
          alv: [{ kanta: 0, brutto: c(2500) }],
        }),
      ],
      lukematta: [],
    };
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto) }));

    const { user } = await renderRoute('/tasmays', {
      seed: SEED,
      arrange: async (client) => {
        vi.spyOn(client, 'tallennaLiite').mockRejectedValue(new Error('Levy on täynnä'));
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));

    const tyolista = await screen.findByLabelText('työlista');
    await user.click(within(tyolista).getAllByRole('button', { name: 'Näytä' })[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Kirjaa valitut (1)' }));

    // Tosite on kirjassa: rivi siirtyy Jo kirjattu -ryhmään eikä ole enää valittuna, joten
    // seuraava klikkaus ei voi luoda samaa tositetta uudelleen. Liitteen virhe näkyy silti.
    expect(await within(tyolista).findByText('Jo kirjattu (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kirjaa valitut (0)' })).toBeDisabled();
    await user.click(within(tyolista).getAllByRole('button', { name: 'Näytä' })[0] as HTMLElement);
    expect(within(tyolista).getByText(/liite jäi tallentamatta/i)).toBeInTheDocument();
  });

  it('kertoo kun myyjäsäännön tallennus epäonnistuu eikä jätä valintaruutua valituksi', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'tapahtumat',
        tapahtumat: [tapahtuma('2026-06-03', 'TUNTEMATON KAHVILA', -1500)],
      },
      kuitit: [],
      lukematta: [],
    };
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto) }));

    const { user } = await renderRoute('/tasmays', {
      seed: SEED,
      arrange: async (client) => {
        vi.spyOn(client, 'paivitaAsetukset').mockRejectedValue(new Error('ei onnistu'));
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));

    const tyolista = await screen.findByLabelText('työlista');
    await user.click(within(tyolista).getByText('TUNTEMATON KAHVILA'));
    const tiliValitsin = screen.getByRole('combobox', { name: 'Tili' });
    await user.click(tiliValitsin);
    await user.type(tiliValitsin, '7690');
    await user.keyboard('{Enter}');

    const saantoRuutu = screen.getByRole('checkbox', { name: /aina tilille/i });
    await user.click(saantoRuutu);

    expect(await screen.findByRole('alert')).toHaveTextContent('Tallennus epäonnistui.');
    expect(saantoRuutu).not.toBeChecked();
  });

  it('näyttää valitun rivin tiedot oikeassa paneelissa', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'tapahtumat',
        tapahtumat: [tapahtuma('2026-06-02', 'PILVIPALVELU OY', -2500)],
      },
      kuitit: [
        kuitti('/tmp/kuitit/pilvi.pdf', {
          valuutta: 'EUR',
          myyja: 'Pilvipalvelu Oy',
          pvm: '2026-06-02',
          bruttoSumma: c(2500),
          alv: [{ kanta: 24, brutto: c(2500) }],
        }),
      ],
      lukematta: [],
    };
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto) }));

    const { user } = await renderRoute('/tasmays', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));

    const tyolista = await screen.findByLabelText('työlista');
    await user.click(within(tyolista).getByRole('button', { name: 'Näytä' }));
    await user.click(within(tyolista).getByText('PILVIPALVELU OY'));

    const rivinTiedot = screen.getByLabelText('rivin tiedot');
    expect(within(rivinTiedot).getByText('Pilvipalvelu Oy')).toBeInTheDocument();
    expect(within(rivinTiedot).getByText('pilvi.pdf')).toBeInTheDocument();
  });

  it('lukee kuukausitiliotteen ilman kuittikansiota ja täsmää saldot kirjanpitoon', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'kuukausitiliote',
        kausi: { alkaa: '2026-06-01', loppuu: '2026-06-30' },
        alkusaldo: c(10000),
        loppusaldo: c(7500),
        tapahtumat: [tapahtuma('2026-06-02', 'PILVIPALVELU OY', -2500)],
      },
      kuitit: [],
      lukematta: [],
    };
    const lueAineisto = vi.fn(async () => aineisto);
    asetaSilta(luoSilta({ lueAineisto }));

    const { user } = await renderRoute('/tasmays', {
      seed: SEED,
      // Pankkitilin saldo 100,00 ennen kautta = tiliotteen alkusaldo.
      arrange: async (client) => {
        await client.luoTosite({
          pvm: '2026-05-15',
          tyyppi: TositeTyyppi.TULO,
          tila: TositeTila.KIRJANPIDOSSA,
          sarja: '',
          viennit: [
            {
              tili: 1910,
              debet: c(10000),
              kredit: c(0),
              pvm: '2026-05-15',
              alvKoodi: AlvKoodi.EIALV,
              alvProsentti: 0,
            },
            {
              tili: 7690,
              debet: c(0),
              kredit: c(10000),
              pvm: '2026-05-15',
              alvKoodi: AlvKoodi.EIALV,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));

    const saldot = await screen.findByLabelText('tiliotteen saldot');
    expect(lueAineisto).toHaveBeenCalledWith(
      '/tmp/tiliote.pdf',
      null,
      expect.any(Function),
      undefined,
    );
    expect(saldot).toHaveTextContent('tapahtumat täsmäävät saldoihin');
    expect(await within(saldot).findByText(/kirjanpidon saldo .* täsmää/)).toBeInTheDocument();
    const tyolista = screen.getByLabelText('työlista');
    expect(within(tyolista).getByText('Kuitti puuttuu (1)')).toBeInTheDocument();
  });

  it('tallentaa kuukausitiliotteen Tiliote-tositteeksi liitteineen vain kerran', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote_6_26.pdf',
        muoto: 'kuukausitiliote',
        kausi: { alkaa: '2026-06-01', loppuu: '2026-06-30' },
        alkusaldo: c(10000),
        loppusaldo: c(7500),
        tapahtumat: [tapahtuma('2026-06-02', 'PILVIPALVELU OY', -2500)],
      },
      kuitit: [],
      lukematta: [],
    };
    const lueTiedosto = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto), lueTiedosto }));
    const { user, client } = await renderRoute('/tasmays', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await user.click(await screen.findByRole('button', { name: 'Tallenna tiliote tositteeksi' }));

    expect(await screen.findByRole('link', { name: 'Tiliote 6/2026' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tallenna tiliote tositteeksi' })).toBeNull();
    const [tosite, ...muut] = await client.listaaTositteet({ tyyppi: TositeTyyppi.TILIOTE });
    expect(muut).toHaveLength(0);
    expect(tosite?.tiliote).toEqual({
      tili: 1910,
      alkupvm: '2026-06-01',
      loppupvm: '2026-06-30',
      alkusaldo: 10000,
      loppusaldo: 7500,
    });
    expect(lueTiedosto).toHaveBeenCalledWith('/tmp/tiliote_6_26.pdf');
    const liitteet = await client.haeLiitteet(tosite?.id ?? 0);
    expect(liitteet.map((l) => l.nimi)).toEqual(['tiliote_6_26.pdf']);
  });

  it('esitäyttää tilin kirjaushistoriasta ja tarjoaa sitä samannimisille', async () => {
    const aineisto: TasmaysAineisto = {
      tiliote: {
        tiedosto: '/tmp/tiliote.pdf',
        muoto: 'tapahtumat',
        tapahtumat: [
          tapahtuma('2026-06-02', 'PILVIPALVELU OY', -2500),
          tapahtuma('2026-07-02', 'PILVIPALVELU OY', -2500),
        ],
      },
      kuitit: [],
      lukematta: [],
    };
    asetaSilta(luoSilta({ lueAineisto: vi.fn(async () => aineisto) }));

    const { user } = await renderRoute('/tasmays', {
      seed: {
        ...SEED,
        tilit: [...SEED.tilit, { numero: 6800, tyyppi: 'D', nimi: { fi: 'Muut kulut' } }],
      },
      arrange: async (client) => {
        await client.luoTosite({
          pvm: '2026-05-02',
          tyyppi: TositeTyyppi.MENO,
          tila: TositeTila.KIRJANPIDOSSA,
          sarja: '',
          otsikko: 'Pilvipalvelu toukokuu',
          viennit: [
            {
              tili: 7690,
              debet: c(2500),
              kredit: c(0),
              pvm: '2026-05-02',
              alvKoodi: AlvKoodi.EIALV,
              alvProsentti: 0,
            },
            {
              tili: 1910,
              debet: c(0),
              kredit: c(2500),
              pvm: '2026-05-02',
              selite: 'PILVIPALVELU OY',
              alvKoodi: AlvKoodi.EIALV,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));

    const tyolista = await screen.findByLabelText('työlista');
    expect(await within(tyolista).findByText('Kuitti puuttuu (2)')).toBeInTheDocument();
    await user.click(within(tyolista).getAllByText('PILVIPALVELU OY')[0] as HTMLElement);
    const rivinTiedot = screen.getByLabelText('rivin tiedot');
    expect(within(rivinTiedot).getByText(/Ehdotus kirjaushistoriasta/)).toHaveTextContent(
      'Pilvipalvelu kesäkuu',
    );
    expect(
      within(rivinTiedot).queryByRole('button', { name: /samannimisille/ }),
    ).not.toBeInTheDocument();

    const tiliValitsin = within(rivinTiedot).getByRole('combobox', { name: 'Tili' });
    // Fokus valitsee esitäytetyn tilin tekstin, joten kirjoitus korvaa sen.
    await user.click(tiliValitsin);
    await user.keyboard('6800{Enter}');
    const samat = within(rivinTiedot).getByRole('button', {
      name: 'Sama tili kaikille samannimisille (1)',
    });
    await user.click(samat);
    expect(
      within(rivinTiedot).queryByRole('button', { name: /samannimisille/ }),
    ).not.toBeInTheDocument();
  });
});

describe('TasmaysNakyma — kuitin lisäys riville', () => {
  /** CURSOR-veloitus ilman kuittia + kuitti, joka ei täsmää siihen (eri myyjä, summa, päivä). */
  const AINEISTO: TasmaysAineisto = {
    tiliote: {
      tiedosto: '/tmp/tiliote.pdf',
      muoto: 'tapahtumat',
      tapahtumat: [tapahtuma('2026-06-29', 'CURSOR', -1743)],
    },
    kuitit: [
      kuitti('/tmp/kuitit/cursor.pdf', {
        valuutta: 'EUR',
        myyja: 'Anysphere',
        pvm: '2026-06-10',
        bruttoSumma: c(2000),
        alv: [{ kanta: 0, brutto: c(2000) }],
      }),
    ],
    lukematta: [],
  };
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]);

  async function avaa() {
    asetaSilta(
      luoSilta({ lueAineisto: vi.fn(async () => AINEISTO), lueTiedosto: vi.fn(async () => PDF) }),
    );
    const r = await renderRoute('/tasmays', { seed: SEED });
    await r.user.click(await screen.findByRole('button', { name: 'Valitse tiliote' }));
    await r.user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));
    const tyolista = await screen.findByLabelText('työlista');
    expect(within(tyolista).getByText('Kuitti puuttuu (1)')).toBeInTheDocument();
    await r.user.click(within(tyolista).getByText('CURSOR'));
    return { ...r, tyolista, rivinTiedot: screen.getByLabelText('rivin tiedot') };
  }

  it('liittää kuitin "kuitit ilman tapahtumaa" -listalta ja kirjaa sen liitteeksi', async () => {
    const { user, client, tyolista, rivinTiedot } = await avaa();
    await user.click(within(rivinTiedot).getByRole('button', { name: /Liitä cursor\.pdf/ }));

    expect(within(tyolista).getByText('Kuitti puuttuu (0)')).toBeInTheDocument();
    expect(within(tyolista).getByText('Valmiina kirjattavaksi (1)')).toBeInTheDocument();
    expect(within(rivinTiedot).getByText('cursor.pdf')).toBeInTheDocument();
    expect(within(rivinTiedot).getByText('Anysphere')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Kirjaa valitut (1)' }));
    expect(await within(tyolista).findByText('Jo kirjattu (1)')).toBeInTheDocument();
    const [tosite] = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(await client.haeLiitteet(tosite?.id ?? 0)).toEqual([
      expect.objectContaining({ nimi: 'cursor.pdf', tyyppi: 'application/pdf' }),
    ]);
  });

  it('irrottaa liitetyn kuitin takaisin liittämättömiin', async () => {
    const { user, tyolista, rivinTiedot } = await avaa();
    await user.click(within(rivinTiedot).getByRole('button', { name: /Liitä cursor\.pdf/ }));
    await user.click(within(rivinTiedot).getByRole('button', { name: 'Irrota kuitti' }));
    expect(within(tyolista).getByText('Kuitti puuttuu (1)')).toBeInTheDocument();
    expect(
      within(rivinTiedot).getByRole('button', { name: /Liitä cursor\.pdf/ }),
    ).toBeInTheDocument();
  });

  it('liittää koneelta valitun tiedoston tositteelle kirjauksessa', async () => {
    const { user, client, tyolista, rivinTiedot } = await avaa();
    await user.upload(
      within(rivinTiedot).getByLabelText('Lisää liite'),
      new File([PDF], 'oma.pdf', { type: 'application/pdf' }),
    );
    const omat = await within(rivinTiedot).findByRole('list', { name: 'omat liitteet' });
    expect(within(omat).getByText('oma.pdf')).toBeInTheDocument();
    expect(within(tyolista).getByText('Kuitti puuttuu (0)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Kirjaa valitut (1)' }));
    expect(await within(tyolista).findByText('Jo kirjattu (1)')).toBeInTheDocument();
    const [tosite] = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(await client.haeLiitteet(tosite?.id ?? 0)).toEqual([
      expect.objectContaining({ nimi: 'oma.pdf' }),
    ]);
  });

  it('kirjaa käsin editorissa esitäytettynä ja palaa työlistaan', async () => {
    const { user, client, rivinTiedot } = await avaa();
    const tiliValitsin = within(rivinTiedot).getByRole('combobox', { name: 'Tili' });
    await user.click(tiliValitsin);
    await user.keyboard('7690{Enter}');
    await user.click(within(rivinTiedot).getByRole('button', { name: /Liitä cursor\.pdf/ }));
    await user.click(within(rivinTiedot).getByRole('button', { name: 'Kirjaa käsin' }));

    expect(await screen.findByText('Kirjaa käsin · CURSOR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tallenna ja uusi' })).not.toBeInTheDocument();
    // Liitetty kuitti odottaa editorin liitepaneelissa.
    const paneeli = screen.getByRole('complementary', { name: 'liitepaneeli' });
    expect(await within(paneeli).findByText('cursor.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    const tyolista = await screen.findByLabelText('työlista');
    expect(await within(tyolista).findByText('Jo kirjattu (1)')).toBeInTheDocument();
    const [tosite] = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    expect(tosite?.viennit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tili: 7690, debet: 1743 }),
        expect.objectContaining({ tili: 1910, kredit: 1743 }),
      ]),
    );
    expect(await client.haeLiitteet(tosite?.id ?? 0)).toEqual([
      expect.objectContaining({ nimi: 'cursor.pdf' }),
    ]);
  });

  it('Takaisin palaa käsikirjauksesta työlistaan kirjaamatta', async () => {
    const { user, client, rivinTiedot } = await avaa();
    await user.click(within(rivinTiedot).getByRole('button', { name: 'Kirjaa käsin' }));
    await user.click(await screen.findByRole('button', { name: 'Takaisin täsmäytykseen' }));
    const tyolista = await screen.findByLabelText('työlista');
    expect(within(tyolista).getByText('Kuitti puuttuu (1)')).toBeInTheDocument();
    expect(await client.listaaTositteet({ bucket: 'kirjanpidossa' })).toHaveLength(0);
  });

  it('keskeneräinen käsikirjaus varoittaa poistuttaessa', async () => {
    const { user, router, rivinTiedot } = await avaa();
    await user.click(within(rivinTiedot).getByRole('button', { name: 'Kirjaa käsin' }));
    await user.type(await screen.findByRole('textbox', { name: 'Selite' }), ' (korjaus)');
    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));
    expect(
      await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jää sivulle' }));
    expect(router.state.location.pathname).toBe('/tasmays');
  });
});

describe('TasmaysNakyma — tiliotetiedoston pudotus ja CSV-sarakkeet', () => {
  /** Samat tapahtumat kuin PDF-testissä "valitsee molemmat tiedostot…". */
  const TAPAHTUMAT = [
    tapahtuma('2026-06-02', 'PILVIPALVELU OY', -2500),
    tapahtuma('2026-06-03', 'TUNTEMATON KAHVILA', -1500),
    tapahtuma('2026-06-04', 'CURSOR INC', -1000),
  ];
  const IBAN = 'FI7455550000012343';

  function camtAineisto(tiedosto = '/tmp/lokakuu.xml'): TasmaysAineisto {
    return {
      tiliote: {
        tiedosto,
        muoto: 'kuukausitiliote',
        kausi: { alkaa: '2026-06-01', loppuu: '2026-06-30' },
        alkusaldo: c(10000),
        loppusaldo: c(5000),
        tapahtumat: TAPAHTUMAT,
        lahde: 'camt053',
        iban: IBAN,
      },
      kuitit: [],
      lukematta: [],
    };
  }

  function csvAineisto(tiedosto: string): TasmaysAineisto {
    return {
      tiliote: {
        tiedosto,
        muoto: 'tapahtumat',
        kausi: { alkaa: '2026-10-02', loppuu: '2026-10-30' },
        tapahtumat: [
          tapahtuma('2026-10-02', 'Testi Oy', -1250),
          tapahtuma('2026-10-30', 'Maija Malli', 10000),
        ],
        lahde: 'csv',
        kausiPaatelty: true,
      },
      kuitit: [],
      lukematta: [],
    };
  }

  const TUNTEMATON_CSV: CsvEsikatselu = {
    otsikot: ['Päivä', 'Summa', 'Kuvaus', 'Saaja'],
    esimerkit: [
      ['2.10.2026', '-12,50', 'Kahvi lokakuu', 'Testi Oy'],
      ['30.10.2026', '100,00', 'Lasku 1001', 'Maija Malli'],
    ],
    avain: 'päivä|summa|kuvaus|saaja',
    ehdotus: { pvm: 0, pvmMuoto: 'd.m.yyyy', maara: 1, nimi: [], viesti: [2] },
  };
  const DANSKE_CSV: CsvEsikatselu = {
    ...TUNTEMATON_CSV,
    avain: 'pvm|määrä|viesti|saaja/maksaja',
    otsikot: ['Pvm', 'Määrä', 'Viesti', 'Saaja/Maksaja'],
    ehdotus: { pvm: 0, pvmMuoto: 'd.m.yyyy', maara: 1, nimi: [3], viesti: [2] },
    pankki: 'Danske Bank',
  };

  const tiliotePolku = () => vi.fn(async (f: File) => `/tmp/${f.name}`);

  /** Kirjan tiedot (pankkitili, asetukset) on ladattu ennen ensimmäistä pudotusta. */
  async function odotaKirja() {
    await screen.findByLabelText('Tiliote');
    await screen.findAllByText('Demo Oy');
  }

  function pudota(nimi: string) {
    const alue = screen.getByLabelText('Tiliote').closest('label') as HTMLElement;
    fireEvent.drop(alue, { dataTransfer: { files: [new File(['x'], nimi)] } });
  }

  it('pudotettu camt-tiedosto luetaan ja antaa saman työlistan kuin PDF', async () => {
    const polku = tiliotePolku();
    const esikatseleTiliote = vi.fn(async () => ({ lahde: 'camt053' as const }));
    const lueAineisto = vi.fn(async () => camtAineisto());
    asetaSilta(luoSilta({ tiliotePolku: polku, esikatseleTiliote, lueAineisto }));

    await renderRoute('/tasmays', { seed: SEED });
    await odotaKirja();
    expect(screen.getByText(/PDF, camt\.053\/054 \(XML\), TITO tai CSV\./)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Valitse tiliote' })).not.toBeInTheDocument();
    pudota('lokakuu.xml');

    const tyolista = await screen.findByLabelText('työlista');
    expect(await within(tyolista).findByText('Kuitti puuttuu (3)')).toBeInTheDocument();
    expect(polku).toHaveBeenCalledWith(expect.objectContaining({ name: 'lokakuu.xml' }));
    expect(esikatseleTiliote).toHaveBeenCalledWith('/tmp/lokakuu.xml');
    expect(lueAineisto).toHaveBeenCalledWith(
      '/tmp/lokakuu.xml',
      null,
      expect.any(Function),
      undefined,
    );
    for (const nimi of ['PILVIPALVELU OY', 'TUNTEMATON KAHVILA', 'CURSOR INC'])
      expect(within(tyolista).getByText(nimi)).toBeInTheDocument();
    expect(screen.getByLabelText('tiliotteen saldot')).toHaveTextContent(
      'camt.053 · Kausi 1.6.2026–30.6.2026 · 3 tapahtumaa',
    );
    expect(screen.queryByRole('button', { name: 'Vaihda sarakkeet' })).not.toBeInTheDocument();
  });

  it('tuntematon CSV avaa sarakejaon, jonka vahvistus tallentuu kirjaan ja lukee tiedoston', async () => {
    const lueAineisto = vi.fn(async () => csvAineisto('/tmp/tilitapahtumat.csv'));
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'csv' as const, csv: TUNTEMATON_CSV })),
        lueAineisto,
      }),
    );
    let paivitaAsetukset: ReturnType<typeof vi.fn> | undefined;
    const { user } = await renderRoute('/tasmays', {
      seed: SEED,
      arrange: async (client) => {
        paivitaAsetukset = vi.spyOn(client, 'paivitaAsetukset') as unknown as ReturnType<
          typeof vi.fn
        >;
      },
    });
    await odotaKirja();
    pudota('tilitapahtumat.csv');

    expect(
      await screen.findByRole('heading', { name: 'Mitä sarakkeet sisältävät?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sarake Päivä' })).toHaveValue('pvm');
    expect(screen.getByRole('combobox', { name: 'Sarake Summa' })).toHaveValue('maara');
    expect(lueAineisto).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sarake Saaja' }), 'Nimi');
    await user.click(screen.getByRole('button', { name: 'Lue tiliote' }));

    const odotettu: CsvSarakejako = {
      pvm: 0,
      pvmMuoto: 'd.m.yyyy',
      maara: 1,
      nimi: [3],
      viesti: [2],
    };
    const tyolista = await screen.findByLabelText('työlista');
    expect(await within(tyolista).findByText('Testi Oy')).toBeInTheDocument();
    expect(paivitaAsetukset).toHaveBeenCalledTimes(1);
    const patch = paivitaAsetukset?.mock.calls[0]?.[0] as Record<string, string>;
    expect(JSON.parse(patch.TiliotteenCsvSarakkeet ?? '')).toEqual([
      { otsikko: TUNTEMATON_CSV.avain, sarakkeet: odotettu },
    ]);
    expect(lueAineisto).toHaveBeenCalledWith(
      '/tmp/tilitapahtumat.csv',
      null,
      expect.any(Function),
      { csvSarakkeet: odotettu },
    );
    expect(screen.queryByRole('heading', { name: 'Mitä sarakkeet sisältävät?' })).toBeNull();
    expect(screen.getByLabelText('tiliotteen saldot')).toHaveTextContent(
      'CSV · Tapahtumat 2.10.2026–30.10.2026 · 2 tapahtumaa',
    );
  });

  it('tunnetun pankin CSV luetaan suoraan, ja Vaihda sarakkeet avaa sarakejaon uudelleen', async () => {
    const lueAineisto = vi.fn(async () => csvAineisto('/tmp/danske.csv'));
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'csv' as const, csv: DANSKE_CSV })),
        lueAineisto,
      }),
    );
    const { user } = await renderRoute('/tasmays', { seed: SEED });
    await odotaKirja();
    pudota('danske.csv');

    const saldot = await screen.findByLabelText('tiliotteen saldot');
    expect(saldot).toHaveTextContent(
      'CSV · Danske Bank · Tapahtumat 2.10.2026–30.10.2026 · 2 tapahtumaa',
    );
    expect(lueAineisto).toHaveBeenCalledWith('/tmp/danske.csv', null, expect.any(Function), {
      csvSarakkeet: DANSKE_CSV.ehdotus,
    });
    expect(screen.queryByRole('heading', { name: 'Mitä sarakkeet sisältävät?' })).toBeNull();
    // Päätelty kausi ei tee tiedostosta Tiliote-tositetta.
    expect(screen.queryByRole('button', { name: 'Tallenna tiliote tositteeksi' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Vaihda sarakkeet' }));
    expect(screen.getByRole('heading', { name: 'Mitä sarakkeet sisältävät?' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sarake Saaja/Maksaja' })).toHaveValue('nimi');
    await user.click(screen.getByRole('button', { name: 'Lue tiliote' }));
    await screen.findByLabelText('tiliotteen saldot');
    expect(lueAineisto).toHaveBeenCalledTimes(2);
  });

  it('kirjaan tallennettu sarakejako voittaa pankkiprofiilin', async () => {
    const tallennettu: CsvSarakejako = {
      pvm: 0,
      pvmMuoto: 'd.m.yyyy',
      maara: 1,
      nimi: [2],
      viesti: [],
    };
    const lueAineisto = vi.fn(async () => csvAineisto('/tmp/danske.csv'));
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'csv' as const, csv: DANSKE_CSV })),
        lueAineisto,
      }),
    );
    await renderRoute('/tasmays', {
      seed: {
        ...SEED,
        asetukset: {
          ...SEED.asetukset,
          TiliotteenCsvSarakkeet: JSON.stringify([
            { otsikko: DANSKE_CSV.avain, sarakkeet: tallennettu },
          ]),
        },
      },
    });
    await odotaKirja();
    pudota('danske.csv');

    await screen.findByLabelText('tiliotteen saldot');
    expect(lueAineisto).toHaveBeenCalledWith('/tmp/danske.csv', null, expect.any(Function), {
      csvSarakkeet: tallennettu,
    });
  });

  it('kuittikansion valinta lukee CSV:n uudelleen samalla sarakejaolla', async () => {
    const lueAineisto = vi.fn(async () => csvAineisto('/tmp/danske.csv'));
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'csv' as const, csv: DANSKE_CSV })),
        lueAineisto,
      }),
    );
    const { user } = await renderRoute('/tasmays', { seed: SEED });
    await odotaKirja();
    pudota('danske.csv');
    await screen.findByLabelText('tiliotteen saldot');
    await user.click(screen.getByRole('button', { name: 'Valitse kuittikansio' }));
    await screen.findByLabelText('tiliotteen saldot');
    expect(lueAineisto).toHaveBeenLastCalledWith(
      '/tmp/danske.csv',
      '/tmp/kuitit',
      expect.any(Function),
      { csvSarakkeet: DANSKE_CSV.ehdotus },
    );
  });

  it('tarjoaa Tiliote-tositetta vain ilmoitetulle kaudelle ja tallentaa tiedoston oikeana tyyppinä', async () => {
    const lueTiedosto = vi.fn(async () => new Uint8Array([60, 63, 120, 109, 108]));
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'camt053' as const })),
        lueAineisto: vi.fn(async () => camtAineisto()),
        lueTiedosto,
      }),
    );
    const { user, client } = await renderRoute('/tasmays', { seed: SEED });
    await odotaKirja();
    pudota('lokakuu.xml');
    await user.click(await screen.findByRole('button', { name: 'Tallenna tiliote tositteeksi' }));

    expect(await screen.findByRole('link', { name: 'Tiliote 6/2026' })).toBeInTheDocument();
    const [tosite] = await client.listaaTositteet({ tyyppi: TositeTyyppi.TILIOTE });
    expect(tosite?.tiliote?.iban).toBe(IBAN);
    expect(lueTiedosto).toHaveBeenCalledWith('/tmp/lokakuu.xml');
    expect(await client.haeLiitteet(tosite?.id ?? 0)).toEqual([
      expect.objectContaining({ nimi: 'lokakuu.xml', tyyppi: 'application/xml' }),
    ]);
  });

  it('päätellyn kauden tiliotetta ei tarjota tallennettavaksi', async () => {
    const aineisto = camtAineisto();
    aineisto.tiliote = { ...aineisto.tiliote, lahde: 'camt054', kausiPaatelty: true };
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'camt054' as const })),
        lueAineisto: vi.fn(async () => aineisto),
      }),
    );
    await renderRoute('/tasmays', { seed: SEED });
    await odotaKirja();
    pudota('lokakuu.xml');

    const saldot = await screen.findByLabelText('tiliotteen saldot');
    expect(saldot).toHaveTextContent('camt.054 · Tapahtumat 1.6.2026–30.6.2026 · 3 tapahtumaa');
    expect(screen.queryByRole('button', { name: 'Tallenna tiliote tositteeksi' })).toBeNull();
  });

  it('väärän tiedoston virhe näytetään siistittynä eikä aiemmin luettu työlista katoa', async () => {
    const esikatseleTiliote = vi
      .fn<TasmaysSilta['esikatseleTiliote']>()
      .mockResolvedValueOnce({ lahde: 'camt053' })
      .mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'tasmays:esikatseleTiliote': LukuVirhe: " +
            'Tunnistamaton tiedosto: valitse PDF-, camt-, TITO- tai CSV-tiliote.',
        ),
      );
    const lueAineisto = vi.fn(async () => camtAineisto());
    asetaSilta(luoSilta({ tiliotePolku: tiliotePolku(), esikatseleTiliote, lueAineisto }));
    await renderRoute('/tasmays', { seed: SEED });
    await odotaKirja();
    pudota('lokakuu.xml');
    const tyolista = await screen.findByLabelText('työlista');
    expect(await within(tyolista).findByText('Kuitti puuttuu (3)')).toBeInTheDocument();

    pudota('kuva.jpg');
    const virhe = await screen.findByRole('alert');
    expect(virhe).toHaveTextContent(
      'Tunnistamaton tiedosto: valitse PDF-, camt-, TITO- tai CSV-tiliote.',
    );
    expect(virhe.textContent).not.toMatch(/Error invoking remote method|LukuVirhe/);
    expect(lueAineisto).toHaveBeenCalledTimes(1);
    expect(within(tyolista).getByText('Kuitti puuttuu (3)')).toBeInTheDocument();
    expect(within(tyolista).getByText('PILVIPALVELU OY')).toBeInTheDocument();
    expect(screen.getByText('/tmp/lokakuu.xml')).toBeInTheDocument();
  });

  it('kaatuvaa sarakejakoa ei tallenneta, ja sarakejaon voi avata virheen vierestä', async () => {
    const lueAineisto = vi.fn<TasmaysSilta['lueAineisto']>(async () => {
      throw new Error(
        "Error invoking remote method 'tasmays:lueAineisto': LukuVirhe: " +
          'Virheellinen summa "abc" (rivi 30)',
      );
    });
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'csv' as const, csv: TUNTEMATON_CSV })),
        lueAineisto,
      }),
    );
    let paivitaAsetukset: ReturnType<typeof vi.fn> | undefined;
    const { user } = await renderRoute('/tasmays', {
      seed: SEED,
      arrange: async (client) => {
        paivitaAsetukset = vi.spyOn(client, 'paivitaAsetukset') as unknown as ReturnType<
          typeof vi.fn
        >;
      },
    });
    await odotaKirja();
    pudota('tilitapahtumat.csv');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Sarake Saaja' }), 'Nimi');
    await user.click(screen.getByRole('button', { name: 'Lue tiliote' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Virheellinen summa "abc" (rivi 30)',
    );
    expect(lueAineisto).toHaveBeenCalledTimes(1);
    expect(paivitaAsetukset).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Vaihda sarakkeet' }));
    expect(screen.getByRole('heading', { name: 'Mitä sarakkeet sisältävät?' })).toBeInTheDocument();
    // Esitäytetty juuri yritetyllä jaolla, jotta korjattavaksi jää vain väärä sarake.
    expect(screen.getByRole('combobox', { name: 'Sarake Saaja' })).toHaveValue('nimi');
  });

  it.each([
    ['tallennettu sarakejako', true],
    ['pankkiprofiili', false],
  ])('kaatuvan luvun jälkeen (%s) Vaihda sarakkeet on tarjolla', async (_, tallennettu) => {
    const jako: CsvSarakejako = { pvm: 0, pvmMuoto: 'd.m.yyyy', maara: 1, nimi: [2], viesti: [] };
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'csv' as const, csv: DANSKE_CSV })),
        lueAineisto: vi.fn(async () => {
          throw new Error('LukuVirhe: Virheellinen päivämäärä "Yhteensä" (rivi 30)');
        }),
      }),
    );
    const { user } = await renderRoute('/tasmays', {
      seed: tallennettu
        ? {
            ...SEED,
            asetukset: {
              ...SEED.asetukset,
              TiliotteenCsvSarakkeet: JSON.stringify([
                { otsikko: DANSKE_CSV.avain, sarakkeet: jako },
              ]),
            },
          }
        : SEED,
    });
    await odotaKirja();
    pudota('danske.csv');

    expect(await screen.findByRole('alert')).toHaveTextContent('Virheellinen päivämäärä');
    await user.click(screen.getByRole('button', { name: 'Vaihda sarakkeet' }));
    expect(screen.getByRole('combobox', { name: 'Sarake Viesti' })).toHaveValue(
      tallennettu ? 'nimi' : 'viesti',
    );
  });

  /** Lupaus, jonka testi ratkaisee itse. */
  function lykatty<T>() {
    let ratkaise!: (arvo: T) => void;
    const lupaus = new Promise<T>((r) => {
      ratkaise = r;
    });
    return { lupaus, ratkaise };
  }

  it('hitaan aiemman esikatselun tulos ei korvaa uudempaa tiedostoa', async () => {
    const hidas = lykatty<{ lahde: 'pdf' }>();
    const esikatseleTiliote = vi.fn(async (polku: string) =>
      polku.endsWith('.pdf') ? hidas.lupaus : { lahde: 'camt053' as const },
    );
    const lueAineisto = vi.fn(async (polku: string) =>
      polku.endsWith('.xml')
        ? camtAineisto(polku)
        : {
            tiliote: {
              tiedosto: polku,
              muoto: 'tapahtumat' as const,
              tapahtumat: [tapahtuma('2026-06-09', 'VÄÄRÄ OY', -100)],
            },
            kuitit: [],
            lukematta: [],
          },
    );
    asetaSilta(luoSilta({ tiliotePolku: tiliotePolku(), esikatseleTiliote, lueAineisto }));
    await renderRoute('/tasmays', { seed: SEED });
    await odotaKirja();
    pudota('vaara.pdf');
    pudota('lokakuu.xml');
    const tyolista = await screen.findByLabelText('työlista');
    expect(await within(tyolista).findByText('Kuitti puuttuu (3)')).toBeInTheDocument();

    hidas.ratkaise({ lahde: 'pdf' });
    await new Promise((r) => setTimeout(r, 50));
    expect(lueAineisto).toHaveBeenCalledTimes(1);
    expect(within(tyolista).getByText('Kuitti puuttuu (3)')).toBeInTheDocument();
    expect(screen.getByText('/tmp/lokakuu.xml')).toBeInTheDocument();
  });

  it('hitaan aiemman luvun tulos ei korvaa uudemman luvun työlistaa', async () => {
    const hidas = lykatty<TasmaysAineisto>();
    const nopea = lykatty<TasmaysAineisto>();
    const lueAineisto = vi.fn((polku: string) =>
      polku.endsWith('vaara.xml') ? hidas.lupaus : nopea.lupaus,
    );
    asetaSilta(
      luoSilta({
        tiliotePolku: tiliotePolku(),
        esikatseleTiliote: vi.fn(async () => ({ lahde: 'camt053' as const })),
        lueAineisto,
      }),
    );
    await renderRoute('/tasmays', { seed: SEED });
    await odotaKirja();
    pudota('vaara.xml');
    await vi.waitFor(() => expect(lueAineisto).toHaveBeenCalledTimes(1));
    pudota('lokakuu.xml');
    await vi.waitFor(() => expect(lueAineisto).toHaveBeenCalledTimes(2));

    nopea.ratkaise(camtAineisto('/tmp/lokakuu.xml'));
    const tyolista = await screen.findByLabelText('työlista');
    expect(await within(tyolista).findByText('Kuitti puuttuu (3)')).toBeInTheDocument();
    hidas.ratkaise({
      tiliote: {
        tiedosto: '/tmp/vaara.xml',
        muoto: 'tapahtumat',
        tapahtumat: [tapahtuma('2026-06-09', 'VÄÄRÄ OY', -100)],
      },
      kuitit: [],
      lukematta: [],
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(within(tyolista).getByText('Kuitti puuttuu (3)')).toBeInTheDocument();
    expect(within(tyolista).queryByText('VÄÄRÄ OY')).toBeNull();
    expect(screen.getByLabelText('tiliotteen saldot')).toHaveTextContent('camt.053');
  });

  it('vanha työpöytäversio ilman tiliotePolkua saa Valitse tiliote -napin', async () => {
    asetaSilta(luoSilta());
    await renderRoute('/tasmays', { seed: SEED });
    expect(await screen.findByRole('button', { name: 'Valitse tiliote' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Tiliote')).not.toBeInTheDocument();
  });

  it('ohje nimeää kaikki tiliotemuodot', async () => {
    asetaSilta(luoSilta());
    await renderRoute('/tasmays', { seed: SEED });
    expect(
      await screen.findByText(
        'Pankin tiliote PDF:nä, camt-XML:nä, TITO-tiedostona tai CSV:nä. Jokaisesta tilitapahtumasta tulee työlistalle rivi.',
      ),
    ).toBeInTheDocument();
  });
});
