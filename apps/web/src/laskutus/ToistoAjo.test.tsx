import { useAsetaKirjanpito } from '@/app/KpClientProvider';
import { avaimet } from '@/app/kysely';
import { renderReitittimessa } from '@/test/renderReitittimessa';
import { paikallinenTanaan } from '@/tositteet/pikavalinnat';
import { InProcessClient, type KpClient } from '@penni/asiakas';
import { type ErantyneetToistot, ResourceError } from '@penni/engine';
import { createMemoryStorage } from '@penni/storage-memory';
import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { type MockInstance, afterEach, describe, expect, it, vi } from 'vitest';
import { ToistoAjo } from './ToistoAjo';

/** Ulompi komponentti, jonka uudelleenrenderöinti ja kirjanvaihto voidaan laukaista napeista. */
function Kehys({ toinenKirja }: { toinenKirja: KpClient }) {
  const [n, setN] = useState(0);
  const [nakyvissa, setNakyvissa] = useState(true);
  const vaihda = useAsetaKirjanpito();
  return (
    <>
      <button type="button" onClick={() => setN(n + 1)}>
        Renderöi uudelleen {n}
      </button>
      <button type="button" onClick={() => vaihda(toinenKirja)}>
        Vaihda kirja
      </button>
      <button type="button" onClick={() => setNakyvissa(!nakyvissa)}>
        Vaihda näkyvyyttä
      </button>
      {nakyvissa && <ToistoAjo />}
    </>
  );
}

function uusiKirja() {
  const client = new InProcessClient(createMemoryStorage(), () => '2026-06-01T00:00:00.000Z');
  const luo = vi.spyOn(client, 'luoErantyneetToistot').mockResolvedValue({ luodut: [] });
  return { client, luo };
}

/**
 * Kirja, jonka toistoajon tulos vapautetaan käsin renderöinnin jälkeen `act`-kääreessä: ilmoituksen
 * tilapäivitys ei saa osua renderöinnin odotuksen aikaan (muuten React varoittaa act-puutteesta).
 */
function viivastettuKirja(tulos: ErantyneetToistot | Error) {
  const kasi: { vapauta: () => void } = { vapauta: () => {} };
  return {
    kasi,
    seed: (c: KpClient) => {
      vi.spyOn(c, 'luoErantyneetToistot').mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            kasi.vapauta = () => (tulos instanceof Error ? reject(tulos) : resolve(tulos));
          }),
      );
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('ToistoAjo (kirjan avauksen toistoajo)', () => {
  it('ajaa kerran paikallisella päivällä: ei uudelleen renderöinnissä eikä komponentin remountissa', async () => {
    const toinen = uusiKirja();
    let luo: MockInstance<KpClient['luoErantyneetToistot']> | undefined;
    const { user } = await renderReitittimessa(
      <StrictMode>
        <Kehys toinenKirja={toinen.client} />
      </StrictMode>,
      {
        seed: (c) => {
          luo = vi.spyOn(c, 'luoErantyneetToistot').mockResolvedValue({ luodut: [] });
        },
      },
    );
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    expect(luo).toHaveBeenCalledWith(paikallinenTanaan());
    await user.click(screen.getByRole('button', { name: /Renderöi uudelleen/ }));
    await user.click(screen.getByRole('button', { name: /Renderöi uudelleen/ }));
    // Remount (StrictModen simuloitu unmount/mount, reitin vaihto) ei ajaa uudestaan.
    await user.click(screen.getByRole('button', { name: 'Vaihda näkyvyyttä' }));
    await user.click(screen.getByRole('button', { name: 'Vaihda näkyvyyttä' }));
    expect(luo).toHaveBeenCalledTimes(1);
    // Ei ilmoitusta, kun mitään ei luotu.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('ajaa uudestaan, kun avataan toinen kirja', async () => {
    const toinen = uusiKirja();
    let luo: MockInstance<KpClient['luoErantyneetToistot']> | undefined;
    const { user } = await renderReitittimessa(<Kehys toinenKirja={toinen.client} />, {
      seed: (c) => {
        luo = vi.spyOn(c, 'luoErantyneetToistot').mockResolvedValue({ luodut: [] });
      },
    });
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Vaihda kirja' }));
    await waitFor(() => expect(toinen.luo).toHaveBeenCalledTimes(1));
    expect(luo).toHaveBeenCalledTimes(1);
  });

  it('ilmoittaa luoduista luonnoksista, linkittää Lähtevät ja mitätöi luonnokset ja toistot', async () => {
    const toinen = uusiKirja();
    const queryClient = new QueryClient();
    const mitatoi = vi.spyOn(queryClient, 'invalidateQueries');
    const { kasi, seed } = viivastettuKirja({ luodut: [4, 5] });
    await renderReitittimessa(<Kehys toinenKirja={toinen.client} />, { queryClient, seed });
    await act(async () => kasi.vapauta());
    const ilmoitus = await screen.findByRole('status');
    expect(ilmoitus).toHaveTextContent('2 toistuvaa laskua odottaa Lähtevissä');
    const linkki = screen.getByRole('link', { name: 'Avaa Lähtevät' });
    expect(linkki).toHaveAttribute('href', expect.stringContaining('valilehti=lahtevat'));
    expect(linkki).toHaveAttribute('href', expect.stringContaining('laji=tulot'));
    expect(mitatoi).toHaveBeenCalledWith({ queryKey: avaimet.laskuluonnokset });
    expect(mitatoi).toHaveBeenCalledWith({ queryKey: avaimet.toistot });
  });

  it('yksi luonnos kirjoitetaan yksikössä', async () => {
    const toinen = uusiKirja();
    const { kasi, seed } = viivastettuKirja({ luodut: [4] });
    await renderReitittimessa(<Kehys toinenKirja={toinen.client} />, { seed });
    await act(async () => kasi.vapauta());
    expect(await screen.findByRole('status')).toHaveTextContent(
      '1 toistuva lasku odottaa Lähtevissä',
    );
  });

  it('virhe näytetään ei-estävänä ilmoituksena eikä kaada sovellusta', async () => {
    const toinen = uusiKirja();
    const { kasi, seed } = viivastettuKirja(new ResourceError('EILASKUTILIA', 'x'));
    await renderReitittimessa(<Kehys toinenKirja={toinen.client} />, { seed });
    await act(async () => kasi.vapauta());
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Toistuvien laskujen luonti epäonnistui: Laskutuksen tili puuttuu asetuksista',
    );
    // Sovellus on käytössä ilmoituksen kanssa.
    expect(screen.getByRole('button', { name: 'Vaihda kirja' })).toBeEnabled();
  });

  it('epäonnistuneet toistot luetellaan ilmoituksessa luotujen rinnalla', async () => {
    const toinen = uusiKirja();
    const { kasi, seed } = viivastettuKirja({
      luodut: [4],
      epaonnistuneet: [
        { toisto: 2, nimi: 'Vuokra', virhe: 'EIRIVEJA' },
        { toisto: 3, virhe: 'EILASKUTILIA' },
      ],
    });
    await renderReitittimessa(<Kehys toinenKirja={toinen.client} />, { seed });
    await act(async () => kasi.vapauta());
    const ilmoitus = await screen.findByRole('status');
    expect(ilmoitus).toHaveTextContent('1 toistuva lasku odottaa Lähtevissä');
    expect(ilmoitus).toHaveTextContent(
      'Toistojen luonti epäonnistui: Vuokra (Laskulla ei ole rivejä), toisto 3 (Laskutuksen tili puuttuu asetuksista)',
    );
    expect(screen.getByRole('link', { name: 'Avaa toistuvat laskut' })).toHaveAttribute(
      'href',
      expect.stringContaining('/toistot'),
    );
  });

  it('pelkkä epäonnistuminen ilman luotuja näytetään myös', async () => {
    const toinen = uusiKirja();
    const { kasi, seed } = viivastettuKirja({
      luodut: [],
      epaonnistuneet: [{ toisto: 2, nimi: 'Vuokra', virhe: 'EIRIVEJA' }],
    });
    await renderReitittimessa(<Kehys toinenKirja={toinen.client} />, { seed });
    await act(async () => kasi.vapauta());
    const ilmoitus = await screen.findByRole('status');
    expect(ilmoitus).toHaveTextContent(
      'Toiston luonti epäonnistui: Vuokra (Laskulla ei ole rivejä)',
    );
    expect(ilmoitus).not.toHaveTextContent('odottaa Lähtevissä');
    expect(screen.queryByRole('link', { name: 'Avaa Lähtevät' })).not.toBeInTheDocument();
  });

  it('ilmoituksen voi sulkea', async () => {
    const toinen = uusiKirja();
    const { kasi, seed } = viivastettuKirja({ luodut: [4, 5] });
    const { user } = await renderReitittimessa(<Kehys toinenKirja={toinen.client} />, { seed });
    await act(async () => kasi.vapauta());
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Sulje ilmoitus' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
