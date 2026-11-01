import { renderWithProviders } from '@/test/renderWithProviders';
import { type RahavirtaRivi, ResourceError, lisaaPaivia, oikaiseErapaiva } from '@penni/engine';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuistutusDialog } from './MuistutusDialog';

const rivi = (tosite: number, kumppani?: number): RahavirtaRivi =>
  ({
    tosite,
    pvm: '2026-04-01',
    tunniste: tosite,
    sarja: '',
    tyyppi: 210,
    tila: 100,
    netto: 100_000,
    alv: 0,
    summa: 100_000,
    avoin: 100_000,
    liitteita: 0,
    erapvm: '2026-04-30',
    numero: String(tosite),
    ...(kumppani !== undefined ? { kumppani } : {}),
  }) as RahavirtaRivi;

const tanaan = () => new Date().toISOString().slice(0, 10);

afterEach(() => vi.restoreAllMocks());

describe('MuistutusDialog', () => {
  it('oletukset: maksu päällä 5,00, korko päällä tyhjällä prosentilla, eräpäivä maksuajan mukaan', async () => {
    await renderWithProviders(
      <MuistutusDialog laskut={[rivi(1)]} onPeruuta={() => {}} onValmis={() => {}} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Muistutusmaksu' })).toBeChecked();
    expect(screen.getByLabelText('Muistutusmaksun summa')).toHaveValue('5,00');
    expect(screen.getByRole('checkbox', { name: 'Viivästyskorko' })).toBeChecked();
    const korko = screen.getByLabelText('Korkoprosentti');
    expect(korko).toHaveValue('');
    // Peruskorko 0 + 7 (kuluttaja): paikanpitäjä näyttää oletuksen desimaalipilkulla.
    await waitFor(() => expect(korko).toHaveAttribute('placeholder', '7,00'));
    // LaskuMaksuaika puuttuu asetuksista → 14 pv, oikaistuna pankkipäivään.
    expect(screen.getByLabelText('Eräpäivä')).toHaveValue(
      oikaiseErapaiva(lisaaPaivia(tanaan(), 14)),
    );
  });

  it('paikanpitäjä ja eräpäivä seuraavat asetuksia ja asiakkaan alv-tunnusta', async () => {
    const { client } = await renderWithProviders(
      <MuistutusDialog laskut={[rivi(1, 1)]} onPeruuta={() => {}} onValmis={() => {}} />,
      {
        seed: async (c) => {
          await c.paivitaAsetukset({ LaskuPeruskorko: '3.5', LaskuMaksuaika: '30' });
          await c.tallennaKumppani({ nimi: 'Yritys Oy', alvtunnus: 'FI12345678' });
        },
      },
    );
    expect((await client.haeKumppanit())[0]?.id).toBe(1);
    // Yritysasiakas: 3,5 + 8
    await waitFor(() =>
      expect(screen.getByLabelText('Korkoprosentti')).toHaveAttribute('placeholder', '11,50'),
    );
    expect(screen.getByLabelText('Eräpäivä')).toHaveValue(
      oikaiseErapaiva(lisaaPaivia(tanaan(), 30)),
    );
  });

  it('lähettää oletukset: maksu 5,00 €, korko päällä, ei viivkorkoa', async () => {
    const onValmis = vi.fn();
    const { user, client } = await renderWithProviders(
      <MuistutusDialog laskut={[rivi(1), rivi(2)]} onPeruuta={() => {}} onValmis={onValmis} />,
    );
    const luo = vi.spyOn(client, 'luoMaksumuistutukset').mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Luo muistutukset' }));
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    const syote = luo.mock.calls[0]?.[0];
    expect(syote).toMatchObject({
      tositteet: [1, 2],
      pvm: tanaan(),
      maksu: 500,
      korko: true,
    });
    expect(syote).not.toHaveProperty('viivkorko');
    await waitFor(() => expect(onValmis).toHaveBeenCalledWith([]));
  });

  it('maksu pois päältä lähettää maksu 0; annettu korko ja eräpäivä kulkevat mukana', async () => {
    const { user, client } = await renderWithProviders(
      <MuistutusDialog laskut={[rivi(1)]} onPeruuta={() => {}} onValmis={() => {}} />,
    );
    const luo = vi.spyOn(client, 'luoMaksumuistutukset').mockResolvedValue([]);
    await user.click(screen.getByRole('checkbox', { name: 'Muistutusmaksu' }));
    await user.type(screen.getByLabelText('Korkoprosentti'), '9,5');
    await user.clear(screen.getByLabelText('Eräpäivä'));
    await user.type(screen.getByLabelText('Eräpäivä'), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Luo muistutukset' }));
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    expect(luo.mock.calls[0]?.[0]).toMatchObject({
      maksu: 0,
      korko: true,
      viivkorko: 9.5,
      erapvm: '2026-12-01',
    });
  });

  it('korko pois päältä: korko false eikä prosenttia', async () => {
    const { user, client } = await renderWithProviders(
      <MuistutusDialog laskut={[rivi(1)]} onPeruuta={() => {}} onValmis={() => {}} />,
    );
    const luo = vi.spyOn(client, 'luoMaksumuistutukset').mockResolvedValue([]);
    await user.click(screen.getByRole('checkbox', { name: 'Viivästyskorko' }));
    expect(screen.getByLabelText('Korkoprosentti')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Luo muistutukset' }));
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    expect(luo.mock.calls[0]?.[0]).toMatchObject({ korko: false });
    expect(luo.mock.calls[0]?.[0]).not.toHaveProperty('viivkorko');
  });

  it('virheellinen korkoprosentti estää lähetyksen', async () => {
    const { user, client } = await renderWithProviders(
      <MuistutusDialog laskut={[rivi(1)]} onPeruuta={() => {}} onValmis={() => {}} />,
    );
    const luo = vi.spyOn(client, 'luoMaksumuistutukset').mockResolvedValue([]);
    await user.type(screen.getByLabelText('Korkoprosentti'), '9,555');
    await user.click(screen.getByRole('button', { name: 'Luo muistutukset' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tarkista korkoprosentti');
    expect(luo).not.toHaveBeenCalled();
  });

  it('moottorin virhe (EIMUISTUTETTAVA) näytetään dialogissa eikä dialogi sulkeudu', async () => {
    const onValmis = vi.fn();
    const { user, client } = await renderWithProviders(
      <MuistutusDialog laskut={[rivi(1)]} onPeruuta={() => {}} onValmis={onValmis} />,
    );
    vi.spyOn(client, 'luoMaksumuistutukset').mockRejectedValue(
      new ResourceError('EIMUISTUTETTAVA', 'Tositteesta 1 ei voi tehdä muistutusta'),
    );
    await user.click(screen.getByRole('button', { name: 'Luo muistutukset' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Laskusta ei voi tehdä muistutusta');
    expect(onValmis).not.toHaveBeenCalled();
  });

  it('Peruuta sulkee ilman kutsua', async () => {
    const onPeruuta = vi.fn();
    const { user, client } = await renderWithProviders(
      <MuistutusDialog laskut={[rivi(1)]} onPeruuta={onPeruuta} onValmis={() => {}} />,
    );
    const luo = vi.spyOn(client, 'luoMaksumuistutukset');
    await user.click(screen.getByRole('button', { name: 'Peruuta' }));
    expect(onPeruuta).toHaveBeenCalled();
    expect(luo).not.toHaveBeenCalled();
  });
});
