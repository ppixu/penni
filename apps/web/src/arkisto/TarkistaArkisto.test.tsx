import { renderWithProviders } from '@/test/renderWithProviders';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TarkistaArkisto } from './TarkistaArkisto';
import { laskeSha, sha256Lista } from './tarkiste';
import { pakkaa } from './zip';

const enc = new TextEncoder();
const LOPPUU = '2025-12-31';

/** Pieni arkisto kuten rakennaArkisto sen kirjoittaa; `muuta` peukaloi sisältöä listan jälkeen. */
async function arkisto(muuta = false): Promise<{ tiedosto: File; juuri: string }> {
  const sisalto = [
    { polku: 'raportit/paivakirja.html', data: enc.encode('<p>sivu</p>') },
    {
      polku: 'manifest.json',
      data: enc.encode(
        JSON.stringify({
          tilikausi: { alkaa: '2025-01-01', loppuu: LOPPUU },
          luotu: '2026-01-15T10:00:00.000Z',
        }),
      ),
    },
  ];
  const lista = enc.encode(await sha256Lista(sisalto));
  const juuri = await laskeSha(lista);
  const tiedostot = [
    ...sisalto,
    { polku: 'arkisto.sha256', data: lista },
    { polku: 'index.html', data: enc.encode(`<code>${juuri}</code>`) },
  ];
  if (muuta) tiedostot[0] = { polku: 'raportit/paivakirja.html', data: enc.encode('<p>x</p>') };
  const zip = pakkaa(tiedostot.map((t) => ({ polku: `2025/${t.polku}`, data: t.data })));
  return { tiedosto: new File([new Uint8Array(zip)], 'Demo Oy-arkisto-2025.zip'), juuri };
}

describe('TarkistaArkisto', () => {
  it('kertoo eheästä arkistosta ja kirjaan tallennetusta tiivisteestä', async () => {
    const { tiedosto, juuri } = await arkisto();
    const { user } = await renderWithProviders(<TarkistaArkisto />, {
      seed: async (client) => {
        await client.paivitaAsetukset({
          [`Arkistoitu/${LOPPUU}`]: JSON.stringify({
            aika: '2026-01-15T10:00:00.000Z',
            tiiviste: juuri,
          }),
        });
      },
    });
    await user.upload(screen.getByLabelText('Valitse tarkistettava arkisto'), tiedosto);
    const tila = await screen.findByRole('status', { name: 'Arkiston tarkistus' });
    expect(
      within(tila).getByText(/Arkisto on eheä\. 2 tiedostoa tarkistettu\./),
    ).toBeInTheDocument();
    expect(within(tila).getByText(/Tilikausi 1\.1\.2025–31\.12\.2025/)).toBeInTheDocument();
    expect(within(tila).getByText(juuri)).toBeInTheDocument();
    expect(
      within(tila).getByText('Sama tiiviste on tallennettu kirjanpitoon arkistoinnin yhteydessä.'),
    ).toBeInTheDocument();
  });

  it('luettelee muuttuneet tiedostot', async () => {
    const { tiedosto } = await arkisto(true);
    const { user } = await renderWithProviders(<TarkistaArkisto />);
    await user.upload(screen.getByLabelText('Valitse tarkistettava arkisto'), tiedosto);
    const tila = await screen.findByRole('status', { name: 'Arkiston tarkistus' });
    expect(within(tila).getByText(/tarkistus ei mennyt läpi/)).toBeInTheDocument();
    expect(within(tila).getByText('muuttunut: raportit/paivakirja.html')).toBeInTheDocument();
  });

  it('hylkää tiedoston, joka ei ole zip', async () => {
    const { user } = await renderWithProviders(<TarkistaArkisto />);
    await user.upload(
      screen.getByLabelText('Valitse tarkistettava arkisto'),
      new File(['ei zip'], 'muistio.zip'),
    );
    expect(await screen.findByText('Tiedosto ei ole zip-paketti.')).toBeInTheDocument();
  });
});
