import type { TuontiSilta } from '@penni/tuonti';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TuontiNakyma } from './TuontiNakyma';

const YHTEENVETO = {
  nimi: 'Testikirjanpito Oy',
  kpVersio: '24',
  tilikaudet: [{ alkaa: '2025-01-01', loppuu: '2025-12-31' }],
  tilit: 5,
  tositteet: 4,
  viennit: 8,
  liitteet: 1,
  kumppanit: 1,
  ohitetut: { Kohdennus: 3 },
};

const RAPORTTI = {
  tilit: 5,
  tilikaudet: 1,
  asetukset: 4,
  kumppanit: 1,
  tositteet: 4,
  viennit: 8,
  liitteet: 1,
  ohitetut: { Kohdennus: 3 },
  varoitukset: ['Taulua Kohdennus (3 riviä) ei tuotu — Penni ei mallinna sitä.'],
};

function luoSilta(yliajot: Partial<TuontiSilta> = {}): TuontiSilta {
  return {
    valitseJaLue: vi.fn(async () => ({ polku: '/tmp/testi.kitsas', yhteenveto: YHTEENVETO })),
    tuo: vi.fn(async () => ({
      kohde: '/tmp/testi.penni',
      raportti: RAPORTTI,
      taysmaytys: { tasmaa: true, erot: [], maarat: {}, ulkopuoliset: 0 },
    })),
    avaaKirja: vi.fn(async () => undefined),
    ...yliajot,
  };
}

beforeEach(() => {
  window.penni = undefined;
});

describe('TuontiNakyma', () => {
  it('kertoo että tuonti vaatii työpöytäsovelluksen kun siltaa ei ole', () => {
    render(<TuontiNakyma />);
    expect(screen.getByText(/vain työpöytäsovelluksessa/i)).toBeInTheDocument();
  });

  it('näyttää esikatselun valitun tiedoston tiedoilla', async () => {
    window.penni = luoSilta();
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    expect(await screen.findByText('Testikirjanpito Oy')).toBeInTheDocument();
    expect(screen.getByText(/4 tositetta/)).toBeInTheDocument();
    expect(screen.getByText(/Kohdennus/)).toBeInTheDocument();
  });

  it('tuo kirjanpidon ja näyttää onnistuneen täsmäytyksen', async () => {
    const silta = luoSilta();
    window.penni = silta;
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await user.click(await screen.findByRole('button', { name: 'Tuo kirjanpito' }));
    expect(await screen.findByText(/Täsmäytys onnistui/i)).toBeInTheDocument();
    expect(silta.tuo).toHaveBeenCalledWith('/tmp/testi.kitsas', expect.any(Function));
  });

  it('näyttää täsmäytyksen erot tileittäin sentteinä, ei liukulukuina', async () => {
    window.penni = luoSilta({
      tuo: vi.fn(async () => ({
        kohde: '/tmp/testi.penni',
        raportti: RAPORTTI,
        taysmaytys: {
          tasmaa: false,
          erot: [{ tilikausi: '2025-01-01', tili: 4000, kitsas: 19194, penni: 0 }],
          maarat: {},
          ulkopuoliset: 0,
        },
      })),
    });
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await user.click(await screen.findByRole('button', { name: 'Tuo kirjanpito' }));
    expect(await screen.findByText(/Täsmäytys epäonnistui/i)).toBeInTheDocument();
    expect(screen.getByText('4000')).toBeInTheDocument();
    expect(screen.getByText('19194')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('selittää epäonnistumisen kun ainoa syy on tilikausien ulkopuoliset viennit', async () => {
    // erot ja maarat ovat molemmat tyhjiä — vain ulkopuoliset kertoo, miksi täsmäytys
    // epäonnistui. Ilman tätä selitystä ruutu näyttäisi "epäonnistui" ilman mitään syytä.
    window.penni = luoSilta({
      tuo: vi.fn(async () => ({
        kohde: '/tmp/testi.penni',
        raportti: RAPORTTI,
        taysmaytys: { tasmaa: false, erot: [], maarat: {}, ulkopuoliset: 2 },
      })),
    });
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await user.click(await screen.findByRole('button', { name: 'Tuo kirjanpito' }));
    expect(await screen.findByText(/Täsmäytys epäonnistui/i)).toBeInTheDocument();
    expect(screen.getByText(/2 vientiriviä/)).toBeInTheDocument();
    expect(screen.getByText(/tilikausien ulkopuolelle/i)).toBeInTheDocument();
  });

  it('näyttää eriävät määrät kun rivimäärä ei täsmää', async () => {
    window.penni = luoSilta({
      tuo: vi.fn(async () => ({
        kohde: '/tmp/testi.penni',
        raportti: RAPORTTI,
        taysmaytys: {
          tasmaa: false,
          erot: [],
          maarat: {
            tositteet: [4, 3] as [number, number],
            viennit: [8, 8] as [number, number],
          },
          ulkopuoliset: 0,
        },
      })),
    });
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await user.click(await screen.findByRole('button', { name: 'Tuo kirjanpito' }));
    expect(await screen.findByText(/Täsmäytys epäonnistui/i)).toBeInTheDocument();
    // Vain eriävä pari (tositteet) näytetään, ei täsmäävä pari (viennit).
    expect(screen.getByText('tositteet')).toBeInTheDocument();
    expect(screen.queryByText('viennit')).not.toBeInTheDocument();
  });

  it('näyttää virheen kun tuonti epäonnistuu ja palauttaa napin käyttöön', async () => {
    window.penni = luoSilta({
      tuo: vi.fn(async () => {
        throw new Error('Kirjoitus levylle epäonnistui');
      }),
    });
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await user.click(await screen.findByRole('button', { name: 'Tuo kirjanpito' }));
    expect(await screen.findByText(/Kirjoitus levylle epäonnistui/)).toBeInTheDocument();
    // kesken ei saa jäädä päälle: napin pitää olla taas käytettävissä.
    expect(screen.getByRole('button', { name: 'Tuo kirjanpito' })).not.toBeDisabled();
  });

  it('ei näytä tulosta eikä virhettä kun tuonti palauttaa null:in', async () => {
    window.penni = luoSilta({ tuo: vi.fn(async () => null) });
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await user.click(await screen.findByRole('button', { name: 'Tuo kirjanpito' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tuo kirjanpito' })).not.toBeDisabled(),
    );
    expect(screen.queryByText(/Täsmäytys/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('näyttää virheen kun luku epäonnistuu', async () => {
    window.penni = luoSilta({
      valitseJaLue: vi.fn(async () => {
        throw new Error('Tiedosto ei ole Kitsas-kirjanpito');
      }),
    });
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await waitFor(() => expect(screen.getByText(/ei ole Kitsas-kirjanpito/)).toBeInTheDocument());
  });

  it('ei tee mitään kun käyttäjä peruuttaa tiedostonvalinnan', async () => {
    window.penni = luoSilta({ valitseJaLue: vi.fn(async () => null) });
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Tuo kirjanpito' })).not.toBeInTheDocument(),
    );
  });

  it('näyttää virheen kun avaaKirja epäonnistuu', async () => {
    window.penni = luoSilta({
      avaaKirja: vi.fn(async () => {
        throw new Error('Kirjan avaaminen epäonnistui');
      }),
    });
    const user = userEvent.setup();
    render(<TuontiNakyma />);
    await user.click(screen.getByRole('button', { name: 'Valitse Kitsas-tiedosto' }));
    await user.click(await screen.findByRole('button', { name: 'Tuo kirjanpito' }));
    await user.click(await screen.findByRole('button', { name: 'Avaa tuotu kirjanpito' }));
    expect(await screen.findByText(/Kirjan avaaminen epäonnistui/)).toBeInTheDocument();
  });
});
