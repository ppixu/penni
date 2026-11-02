import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { KohdennusTyyppi } from '@penni/engine';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const { KUSTANNUSPAIKKA, PROJEKTI } = KohdennusTyyppi;

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 3100, tyyppi: 'CL', nimi: { fi: 'Avustukset' }, kohdennus: 99 },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy' },
};

async function siemen(client: KpClient) {
  const kp = await client.tallennaKohdennus({
    tyyppi: KUSTANNUSPAIKKA,
    nimi: { fi: 'Nuorisotoiminta' },
  });
  await client.tallennaKohdennus({ tyyppi: PROJEKTI, kuuluu: kp.id, nimi: { fi: 'Kesäleiri' } });
}

async function avaa(
  user: Awaited<ReturnType<typeof renderRoute>>['user'],
  nimi: string,
): Promise<HTMLElement> {
  await screen.findByLabelText('tilikartta');
  await user.dblClick(screen.getByText(nimi));
  return screen.findByRole('dialog');
}

describe('TiliEditori — Oletuskohdennus', () => {
  it('tulostilillä valinta näkyy ja tallentuu data.kohdennus-avaimeen', async () => {
    const { user, client } = await renderRoute('/tilikartta', { seed: SEED, arrange: siemen });
    const dialogi = await avaa(user, 'Myynti');
    const valinta = await within(dialogi).findByLabelText('Oletuskohdennus');
    expect(within(valinta).getByRole('option', { name: 'Ei oletusta' })).toBeInTheDocument();
    expect(
      within(valinta).getByRole('option', { name: 'Nuorisotoiminta/Kesäleiri' }),
    ).toBeInTheDocument();

    await user.selectOptions(valinta, 'Nuorisotoiminta');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));

    const kohdennukset = await client.haeKohdennukset();
    const kp = kohdennukset.find((k) => k.tyyppi === KUSTANNUSPAIKKA);
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.tilit.find((t) => t.numero === 3000)?.kohdennus).toBe(kp?.id);
    });
  });

  it('"Ei oletusta" poistaa avaimen', async () => {
    const { user, client } = await renderRoute('/tilikartta', {
      seed: {
        ...SEED,
        tilit: [{ numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' }, kohdennus: 1 }],
      },
      arrange: siemen,
    });
    const dialogi = await avaa(user, 'Myynti');
    const valinta = await within(dialogi).findByLabelText('Oletuskohdennus');
    expect(valinta).toHaveValue('1');
    await user.selectOptions(valinta, 'Ei oletusta');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));

    await waitFor(async () => {
      const init = await client.haeInit();
      const tili = init.tilit.find((t) => t.numero === 3000);
      expect(tili).toBeDefined();
      expect(tili).not.toHaveProperty('kohdennus');
    });
  });

  it('tasetilillä ei ole valintaa ja tallennus poistaa avaimen', async () => {
    const { user, client } = await renderRoute('/tilikartta', {
      seed: {
        ...SEED,
        tilit: [{ numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' }, kohdennus: 1 }],
      },
      arrange: siemen,
    });
    const dialogi = await avaa(user, 'Pankki');
    expect(within(dialogi).queryByLabelText('Oletuskohdennus')).not.toBeInTheDocument();
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));

    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.tilit.find((t) => t.numero === 1900)).not.toHaveProperty('kohdennus');
    });
  });

  it('ilman kustannuspaikkoja ja projekteja valintaa ei näytetä', async () => {
    const { user } = await renderRoute('/tilikartta', {
      seed: SEED,
      arrange: async (c) => {
        await c.tallennaKohdennus({ tyyppi: KohdennusTyyppi.MERKKAUS, nimi: { fi: 'Avustus' } });
      },
    });
    const dialogi = await avaa(user, 'Myynti');
    await within(dialogi).findByLabelText('Tyyppi');
    expect(within(dialogi).queryByLabelText('Oletuskohdennus')).not.toBeInTheDocument();
  });

  it('tallentamaton id näkyy valittuna "Tuntematon (n)" ja säilyy koskemattomana', async () => {
    const { user, client } = await renderRoute('/tilikartta', { seed: SEED, arrange: siemen });
    const dialogi = await avaa(user, 'Avustukset');
    const valinta = await within(dialogi).findByLabelText('Oletuskohdennus');
    expect(within(valinta).getByRole('option', { name: 'Tuntematon (99)' })).toBeInTheDocument();
    expect(valinta).toHaveValue('99');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));

    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.tilit.find((t) => t.numero === 3100)?.kohdennus).toBe(99);
    });
  });
  it('merkkauksen id oletuksena ei paljasta merkkauksen nimeä vaan näkyy "Tuntematon (n)"', async () => {
    let merkkausId = 0;
    const { user, client } = await renderRoute('/tilikartta', {
      seed: { ...SEED, tilit: [{ numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } }] },
      arrange: async (c) => {
        await siemen(c);
        const m = await c.tallennaKohdennus({
          tyyppi: KohdennusTyyppi.MERKKAUS,
          nimi: { fi: 'Avustus' },
        });
        merkkausId = m.id;
        await c.tallennaTili(3000, {
          numero: 3000,
          tyyppi: 'CL',
          nimi: { fi: 'Myynti' },
          kohdennus: m.id,
        });
      },
    });
    const dialogi = await avaa(user, 'Myynti');
    const valinta = await within(dialogi).findByLabelText('Oletuskohdennus');
    expect(
      within(valinta).getByRole('option', { name: `Tuntematon (${merkkausId})` }),
    ).toBeInTheDocument();
    expect(within(valinta).queryByRole('option', { name: 'Avustus' })).not.toBeInTheDocument();
    expect(valinta).toHaveValue(String(merkkausId));
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.tilit.find((t) => t.numero === 3000)?.kohdennus).toBe(merkkausId);
    });
  });
});
