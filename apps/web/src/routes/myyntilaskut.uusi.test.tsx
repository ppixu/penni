import { renderRoute } from '@/test/renderRoute';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
    { numero: 2251, tyyppi: 'BE', nimi: { fi: 'Edellisten tilikausien voitto' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden voitto' } },
    { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Alv-velka' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    AlvVelvollinen: 'true',
    OletusMyyntitili: '3000',
    LaskuSaatavaTili: '1701',
    AlvVelkaTili: '2939',
    LaskuMaksutili: '1900',
    // HUOM: LaskuKateistili puuttuu tarkoituksella (EILASKUTILIA-virhetesti).
  },
};

describe('Uusi myyntilasku -lomake', () => {
  it('luo laskun pikaluodulla asiakkaalla, näyttää live-summat ja navigoi dokumenttiin', async () => {
    const { user, client } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');

    // Tallenna on aluksi disabloitu (ei summallista riviä, ei asiakasta).
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();

    // Pikaluo asiakas: tyhjällä kumppanilistalla ainoa vaihtoehto on "+ Uusi asiakas".
    const asiakas = screen.getByRole('combobox', { name: 'Asiakas' });
    await user.click(asiakas);
    await user.type(asiakas, 'uusi');
    await user.keyboard('{Enter}');
    const dialogi = await screen.findByRole('dialog', { name: 'Uusi asiakas' });
    await user.type(within(dialogi).getByLabelText('Nimi'), 'Asiakas Oy');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    // Dialogi sulkeutuu ja valitsin näyttää uuden asiakkaan (kumppanit-invalidointi).
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Asiakas' })).toHaveValue('Asiakas Oy'),
    );

    // Täytä rivi: selite + à-hinta 10 € (EuroInput committoi blurissa).
    await user.type(screen.getByLabelText('Selite, rivi 1'), 'Konsultointi');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '10');
    await user.tab();

    // Live-summat engine-helpereillä: ALV-oletus MYYNNIT_NETTO 25,5 % → 12,55 €.
    const summat = screen.getByLabelText('summat');
    expect(summat).toHaveTextContent('Yhteensä veroton');
    expect(summat).toHaveTextContent('10,00 €');
    expect(summat).toHaveTextContent('Alv 25,5 %');
    expect(summat).toHaveTextContent('Verollinen yhteensä');
    expect(summat).toHaveTextContent('12,55 €');

    // Tallenna → moottori numeroi ja kirjaa → navigointi dokumenttiin.
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByLabelText('laskudokumentti')).toBeInTheDocument();

    // Saman clientin kautta: lista näyttää oikean summan ja avoimen; kumppani persistoitui.
    const lista = await client.listaaMyyntilaskut({});
    expect(lista).toHaveLength(1);
    expect(lista[0]?.summa).toBe(Euro.fromCents(1_255));
    expect(lista[0]?.avoin).toBe(Euro.fromCents(1_255));
    expect(lista[0]?.asiakas).toBe('Asiakas Oy');
    expect((await client.haeKumppanit()).some((k) => k.nimi === 'Asiakas Oy')).toBe(true);
  });

  it('vaatii asiakkaan vain LASKU-maksutavalla', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');

    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '10');
    await user.tab();
    // LASKU ilman asiakasta → estetty.
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
    // Käteismyynti ilman asiakasta on laillinen (kuitti, ei saatavaa).
    await user.click(screen.getByRole('radio', { name: 'Käteinen' }));
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeEnabled();
  });

  it('näyttää §8-virheviestin kun laskutustili puuttuu (EILASKUTILIA)', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');

    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '10');
    await user.tab();
    // Käteinen ilman LaskuKateistili-asetusta → moottori heittää EILASKUTILIA.
    await user.click(screen.getByRole('radio', { name: 'Käteinen' }));
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Laskutuksen tili puuttuu asetuksista')).toBeInTheDocument();
  });

  it('tyhjennetty eräpäivä estää tallennuksen LASKU-maksutavalla', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');

    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '10');
    await user.tab();
    const asiakas = screen.getByRole('combobox', { name: 'Asiakas' });
    await user.click(asiakas);
    await user.type(asiakas, 'uusi');
    await user.keyboard('{Enter}');
    const dialogi = await screen.findByRole('dialog', { name: 'Uusi asiakas' });
    await user.type(within(dialogi).getByLabelText('Nimi'), 'Asiakas Oy');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Asiakas' })).toHaveValue('Asiakas Oy'),
    );
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeEnabled();

    // Käyttäjä tyhjentää eräpäivän: Tallenna estyy, ettei tosite tallennu tyhjällä
    // eräpäivällä (regressio: rakennaLaskuSyote.ts jätti sen aiemmin tarkistamatta).
    await user.clear(screen.getByLabelText('Eräpäivä'));
    expect(screen.getByRole('button', { name: 'Tallenna' })).toBeDisabled();
  });

  it('rivin lisäys ja poisto pitävät aina vähintään yhden rivin', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');

    await user.click(screen.getByRole('button', { name: 'Lisää rivi' }));
    expect(screen.getByLabelText('Selite, rivi 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Poista rivi 2' }));
    expect(screen.queryByLabelText('Selite, rivi 2')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Poista rivi 1' }));
    // Lattia 1: viimeisen rivin poisto jättää tyhjän rivin.
    expect(screen.getByLabelText('Selite, rivi 1')).toBeInTheDocument();
  });

  it('Kpl-kentän nollaus palautuu blurissa committoituun määrään eikä jää näyttämään "0":aa', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');

    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '10');
    await user.tab();
    const summat = screen.getByLabelText('summat');
    expect(summat).toHaveTextContent('10,00 €'); // 1 kpl × 10 €

    // Käyttäjä tyhjentää Kpl-kentän ja kirjoittaa "0": virheellinen määrä ei committoidu
    // (regressio: aiemmin defaultValue+onChange jätti "0":n näkyviin vaikka tila pysyi 1:ssä).
    const kpl = screen.getByLabelText('Kpl, rivi 1');
    await user.clear(kpl);
    await user.type(kpl, '0');
    expect(kpl).toHaveAttribute('aria-invalid', 'true');

    // Blur (Tallenna-klikkaus blurittaisi kentän samoin) reconciloi näytön committoituun
    // määrään — näytetty ja tallennettava kpl eivät voi koskaan hajota (regressio: vanha
    // uncontrolled-kenttä jätti "0":n näkyviin blurin jälkeenkin, vaikka tila pysyi 1:ssä).
    await user.tab();
    expect(kpl).toHaveValue('1');
    expect(kpl).not.toHaveAttribute('aria-invalid');
    expect(summat).toHaveTextContent('10,00 €'); // ennallaan, tallennettava summa vastaa näyttöä
  });

  it('Kpl-kenttään kirjoitettu desimaalipilkku (1,5) committoituu ja päivittää summat', async () => {
    const { user } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');

    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '10');
    await user.tab();

    // Suomalainen desimaalipilkku sallittu (spec: 1,5 kpl × 10 € = 15 €) — type="number"
    // nielaisisi pilkun, joten kenttä on nyt type="text" + inputMode="decimal".
    const kpl = screen.getByLabelText('Kpl, rivi 1');
    await user.clear(kpl);
    await user.type(kpl, '1,5');
    expect(kpl).not.toHaveAttribute('aria-invalid');

    const summat = screen.getByLabelText('summat');
    expect(summat).toHaveTextContent('15,00 €');
  });
});

describe('Uusi myyntilasku — tallentamattomat muutokset', () => {
  it('tallennus navigoi laskuun ilman varoitusta', async () => {
    // Korttimyynti ei vaadi asiakasta; korttitili asetetaan, ettei moottori estä tallennusta.
    const seed = { ...SEED, asetukset: { ...SEED.asetukset, LaskuKorttitili: '1900' } };
    const { user } = await renderRoute('/myyntilaskut/uusi', { seed });
    await screen.findByLabelText('laskulomake');
    await user.type(screen.getByLabelText('À-hinta, rivi 1'), '10');
    await user.tab();
    await user.click(screen.getByRole('radio', { name: 'Korttimaksu' }));
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    expect(await screen.findByLabelText('laskudokumentti')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muokattu lasku varoittaa poistuttaessa', async () => {
    const { user, router } = await renderRoute('/myyntilaskut/uusi', { seed: SEED });
    await screen.findByLabelText('laskulomake');
    await user.type(screen.getByLabelText('Otsikko'), 'Konsultointi');
    await user.click(screen.getByRole('link', { name: 'Kojelauta' }));

    expect(
      await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jää sivulle' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/myyntilaskut/uusi');
    expect(screen.getByLabelText('Otsikko')).toHaveValue('Konsultointi');
  });
});
