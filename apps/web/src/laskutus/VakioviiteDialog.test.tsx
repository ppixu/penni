import { renderWithProviders } from '@/test/renderWithProviders';
import type { KpClient } from '@penni/asiakas';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VakioviiteDialog } from './VakioviiteDialog.js';

/** Tulotilit 3000 ja 3100 (CL), kulutili 4000 (DL) ja saamistili 1701; oletusmyyntitili 3100. */
async function pohja(c: KpClient, asetukset: Record<string, string> = {}) {
  await c.tallennaTili(1701, { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } });
  await c.tallennaTili(3000, { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } });
  await c.tallennaTili(3100, { numero: 3100, tyyppi: 'CL', nimi: { fi: 'Jäsenmaksut' } });
  await c.tallennaTili(4000, { numero: 4000, tyyppi: 'DL', nimi: { fi: 'Ostot' } });
  await c.paivitaAsetukset({ OletusMyyntitili: '3100', ...asetukset });
}

function renderoi(
  props: { vakioviite?: Parameters<typeof VakioviiteDialog>[0]['vakioviite'] } = {},
  asetukset: Record<string, string> = {},
  lisaa?: (c: KpClient) => Promise<void>,
) {
  const onValmis = vi.fn();
  const onPeruuta = vi.fn();
  const tulos = renderWithProviders(
    <VakioviiteDialog {...props} onValmis={onValmis} onPeruuta={onPeruuta} />,
    {
      seed: async (c) => {
        await pohja(c, asetukset);
        await lisaa?.(c);
      },
    },
  );
  return { tulos, onValmis, onPeruuta };
}

describe('VakioviiteDialog, uusi', () => {
  it('oletuksena automaattinen numerointi: ei lähetä viitettä ja kirjaa 1009', async () => {
    const { tulos, onValmis } = renderoi();
    const { user, client } = await tulos;
    await user.type(await screen.findByLabelText('Otsikko'), 'Jäsenmaksu');
    const tallenna = vi.spyOn(client, 'tallennaVakioviite');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(onValmis).toHaveBeenCalled());
    expect(tallenna).toHaveBeenCalledTimes(1);
    expect(tallenna.mock.calls[0]?.[0]).not.toHaveProperty('viite');
    expect(await client.haeVakioviitteet()).toMatchObject([
      { viite: '1009', tili: 3100, otsikko: 'Jäsenmaksu' },
    ]);
  });

  it('tili-valinta listaa vain tulotilit ja oletus on OletusMyyntitili', async () => {
    const { tulos } = renderoi();
    await tulos;
    const valinta = (await screen.findByLabelText('Tili')) as HTMLSelectElement;
    const vaihtoehdot = Array.from(valinta.options).map((o) => o.textContent);
    expect(vaihtoehdot).toEqual(expect.arrayContaining(['3000 Myynti', '3100 Jäsenmaksut']));
    expect(vaihtoehdot).not.toContain('4000 Ostot');
    expect(vaihtoehdot).not.toContain('1701 Myyntisaamiset');
    expect(valinta.value).toBe('3100');
  });

  it('käyttäjän valitsema tili tallentuu', async () => {
    const { tulos, onValmis } = renderoi();
    const { user, client } = await tulos;
    await user.type(await screen.findByLabelText('Otsikko'), 'Lahjoitus');
    await user.selectOptions(screen.getByLabelText('Tili'), '3000');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(onValmis).toHaveBeenCalled());
    expect((await client.haeVakioviitteet())[0]).toMatchObject({ tili: 3000 });
  });

  it('kohdennus-kenttää ei näytetä, kun kohdennuksia ei ole', async () => {
    const { tulos } = renderoi();
    await tulos;
    await screen.findByLabelText('Otsikko');
    expect(screen.queryByLabelText('Kohdennus')).not.toBeInTheDocument();
  });

  it('vaatii otsikon eikä tallenna ilman sitä', async () => {
    const { tulos, onValmis } = renderoi();
    const { user, client } = await tulos;
    await screen.findByLabelText('Otsikko');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Anna otsikko.')).toBeInTheDocument();
    expect(await client.haeVakioviitteet()).toHaveLength(0);
    expect(onValmis).not.toHaveBeenCalled();
  });

  it('kasinnumerointi: asetus NumeroiVakioviiteItse=true avaa viitekentän', async () => {
    const { tulos } = renderoi({}, { NumeroiVakioviiteItse: 'true' });
    await tulos;
    expect(await screen.findByLabelText('Viite')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Numeroin itse' })).toBeChecked();
  });

  it('tilan vaihto tallentaa asetuksen NumeroiVakioviiteItse', async () => {
    const { tulos } = renderoi();
    const { user, client } = await tulos;
    await user.click(await screen.findByRole('radio', { name: 'Numeroin itse' }));
    await waitFor(async () =>
      expect((await client.haeInit()).asetukset.NumeroiVakioviiteItse).toBe('true'),
    );
    expect(await screen.findByLabelText('Viite')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Automaattinen numero' }));
    await waitFor(async () =>
      expect((await client.haeInit()).asetukset.NumeroiVakioviiteItse).toBe('false'),
    );
    expect(screen.queryByLabelText('Viite')).not.toBeInTheDocument();
  });

  it('kasinnumerointi: lähettää annetun viitteen', async () => {
    const { tulos, onValmis } = renderoi({}, { NumeroiVakioviiteItse: 'true' });
    const { user, client } = await tulos;
    await user.type(await screen.findByLabelText('Viite'), '2008');
    await user.type(screen.getByLabelText('Otsikko'), 'Vuokra');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(onValmis).toHaveBeenCalled());
    expect((await client.haeVakioviitteet())[0]).toMatchObject({
      viite: '2008',
      otsikko: 'Vuokra',
    });
  });

  it('kasinnumerointi: tarkistaa muodon ja tarkistenumeron ennen lähetystä', async () => {
    const { tulos, onValmis } = renderoi({}, { NumeroiVakioviiteItse: 'true' });
    const { user, client } = await tulos;
    const tallenna = vi.spyOn(client, 'tallennaVakioviite');
    await user.type(await screen.findByLabelText('Otsikko'), 'Vuokra');
    const viite = screen.getByLabelText('Viite');

    await user.type(viite, '1234'); // oikea muoto, väärä tarkistenumero
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/tarkistenumero/);

    await user.clear(viite);
    await user.type(viite, '0009'); // alkunolla
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/4-7 numeroa/);

    await user.clear(viite);
    await user.type(viite, '12'); // liian lyhyt
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/4-7 numeroa/);

    expect(tallenna).not.toHaveBeenCalled();
    expect(onValmis).not.toHaveBeenCalled();
  });

  it('kasinnumerointi: näyttää palvelimen VIITEKAYTOSSA-virheen', async () => {
    const { tulos, onValmis } = renderoi({}, { NumeroiVakioviiteItse: 'true' }, async (c) => {
      await c.tallennaVakioviite({ tili: 3000, otsikko: 'Vanha' }); // 1009
    });
    const { user } = await tulos;
    await user.type(await screen.findByLabelText('Viite'), '1009');
    await user.type(screen.getByLabelText('Otsikko'), 'Uusi');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Viite on jo käytössä');
    expect(onValmis).not.toHaveBeenCalled();
  });

  it('Peruuta kutsuu onPeruuta-callbackia', async () => {
    const { tulos, onPeruuta } = renderoi();
    const { user } = await tulos;
    await user.click(await screen.findByRole('button', { name: 'Peruuta' }));
    expect(onPeruuta).toHaveBeenCalled();
  });
});

describe('VakioviiteDialog, muokkaus', () => {
  const muokattava = { viite: '1009', tili: 3000, otsikko: 'Jäsenmaksu', lisatieto: 'x' };

  async function muokkaus(
    asetukset: Record<string, string> = {},
    props: Partial<Parameters<typeof VakioviiteDialog>[0]> = {},
  ) {
    return renderoi({ vakioviite: muokattava, ...props }, asetukset, async (c) => {
      await c.tallennaVakioviite({ tili: 3000, otsikko: 'Jäsenmaksu', lisatieto: 'x' } as never);
      await c.tallennaVakioviite({ tili: 3100, otsikko: 'Toinen' });
    });
  }

  it('esitäyttää kentät eikä tarjoa numerointitilan vaihtoa', async () => {
    const { tulos } = await muokkaus();
    await tulos;
    expect(await screen.findByLabelText('Viite')).toHaveValue('1009');
    expect(screen.getByLabelText('Otsikko')).toHaveValue('Jäsenmaksu');
    expect(screen.getByLabelText('Tili')).toHaveValue('3000');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('lähettää aina nykyisen viitteen (ja vanhaViite), vaikka numero ei muutu, eikä uudelleennumeroi', async () => {
    const { tulos, onValmis } = await muokkaus();
    const { user, client } = await tulos;
    const tallenna = vi.spyOn(client, 'tallennaVakioviite');
    const otsikko = await screen.findByLabelText('Otsikko');
    await user.clear(otsikko);
    await user.type(otsikko, 'Jäsenmaksu 2027');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(onValmis).toHaveBeenCalled());
    expect(tallenna.mock.calls[0]?.[0]).toMatchObject({
      viite: '1009',
      vanhaViite: '1009',
      otsikko: 'Jäsenmaksu 2027',
    });
    const kaikki = await client.haeVakioviitteet();
    expect(kaikki.map((v) => v.viite)).toEqual(['1009', '1012']);
    // Tuntemattomat avaimet säilyvät.
    expect(kaikki[0]).toMatchObject({ otsikko: 'Jäsenmaksu 2027', lisatieto: 'x' });
  });

  it('viitteen vaihto nimeää vakioviitteen uudelleen', async () => {
    const { tulos, onValmis } = await muokkaus();
    const { user, client } = await tulos;
    const viite = await screen.findByLabelText('Viite');
    await user.clear(viite);
    await user.type(viite, '2008');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(() => expect(onValmis).toHaveBeenCalled());
    expect((await client.haeVakioviitteet()).map((v) => v.viite)).toEqual(['1012', '2008']);
  });

  it('muokkaus ei kosketa NumeroiVakioviiteItse-asetukseen', async () => {
    const { tulos } = await muokkaus({ NumeroiVakioviiteItse: 'true' });
    const { client } = await tulos;
    const paivita = vi.spyOn(client, 'paivitaAsetukset');
    await screen.findByLabelText('Viite');
    expect(paivita).not.toHaveBeenCalled();
  });
});
