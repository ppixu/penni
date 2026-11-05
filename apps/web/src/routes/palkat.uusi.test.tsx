import { TYONTEKIJA_A, TYONTEKIJA_B, palkkaSiemen } from '@/test/palkkaFikstuuri';
import { renderRoute } from '@/test/renderRoute';
import type { Cents } from '@penni/euro';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/** Vain tapauksen A henkilö rekisterissä (B ei häiritse summia). */
const VAIN_A = { PalkatTyontekijat: JSON.stringify([TYONTEKIJA_A]) };

function asetaPaivat(maksupaiva: string, alkaa: string, loppuu: string) {
  fireEvent.change(screen.getByLabelText('Maksupäivä'), { target: { value: maksupaiva } });
  fireEvent.change(screen.getByLabelText('Kausi alkaa'), { target: { value: alkaa } });
  fireEvent.change(screen.getByLabelText('Kausi päättyy'), { target: { value: loppuu } });
}

describe('/palkat/uusi', () => {
  it('tapaus A: oletusrivit + 100 km -> esikatselun nettopalkka 2 203,66 €', async () => {
    const { user } = await renderRoute('/palkat/uusi', { seed: palkkaSiemen(VAIN_A) });
    await screen.findByLabelText('Maksupäivä');
    asetaPaivat('2026-10-31', '2026-10-01', '2026-10-31');

    const osio = screen.getByRole('region', { name: 'Testinen Aino' });
    // Oletusrivit: kuukausipalkka työntekijän tiedoista ja puhelinetu
    expect(within(osio).getByLabelText('Kuukausipalkka: summa')).toHaveValue('3000,00');
    expect(within(osio).getByLabelText('Puhelinetu: selite')).toBeInTheDocument();

    await user.selectOptions(within(osio).getByLabelText('Lisää rivi'), 'km');
    await user.type(within(osio).getByLabelText('Kilometrikorvaus: määrä'), '100');

    const laskelma = within(osio).getByLabelText('Laskelma');
    expect(within(laskelma).getByText('2 203,66 €')).toBeInTheDocument();
    expect(within(laskelma).getByText('604,00 €')).toBeInTheDocument();
    // Yhteensä-rivi: brutto 3 020,00, työnantajan kulut 530,01 + 9,36 + 57,68 = 597,05
    const yhteensa = screen.getByLabelText('Yhteensä');
    expect(within(yhteensa).getByText('3 020,00 €')).toBeInTheDocument();
    expect(within(yhteensa).getByText('597,05 €')).toBeInTheDocument();
    expect(within(yhteensa).getByText('2 203,66 €')).toBeInTheDocument();
  });

  it('aktiiviset työntekijät on valittu valmiiksi, ei-aktiiviset eivät näy', async () => {
    const passiivinen = { ...TYONTEKIJA_B, aktiivinen: false };
    await renderRoute('/palkat/uusi', {
      seed: palkkaSiemen({ PalkatTyontekijat: JSON.stringify([TYONTEKIJA_A, passiivinen]) }),
    });
    expect(await screen.findByRole('checkbox', { name: 'Testinen Aino' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Kokeilija Pekka' })).not.toBeInTheDocument();
  });

  it('puuttuvat taulukkoarvot: viesti ja linkki palkka-asetuksiin esikatselun sijaan', async () => {
    await renderRoute('/palkat/uusi', { seed: palkkaSiemen(VAIN_A) });
    await screen.findByLabelText('Maksupäivä');
    asetaPaivat('2027-01-31', '2027-01-01', '2027-01-31');

    const viesti = await screen.findByRole('alert', { name: 'Palkkataulukko puuttuu' });
    expect(viesti).toHaveTextContent('Vuoden 2027 palkkataulukosta puuttuu arvoja');
    expect(viesti).toHaveTextContent('savaBp');
    expect(within(viesti).getByRole('link', { name: /palkka-asetuksiin/ })).toHaveAttribute(
      'href',
      '/palkat/asetukset',
    );
    expect(screen.queryByLabelText('Laskelma')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
  });

  it('tallentaa palkka-ajon ja avaa palkanmaksun sivun', async () => {
    const { user, client, router } = await renderRoute('/palkat/uusi', {
      seed: palkkaSiemen(VAIN_A),
    });
    await screen.findByLabelText('Maksupäivä');
    asetaPaivat('2026-10-31', '2026-10-01', '2026-10-31');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/palkat/1'));
    const t = await client.haeTosite(1);
    expect(t).toMatchObject({ tyyppi: 500, sarja: 'P', otsikko: 'Palkat 10/2026' });
    // 3 000,00 + puhelinetu 20,00: netto 3 000,00 − 604,00 − 220,46 − 26,88 = 2 148,66
    expect(t?.palkka?.henkilot[0]?.tulos.nettopalkka).toBe(214_866);
  });

  it('ilman nettopalkkojen maksutiliä tallennus on estetty ja ohjataan asetuksiin', async () => {
    await renderRoute('/palkat/uusi', { seed: palkkaSiemen({ ...VAIN_A, LaskuMaksutili: '' }) });
    const viesti = await screen.findByRole('alert', { name: 'Maksutili puuttuu' });
    expect(viesti).toHaveTextContent('nettopalkkojen maksutili');
    expect(within(viesti).getByRole('link')).toHaveAttribute('href', '/palkat/asetukset');
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
  });

  it('negatiivinen nettopalkka estää tallennuksen ja kertoo syyn', async () => {
    const ilmanPalkkaa = { ...TYONTEKIJA_A, kuukausipalkka: 0 as Cents };
    await renderRoute('/palkat/uusi', {
      seed: palkkaSiemen({ PalkatTyontekijat: JSON.stringify([ilmanPalkkaa]) }),
    });
    await screen.findByLabelText('Maksupäivä');
    asetaPaivat('2026-10-31', '2026-10-01', '2026-10-31');
    expect(await screen.findByText(/Nettopalkka on negatiivinen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
  });

  it('päivärahojen määrä on kokonaisluku ja km enintään kaksi desimaalia', async () => {
    const { user } = await renderRoute('/palkat/uusi', { seed: palkkaSiemen(VAIN_A) });
    await screen.findByLabelText('Maksupäivä');
    asetaPaivat('2026-10-31', '2026-10-01', '2026-10-31');
    const osio = screen.getByRole('region', { name: 'Testinen Aino' });

    await user.selectOptions(within(osio).getByLabelText('Lisää rivi'), 'kokopaivaraha');
    await user.type(within(osio).getByLabelText('Kokopäiväraha: määrä'), '1,5');
    expect(within(osio).getByText('Määrän on oltava kokonaisluku.')).toBeInTheDocument();

    await user.selectOptions(within(osio).getByLabelText('Lisää rivi'), 'km');
    await user.type(within(osio).getByLabelText('Kilometrikorvaus: määrä'), '12,345');
    expect(within(osio).getByText('Määrä: enintään kaksi desimaalia.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
  });

  it('kauden alku lopun jälkeen estää tallennuksen', async () => {
    await renderRoute('/palkat/uusi', { seed: palkkaSiemen(VAIN_A) });
    await screen.findByLabelText('Maksupäivä');
    asetaPaivat('2026-10-31', '2026-11-01', '2026-10-31');
    expect(screen.getByText('Palkkakauden alku on lopun jälkeen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
  });
});

describe('/palkat/uusi — virhetilanteet', () => {
  it('aiempien palkka-ajojen haun virhe: ilmoitus, ei esikatselua, tallennus estetty', async () => {
    await renderRoute('/palkat/uusi', {
      seed: palkkaSiemen(VAIN_A),
      arrange: async (c) => {
        c.listaaTositteet = async () => {
          throw new Error('verkkovirhe');
        };
      },
    });
    const viesti = await screen.findByRole('alert', { name: 'Aiemmat palkka-ajot puuttuvat' });
    expect(viesti).toHaveTextContent('Aiempien palkka-ajojen haku epäonnistui');
    expect(within(viesti).getByRole('button', { name: 'Yritä uudelleen' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Laskelma')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
  });

  it('erän tallennus epäonnistuu luonnin jälkeen: linkki luotuun ajoon, ei uutta tallennusta', async () => {
    const { user, client } = await renderRoute('/palkat/uusi', { seed: palkkaSiemen(VAIN_A) });
    await screen.findByLabelText('Maksupäivä');
    asetaPaivat('2026-10-31', '2026-10-01', '2026-10-31');
    client.paivitaTosite = async () => {
      throw new Error('yhteys katkesi');
    };
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    const viesti = await screen.findByRole('alert', { name: 'Tallennus kesken' });
    expect(viesti).toHaveTextContent('tositteeksi P 1');
    expect(within(viesti).getByRole('link', { name: 'Avaa palkanmaksu' })).toHaveAttribute(
      'href',
      '/palkat/1',
    );
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
    expect(await client.listaaTositteet({})).toHaveLength(1);
  });
});
