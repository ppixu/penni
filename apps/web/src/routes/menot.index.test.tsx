import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
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

/**
 * Yksi suora meno (80,00 €, tyyppi MENO/100, ei eraa) ja yksi ostolasku
 * (tallennaOstolasku — tyyppi on myös MENO/100, mutta ostovelkarivin era on aina asetettu).
 * Tämä on ainoa testi joka todistaa era !== undefined -erottimen: suora ja lasku jakavat
 * tositetyypin, joten Laji-sarakkeen ja rivinavigoinnin täytyy erottua era-kentän perusteella.
 */
async function siemenna(c: KpClient) {
  await c.luoTosite({
    pvm: '2026-03-01',
    tyyppi: 100,
    sarja: '',
    otsikko: 'Toimistotarvikkeet',
    viennit: [
      {
        tili: 4000,
        debet: Euro.fromCents(8000),
        kredit: Euro.fromCents(0),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili: 1900,
        debet: Euro.fromCents(0),
        kredit: Euro.fromCents(8000),
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  });

  const toimittaja = await c.tallennaKumppani({ nimi: 'Tukku Oy' });
  await c.tallennaOstolasku({
    pvm: '2026-04-01',
    erapvm: '2026-04-15',
    viite: 'V-100',
    kumppani: toimittaja.id,
    rivit: [{ myyntiKpl: 1, aNetto: 50, alvKoodi: 21, alvProsentti: 25.5, tili: 4000 }],
  });
}

describe('Menot', () => {
  it('näyttää suoran menon Suora-luokituksella', async () => {
    await renderRoute('/menot', { seed: SEED, arrange: siemenna });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findByText('Toimistotarvikkeet')).closest('tr');
    expect(rivi).not.toBeNull();
    expect(within(rivi as HTMLElement).getByText('Suora')).toBeInTheDocument();
    // Netto ja summa ovat molemmat 80,00 € (ei alv:ia suoralla menolla).
    expect(within(rivi as HTMLElement).getAllByText('80,00 €')).toHaveLength(2);
  });

  it('ei näytä menoa /tulot-sivulla', async () => {
    await renderRoute('/tulot', { seed: SEED, arrange: siemenna });
    const sivu = await screen.findByLabelText('tositteselaus');

    expect(within(sivu).queryByText('Toimistotarvikkeet')).not.toBeInTheDocument();
  });

  it('erottaa ostolaskun suorasta menosta Laji-sarakkeessa ja avaa ostolaskunäkymän klikattaessa', async () => {
    const { user } = await renderRoute('/menot', { seed: SEED, arrange: siemenna });
    const sivu = await screen.findByLabelText('tositteselaus');

    const suoraRivi = (await within(sivu).findByText('Toimistotarvikkeet')).closest('tr');
    expect(suoraRivi).not.toBeNull();
    expect(within(suoraRivi as HTMLElement).getByText('Suora')).toBeInTheDocument();

    const laskuRivi = (await within(sivu).findByText('Tukku Oy')).closest('tr');
    expect(laskuRivi).not.toBeNull();
    expect(within(laskuRivi as HTMLElement).getByText('Lasku')).toBeInTheDocument();

    await user.click(laskuRivi as HTMLElement);

    expect(await screen.findByLabelText('ostolaskunäkymä')).toBeInTheDocument();
  });

  it('näyttää ostolaskun viitteen Selite-sarakkeessa ja eräpäivän Eräpvm-sarakkeessa', async () => {
    await renderRoute('/menot', { seed: SEED, arrange: siemenna });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findByText('V-100')).closest('tr');
    expect(rivi).not.toBeNull();
    expect(within(rivi as HTMLElement).getByText('15.4.2026')).toBeInTheDocument();
  });

  it('ostolaskun hyvitys badgeaa Suora ja avaa tositenäkymän (ei jää ostolaskunäkymän katkennutta linkkiä)', async () => {
    const { user } = await renderRoute('/menot', {
      seed: SEED,
      arrange: async (c) => {
        const toimittaja = await c.tallennaKumppani({ nimi: 'Tukku Oy' });
        const lasku = await c.tallennaOstolasku({
          pvm: '2026-05-01',
          kumppani: toimittaja.id,
          rivit: [{ myyntiKpl: 1, aNetto: 50, alvKoodi: 21, alvProsentti: 25.5, tili: 4000 }],
        });
        // tallennaHyvityslasku kääntää kaikki viennit, myös ostovelkarivin — era säilyy
        // (spread), mutta kredit muuttuu debetiksi. listaaOstolaskut ei enää löydä tälle
        // riviä (vaatii kredit > 0 -ostovelkarivin), joten era !== undefined yksin
        // väärinluokittelisi tämän laskuksi ja reitittäisi katkenneeseen dokumenttiin.
        await c.tallennaHyvityslasku({
          alkuperainenTosite: lasku.id,
          pvm: '2026-05-02',
          otsikko: 'Ostolaskun hyvitys',
        });
      },
    });
    const sivu = await screen.findByLabelText('tositteselaus');

    const rivi = (await within(sivu).findByText('Ostolaskun hyvitys')).closest('tr');
    expect(rivi).not.toBeNull();
    expect(within(rivi as HTMLElement).getByText('Suora')).toBeInTheDocument();

    await user.click(rivi as HTMLElement);

    expect(await screen.findByLabelText('tosite')).toBeInTheDocument();
  });

  it('laskurivi on saavutettavissa näppäimistöllä (Enter navigoi ostolaskunäkymään)', async () => {
    const { user } = await renderRoute('/menot', { seed: SEED, arrange: siemenna });
    const sivu = await screen.findByLabelText('tositteselaus');

    const laskuRivi = (await within(sivu).findByText('Tukku Oy')).closest('tr');
    expect(laskuRivi).not.toBeNull();
    (laskuRivi as HTMLElement).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByLabelText('ostolaskunäkymä')).toBeInTheDocument();
  });

  it('tyhjä tila näyttää toimintakehotuksen ja ohjaa ostolaskun luontiin', async () => {
    const { user } = await renderRoute('/menot', { seed: SEED });
    const sivu = await screen.findByLabelText('tositteselaus');

    expect(
      await within(sivu).findByText('Ei menoja. Luo ensimmäinen ostolasku.'),
    ).toBeInTheDocument();
    // Tyhjän tilan oma kontrolli ("Luo ostolasku") on eri kuin headerin ("+ Uusi ostolasku") —
    // täsmälleen yksi ainoa, ei sama nodi kahdesti.
    const linkki = within(sivu).getByRole('link', { name: 'Luo ostolasku' });
    await user.click(linkki);

    expect(await screen.findByLabelText('ostolaskulomake')).toBeInTheDocument();
  });

  it('headerin "+ Uusi tosite" avaa uuden tositteen ruudukkoeditoriin', async () => {
    const { user } = await renderRoute('/menot', { seed: SEED });
    await user.click(await screen.findByRole('link', { name: '+ Uusi tosite' }));
    expect(await screen.findByText('Uusi tosite')).toBeInTheDocument();
  });

  it('/menot avaa Tositteet-listan Menot-rajauksella eikä sivupalkissa ole omaa Menot-kohtaa', async () => {
    const { router } = await renderRoute('/menot', { seed: SEED });
    await screen.findByLabelText('tositteselaus');
    expect(router.state.location.pathname).toBe('/tositteet');
    expect(screen.getByRole('button', { name: 'Menot' })).toHaveAttribute('aria-pressed', 'true');
    const linkit = screen.getAllByRole('link').map((l) => l.textContent ?? '');
    expect(linkit.some((t) => t.includes('Menot'))).toBe(false);
    expect(linkit.some((t) => t.includes('Tositteet'))).toBe(true);
  });

  describe('lajittelu sarakeotsikoista', () => {
    /** Summa-sarakkeen (7.) arvot näkyvässä järjestyksessä. */
    function summat(sivu: HTMLElement): string[] {
      return within(sivu)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelectorAll('td')[6]?.textContent ?? '');
    }
    const sentit = (teksti: string) => Number(teksti.replace(/[^0-9,-]/g, '').replace(',', '.'));

    it('oletuksena uusin ensin; summan otsikko lajittelee nousevasti ja sitten laskevasti', async () => {
      const { user, router } = await renderRoute('/menot', { seed: SEED, arrange: siemenna });
      const sivu = await screen.findByLabelText('tositteselaus');
      await waitFor(() => expect(summat(sivu).length).toBeGreaterThan(1));
      const pvm = within(sivu).getByRole('button', { name: 'Lajittele päivämäärän mukaan' });
      expect(pvm.closest('th')).toHaveAttribute('aria-sort', 'descending');

      const summa = within(sivu).getByRole('button', { name: 'Lajittele summan mukaan' });
      await user.click(summa);
      const nousevat = summat(sivu).map(sentit);
      expect(nousevat.length).toBeGreaterThan(1);
      expect(nousevat).toEqual([...nousevat].sort((a, b) => a - b));
      expect(summa.closest('th')).toHaveAttribute('aria-sort', 'ascending');
      expect(router.state.location.search).toEqual({
        laji: 'menot',
        jarj: 'summa',
        suunta: 'nouseva',
      });

      await user.click(summa);
      expect(summat(sivu).map(sentit)).toEqual([...nousevat].reverse());
    });
  });
});
