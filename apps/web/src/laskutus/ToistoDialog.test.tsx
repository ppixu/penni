import { renderWithProviders } from '@/test/renderWithProviders';
import { ResourceError, type StoredTosite } from '@penni/engine';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToistoDialog } from './ToistoDialog';

/** Dialogi tarvitsee laskusta vain id:n ja laskupäivän; engine-kutsu on testeissä vakioitu. */
const TOSITE = { id: 5, pvm: '2026-01-31', laskupvm: '2026-01-31' } as StoredTosite;

async function renderDialog(
  props: { onPeruuta?: () => void; onValmis?: (t: unknown) => void } = {},
) {
  return renderWithProviders(
    <ToistoDialog
      tosite={TOSITE}
      onPeruuta={props.onPeruuta ?? (() => {})}
      onValmis={props.onValmis ?? (() => {})}
    />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('ToistoDialog', () => {
  it('oletukset: kerran kuussa, ensimmäinen pvm = laskupvm + 1 kk (kuun loppu säilyy), ei loppua', async () => {
    await renderDialog();
    expect(screen.getByLabelText('Toistoväli kuukausina')).toHaveValue(1);
    expect(screen.getByLabelText('Seuraava laskupäivä')).toHaveValue('2026-02-28');
    expect(screen.getByLabelText('Päättyy (valinnainen)')).toHaveValue('');
  });

  it('seuraava päivä seuraa väliä, kunnes sitä muutetaan käsin', async () => {
    const { user } = await renderDialog();
    const vali = screen.getByLabelText('Toistoväli kuukausina');
    await user.clear(vali);
    await user.type(vali, '3');
    expect(screen.getByLabelText('Seuraava laskupäivä')).toHaveValue('2026-04-30');
  });

  it('lähetys kutsuu luoToistoLaskusta oletuksilla ilman loppupäivää', async () => {
    const onValmis = vi.fn();
    const { user, client } = await renderDialog({ onValmis });
    const luo = vi.spyOn(client, 'luoToistoLaskusta').mockResolvedValue({ id: 7 } as never);
    await user.click(screen.getByRole('button', { name: 'Luo toisto' }));
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    const syote = luo.mock.calls[0]?.[0];
    expect(syote).toEqual({ tosite: 5, kuukausia: 1, seuraava: '2026-02-28' });
    expect(syote).not.toHaveProperty('loppuu');
    await waitFor(() => expect(onValmis).toHaveBeenCalledWith({ id: 7 }));
  });

  it('annettu väli, alkupäivä ja loppupäivä kulkevat mukana', async () => {
    const { user, client } = await renderDialog();
    const luo = vi.spyOn(client, 'luoToistoLaskusta').mockResolvedValue({ id: 7 } as never);
    const vali = screen.getByLabelText('Toistoväli kuukausina');
    await user.clear(vali);
    await user.type(vali, '12');
    await user.clear(screen.getByLabelText('Seuraava laskupäivä'));
    await user.type(screen.getByLabelText('Seuraava laskupäivä'), '2027-03-01');
    await user.type(screen.getByLabelText('Päättyy (valinnainen)'), '2030-03-01');
    await user.click(screen.getByRole('button', { name: 'Luo toisto' }));
    await waitFor(() => expect(luo).toHaveBeenCalledTimes(1));
    expect(luo.mock.calls[0]?.[0]).toMatchObject({
      kuukausia: 12,
      seuraava: '2027-03-01',
      loppuu: '2030-03-01',
    });
  });

  it('virheellinen väli tai loppu ennen alkua estää lähetyksen', async () => {
    const { user, client } = await renderDialog();
    const luo = vi.spyOn(client, 'luoToistoLaskusta').mockResolvedValue({ id: 7 } as never);
    const vali = screen.getByLabelText('Toistoväli kuukausina');
    await user.clear(vali);
    await user.type(vali, '0');
    await user.click(screen.getByRole('button', { name: 'Luo toisto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Toistovälin on oltava');
    await user.clear(vali);
    await user.type(vali, '1');
    await user.type(screen.getByLabelText('Päättyy (valinnainen)'), '2026-02-01');
    await user.click(screen.getByRole('button', { name: 'Luo toisto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Päättymispäivä');
    expect(luo).not.toHaveBeenCalled();
  });

  it('moottorin virhe näytetään eikä dialogi sulkeudu', async () => {
    const onValmis = vi.fn();
    const { user, client } = await renderDialog({ onValmis });
    vi.spyOn(client, 'luoToistoLaskusta').mockRejectedValue(new ResourceError('EIKELPAA', 'x'));
    await user.click(screen.getByRole('button', { name: 'Luo toisto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Toiston voi luoda vain kirjatusta myyntilaskusta',
    );
    expect(onValmis).not.toHaveBeenCalled();
  });

  it('Peruuta sulkee', async () => {
    const onPeruuta = vi.fn();
    const { user } = await renderDialog({ onPeruuta });
    await user.click(screen.getByRole('button', { name: 'Peruuta' }));
    expect(onPeruuta).toHaveBeenCalled();
  });
});
