import { renderRoute } from '@/test/renderRoute';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
    { numero: 2871, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'true',
    OletusMenotili: '4000',
    OstoVelkaTili: '2871',
    AlvVelkaTili: '2939',
    LaskuMaksutili: '1900',
  },
};

describe('Uusi ostolasku -lomake', () => {
  it('kirjaa ostolaskun ja navigoi näkymään; live-summa näyttää käännetyn veron erikseen', async () => {
    const { user, client } = await renderRoute('/ostolaskut/uusi', { seed: SEED });
    await screen.findByLabelText('ostolaskulomake');

    // Tallenna on aluksi disabloitu (ei summallista riviä). Ostolaskulla ei vaadita
    // toimittajaa (poikkeaa myyntilaskusta — ostovelan era avautuu ilman kumppaniakin).
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();

    // Toimittaja pikaluonti: KumppaniValitsin/KumppaniDialog uudelleenkäytetään sellaisenaan
    // (ei "toimittaja"-tekstiä listalle/dialogille — vain combobox saa oman aria-labelin
    // "Toimittaja" ariaLabel-propilla; ks. task-6-report.md komponenttirajoitteesta).
    const toimittaja = screen.getByRole('combobox', { name: 'Toimittaja' });
    await user.click(toimittaja);
    await user.type(toimittaja, 'Tukku');
    await user.keyboard('{Enter}');
    const dialogi = await screen.findByRole('dialog', { name: 'Uusi asiakas' });
    await user.type(within(dialogi).getByLabelText('Nimi'), 'Tukku Oy');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    // Dialogi sulkeutuu ja valitsin näyttää uuden toimittajan (kumppanit-invalidointi).
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Toimittaja' })).toHaveValue('Tukku Oy'),
    );

    // Täytä rivi: selite + à-hinta 100 € (EuroInput committoi blurissa). Oletuskoodi
    // alv-velvolliselle on OSTOT_NETTO 25,5 % → vähennettävä alv nostaa maksettavaa.
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'Tavaraostoja');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '100');
    await user.tab();

    const summat = screen.getByLabelText('summat');
    expect(summat).toHaveTextContent('Veroton');
    expect(summat).toHaveTextContent('100,00 €');
    expect(summat).toHaveTextContent('Vähennettävä ALV');
    expect(summat).toHaveTextContent('25,50 €');
    expect(summat).toHaveTextContent('Maksettava');
    expect(summat).toHaveTextContent('125,50 €');
    // Käännettyä veroa ei ole tällä rivillä — rivi jää kokonaan pois summista.
    expect(summat).not.toHaveTextContent('Käännetty ALV');

    // Tallenna → moottori numeroi ja kirjaa ostolaskun → navigointi näkymään.
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByLabelText('ostolaskunäkymä')).toBeInTheDocument();

    // Saman clientin kautta: lista näyttää oikean summan ja avoimen; toimittaja persistoitui.
    const lista = await client.listaaOstolaskut({});
    expect(lista).toHaveLength(1);
    expect(lista[0]?.summa).toBe(Euro.fromCents(12_550));
    expect(lista[0]?.avoin).toBe(Euro.fromCents(12_550));
    expect(lista[0]?.toimittaja).toBe('Tukku Oy');
    expect((await client.haeKumppanit()).some((k) => k.nimi === 'Tukku Oy')).toBe(true);
  });

  it('käännetyn verovelvollisuuden ostolla käännetty alv näytetään erikseen eikä nosta maksettavaa', async () => {
    const { user } = await renderRoute('/ostolaskut/uusi', { seed: SEED });
    await screen.findByLabelText('ostolaskulomake');

    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '100');
    await user.tab();

    // Vaihda rivin alv-koodi EU-tavaraostoksi (käännetty verovelvollisuus).
    await user.click(screen.getByRole('button', { name: 'ALV, rivi 1' }));
    await user.click(screen.getByRole('option', { name: 'Tavaroiden yhteisöhankinnat' }));

    const summat = screen.getByLabelText('summat');
    expect(summat).toHaveTextContent('Veroton');
    expect(summat).toHaveTextContent('100,00 €');
    expect(summat).toHaveTextContent('Käännetty ALV');
    expect(summat).toHaveTextContent('25,50 €');
    // Käännetty alv ei nosta maksettavaa: veroton == maksettava.
    expect(summat).toHaveTextContent('Maksettava');
    const teksti = summat.textContent ?? '';
    expect((teksti.match(/100,00\s?€/g) ?? []).length).toBe(2);

    // Toimittajaa ei vaadita: Tallenna on käytössä pelkällä rivisummalla.
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeEnabled();
  });

  it('rivin lisäys ja poisto pitävät aina vähintään yhden rivin', async () => {
    const { user } = await renderRoute('/ostolaskut/uusi', { seed: SEED });
    await screen.findByLabelText('ostolaskulomake');

    await user.click(screen.getByRole('button', { name: 'Lisää rivi' }));
    expect(screen.getByLabelText('Selite, rivi 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Poista rivi 2' }));
    expect(screen.queryByLabelText('Selite, rivi 2')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Poista rivi 1' }));
    // Lattia 1: viimeisen rivin poisto jättää tyhjän rivin.
    expect(screen.getByLabelText('Selite, rivi 1')).toBeInTheDocument();
  });
});

describe('Uusi ostolasku — tallentamattomat muutokset', () => {
  it('tallennus navigoi ostolaskuun ilman varoitusta', async () => {
    const { user, router } = await renderRoute('/ostolaskut/uusi', { seed: SEED });
    await screen.findByLabelText('ostolaskulomake');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '100');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/ostolaskut\/\d+$/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muokattu ostolasku varoittaa poistuttaessa', async () => {
    const { user, router } = await renderRoute('/ostolaskut/uusi', { seed: SEED });
    await screen.findByLabelText('ostolaskulomake');
    await user.type(screen.getByLabelText('Viite'), 'INV-42');
    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));

    expect(
      await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Poistu tallentamatta' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
