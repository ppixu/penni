import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { KohdennusTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3, tyyppi: 'H1', nimi: { fi: 'TULOSLASKELMA' } },
    { numero: 3, tyyppi: 'H2', nimi: { fi: 'Liikevaihto' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4, tyyppi: 'H2', nimi: { fi: 'Materiaalit' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    { numero: 4100, tyyppi: 'D', nimi: { fi: 'Piilotettu kulu' } },
  ],
  tilikaudet: [
    { alkaa: '2025-01-01', loppuu: '2025-12-31' },
    { alkaa: '2026-01-01', loppuu: '2026-12-31' },
  ],
  asetukset: { Nimi: 'Demo Oy', piilotilit: '4100' },
};

const c = (n: number) => n as Cents;
const POLKU = '/budjetti?tilikausi=2026-01-01';

const solu = (numero: number, nimi: string) =>
  screen.getByRole('textbox', { name: `Budjetti ${numero} ${nimi}` });

/** Sivun oma tilikausivalinta (sivupalkissa on toinen "Tilikausi"). */
const kausivalinta = () =>
  within(screen.getByRole('region', { name: 'budjetti' })).getByLabelText('Tilikausi');

/** Yhteenvedon luku tavallisin välilyönnein ("1 234,50 €"). */
function summa(nimi: string): string {
  const dt = screen.getByText(nimi);
  return (dt.nextElementSibling?.textContent ?? '').replace(/ /g, ' ');
}

async function kohdennukset(client: KpClient) {
  const kp = await client.tallennaKohdennus({
    tyyppi: KohdennusTyyppi.KUSTANNUSPAIKKA,
    nimi: { fi: 'Nuorisotoiminta' },
  });
  const leiri = await client.tallennaKohdennus({
    tyyppi: KohdennusTyyppi.PROJEKTI,
    kuuluu: kp.id,
    nimi: { fi: 'Leiri 2025' },
    alkaa: '2025-01-01',
    paattyy: '2025-08-31',
  });
  await client.tallennaKohdennus({ tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Avustus' } });
  return { kp: kp.id, leiri: leiri.id };
}

afterEach(() => vi.restoreAllMocks());

describe('/budjetti', () => {
  it('summat syötetään luonnollisessa suunnassa; Enter siirtää seuraavaan; yhteenveto ja tallennus', async () => {
    const { user, client } = await renderRoute(POLKU, { seed: SEED });
    const myynti = await screen.findByRole('textbox', { name: 'Budjetti 3000 Myynti' });
    // Tasetilit, piilotettu tili ja kohdennusvalinta (ei kohdennuksia) eivät näy.
    expect(screen.queryByText(/Pankki/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Piilotettu kulu/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Kohdennus')).not.toBeInTheDocument();
    expect(screen.getByText('Liikevaihto')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Edellinen budjetti' })).toBeInTheDocument();

    await user.click(myynti);
    await user.type(myynti, '1 234,50{Enter}');
    expect(solu(4000, 'Ostot')).toHaveFocus();
    await user.type(solu(4000, 'Ostot'), '200{Enter}');

    expect(summa('Tulot yhteensä')).toBe('1 234,50 €');
    expect(summa('Menot yhteensä')).toBe('200,00 €');
    expect(summa('Budjetoitu tulos')).toBe('1 034,50 €');

    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 3000, sentit: 123450 },
        { kohdennus: 0, tili: 4000, sentit: -20000 },
      ]),
    );
    // Tallennettu tila on uusi pohja: kauden vaihto ei enää kysy.
    await user.selectOptions(kausivalinta(), '2025-01-01');
    await waitFor(() => expect(kausivalinta()).toHaveValue('2025-01-01'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Tallenna kirjaa myös solun, josta ei ole vielä poistuttu', async () => {
    const { user, client } = await renderRoute(POLKU, { seed: SEED });
    await user.type(await screen.findByRole('textbox', { name: 'Budjetti 3000 Myynti' }), '10');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 3000, sentit: 1000 },
      ]),
    );
  });

  it('negatiivinen summa kulutilillä tallentuu tulosuuntaan (+) ja palaa samana', async () => {
    const { user, client } = await renderRoute(POLKU, { seed: SEED });
    const ostot = await screen.findByRole('textbox', { name: 'Budjetti 4000 Ostot' });
    await user.type(ostot, '-200');
    await user.tab();
    expect(ostot).toHaveValue('−200,00');
    expect(summa('Menot yhteensä')).toBe('−200,00 €');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 4000, sentit: 20000 },
      ]),
    );
  });

  it('tyhjennetty solu poistaa rivin; edellinen budjetti näkyy luonnollisessa suunnassa', async () => {
    const { user, client } = await renderRoute(POLKU, {
      seed: SEED,
      arrange: async (cl) => {
        await cl.tallennaBudjetti('2025-01-01', [{ kohdennus: 0, tili: 4000, sentit: c(-50000) }]);
        await cl.tallennaBudjetti('2026-01-01', [
          { kohdennus: 0, tili: 3000, sentit: c(100000) },
          { kohdennus: 0, tili: 4000, sentit: c(-30000) },
        ]);
      },
    });
    const myynti = await screen.findByRole('textbox', { name: 'Budjetti 3000 Myynti' });
    expect(myynti).toHaveValue('1000,00');
    const ostorivi = screen.getByRole('row', { name: /4000 Ostot/ });
    expect(within(ostorivi).getByText('500,00 €')).toBeInTheDocument();

    await user.clear(myynti);
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 4000, sentit: -30000 },
      ]),
    );
  });

  it('Tallenna lähettää kaikkien kohdennusten rivit; kohdennuksen vaihto säilyttää muokkaukset', async () => {
    let ids = { kp: 0, leiri: 0 };
    const { user, client } = await renderRoute(POLKU, {
      seed: SEED,
      arrange: async (cl) => {
        ids = await kohdennukset(cl);
      },
    });
    const valinta = await screen.findByLabelText('Kohdennus');
    // Yleinen + kustannuspaikka; 2025 päättynyt projekti ja merkkaus eivät ole valittavissa.
    expect(
      within(valinta)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Yleinen', 'Nuorisotoiminta']);

    await user.type(solu(3000, 'Myynti'), '100');
    await user.tab();
    await user.selectOptions(valinta, 'Nuorisotoiminta');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(solu(3000, 'Myynti')).toHaveValue('');
    await user.type(solu(4000, 'Ostot'), '40');
    await user.tab();
    expect(summa('Budjetoitu tulos')).toBe('−40,00 €');

    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual(
        expect.arrayContaining([
          { kohdennus: 0, tili: 3000, sentit: 10000 },
          { kohdennus: ids.kp, tili: 4000, sentit: -4000 },
        ]),
      ),
    );
    expect(await client.haeBudjetti('2026-01-01')).toHaveLength(2);
  });

  it('Kopioi edellinen ohittaa päättyneen projektin ja kysyy ennen syötetyn korvaamista', async () => {
    let ids = { kp: 0, leiri: 0 };
    const { user, client } = await renderRoute(POLKU, {
      seed: SEED,
      arrange: async (cl) => {
        ids = await kohdennukset(cl);
        await cl.tallennaBudjetti('2025-01-01', [
          { kohdennus: 0, tili: 3000, sentit: c(100000) },
          { kohdennus: ids.kp, tili: 4000, sentit: c(-20000) },
          { kohdennus: ids.leiri, tili: 4000, sentit: c(-5000) },
        ]);
        await cl.tallennaBudjetti('2026-01-01', [{ kohdennus: 0, tili: 4000, sentit: c(-1) }]);
      },
    });
    const kopioi = await screen.findByRole('button', { name: 'Kopioi edellinen' });
    const vahvistus = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(kopioi);
    expect(vahvistus).toHaveBeenCalledTimes(1);
    expect(solu(3000, 'Myynti')).toHaveValue('');

    vahvistus.mockReturnValueOnce(true);
    await user.click(kopioi);
    expect(solu(3000, 'Myynti')).toHaveValue('1000,00');
    expect(solu(4000, 'Ostot')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 3000, sentit: 100000 },
        { kohdennus: ids.kp, tili: 4000, sentit: -20000 },
      ]),
    );
  });

  it('ensimmäisellä tilikaudella Kopioi edellinen on pois käytöstä', async () => {
    await renderRoute('/budjetti?tilikausi=2025-01-01', { seed: SEED });
    expect(await screen.findByRole('button', { name: 'Kopioi edellinen' })).toBeDisabled();
  });

  it('tilikauden vaihto tallentamattomin muutoksin kysyy ensin', async () => {
    const { user, router } = await renderRoute(POLKU, { seed: SEED });
    await user.type(await screen.findByRole('textbox', { name: 'Budjetti 3000 Myynti' }), '5');
    await user.tab();
    await user.selectOptions(kausivalinta(), '2025-01-01');
    expect(
      await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jää sivulle' }));
    expect(router.state.location.search).toMatchObject({ tilikausi: '2026-01-01' });
    expect(solu(3000, 'Myynti')).toHaveValue('5,00');
    expect(kausivalinta()).toHaveValue('2026-01-01');
  });

  it('osoitteen kohdennus valitaan valmiiksi', async () => {
    let ids = { kp: 0, leiri: 0 };
    await renderRoute(`${POLKU}&kohdennus=1`, {
      seed: SEED,
      arrange: async (cl) => {
        ids = await kohdennukset(cl);
      },
    });
    expect(await screen.findByLabelText('Kohdennus')).toHaveValue(String(ids.kp));
  });

  it('rivit, joita ei voi budjetoida, luetellaan ja pudotetaan tallennettaessa', async () => {
    let ids = { kp: 0, leiri: 0 };
    let avustus = 0;
    const { user, client } = await renderRoute(POLKU, {
      seed: SEED,
      arrange: async (cl, storage) => {
        ids = await kohdennukset(cl);
        avustus = (await cl.haeKohdennukset()).find((k) => k.nimi.fi === 'Avustus')?.id ?? 0;
        // Ohi moottorin tarkistusten, kuten tuonti tai vanha kirja: merkkauksen ja tilikartasta
        // puuttuvan tilin rivit, joita sivu ei näytä.
        await storage.putBudjetti('2026-01-01', [
          { kohdennus: 0, tili: 3000, sentit: c(100000) },
          { kohdennus: 0, tili: 5000, sentit: c(-700) },
          { kohdennus: avustus, tili: 4000, sentit: c(-2500) },
        ]);
      },
    });
    const ilmoitus = await screen.findByRole('status');
    expect(ilmoitus).toHaveTextContent(
      'Budjetissa on rivejä, joita ei voi budjetoida. Ne poistetaan, kun tallennat:',
    );
    expect(
      within(ilmoitus).getByText('Tili 5000 (ei tilikartassa), Yleinen: 7,00 €'),
    ).toBeVisible();
    expect(within(ilmoitus).getByText('Tili 4000 Ostot, Avustus: 25,00 €')).toBeVisible();
    expect(solu(3000, 'Myynti')).toHaveValue('1000,00');

    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 3000, sentit: 100000 },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(ids.kp).toBeGreaterThan(0);
  });

  it('Kopioi edellinen ei kopioi rivejä, joita ei voi budjetoida, vaan luettelee ne', async () => {
    const { user, client } = await renderRoute(POLKU, {
      seed: SEED,
      arrange: async (_cl, storage) => {
        await storage.putBudjetti('2025-01-01', [
          { kohdennus: 0, tili: 3000, sentit: c(100000) },
          { kohdennus: 0, tili: 5000, sentit: c(-700) },
        ]);
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Kopioi edellinen' }));
    expect(solu(3000, 'Myynti')).toHaveValue('1000,00');
    expect(
      within(screen.getByRole('status')).getByText('Tili 5000 (ei tilikartassa), Yleinen: 7,00 €'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 3000, sentit: 100000 },
      ]),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Tallenna kieltäytyy, kun solussa on virheellinen summa', async () => {
    const { user, client } = await renderRoute(POLKU, { seed: SEED });
    await user.type(await screen.findByRole('textbox', { name: 'Budjetti 3000 Myynti' }), '100');
    await user.type(solu(4000, 'Ostot'), '12abc');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Korjaa virheellinen summa ennen tallennusta.',
    );
    expect(solu(4000, 'Ostot')).toHaveFocus();
    expect(await client.haeBudjetti('2026-01-01')).toEqual([]);

    await user.clear(solu(4000, 'Ostot'));
    await user.type(solu(4000, 'Ostot'), '12');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () =>
      expect(await client.haeBudjetti('2026-01-01')).toEqual([
        { kohdennus: 0, tili: 3000, sentit: 10000 },
        { kohdennus: 0, tili: 4000, sentit: -1200 },
      ]),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
