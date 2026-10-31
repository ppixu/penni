import { renderRoute } from '@/test/renderRoute';
import type { Kuittilahde, Tilitapahtuma } from '@penni/engine';
import { AlvKoodi, TositeTila, TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import type { TasmaysAineisto, TasmaysSilta } from '@penni/luku';
import { render, screen, within } from '@testing-library/react';
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

/** window.penni tukee vain täsmäytysmetodeja — Tuonti-metodit eivät kuulu tähän testiin. */
function luoSilta(yliajot: Partial<TasmaysSilta> = {}): TasmaysSilta {
  return {
    valitseTiliote: vi.fn(async () => '/tmp/tiliote.pdf'),
    valitseKuittikansio: vi.fn(async () => '/tmp/kuitit'),
    lueAineisto: vi.fn(async () => ({
      tiliote: { tiedosto: '', muoto: 'tapahtumat' as const, tapahtumat: [] },
      kuitit: [],
      lukematta: [],
    })),
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
    expect(lueAineisto).toHaveBeenCalledWith('/tmp/tiliote.pdf', null, expect.any(Function));
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
