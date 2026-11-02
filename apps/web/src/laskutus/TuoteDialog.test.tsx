import { renderRoute } from '@/test/renderRoute';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const TILIT = [
  { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
  { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  { numero: 3100, tyyppi: 'CL', nimi: { fi: 'Palvelumyynti' } },
];
const TILIKAUDET = [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }];

async function avaaUusi(asetukset: Record<string, string>) {
  const tulos = await renderRoute('/tuotteet', {
    seed: { tilit: TILIT, tilikaudet: TILIKAUDET, asetukset: { Nimi: 'Demo', ...asetukset } },
  });
  await tulos.user.click(await screen.findByRole('button', { name: '+ Uusi tuote' }));
  const dialogi = await screen.findByRole('dialog', { name: 'Uusi tuote' });
  return { ...tulos, dialogi };
}

describe('TuoteDialog', () => {
  it('alv-velvollisen kirjan oletus on verollinen myynti nykyisellä yleiskannalla', async () => {
    const { dialogi } = await avaaUusi({ AlvVelvollinen: 'true', OletusMyyntitili: '3000' });
    expect(within(dialogi).getByLabelText('Alv')).toHaveValue('11:25.5');
  });

  it('alv-velvoittoman kirjan oletus on veroton', async () => {
    const { dialogi } = await avaaUusi({ OletusMyyntitili: '3000' });
    expect(within(dialogi).getByLabelText('Alv')).toHaveValue('0:0');
  });

  it('tarjoaa laskurivien myyntikoodit ja tulotilit', async () => {
    const { dialogi } = await avaaUusi({ AlvVelvollinen: 'true', OletusMyyntitili: '3000' });
    const alv = within(dialogi).getByLabelText('Alv');
    expect(within(alv).getByRole('option', { name: 'Veroton' })).toBeInTheDocument();
    // Prosentin edessä on sitova välilyönti.
    expect(
      within(alv).getByRole('option', { name: /Verollinen myynti 13,5\s%/ }),
    ).toBeInTheDocument();
    const tili = within(dialogi).getByLabelText('Tili');
    expect(within(tili).getByRole('option', { name: '3100 Palvelumyynti' })).toBeInTheDocument();
    expect(within(tili).queryByRole('option', { name: /Myyntisaamiset/ })).not.toBeInTheDocument();
  });

  it('bruttohinta jaetaan valitulla kannalla ja tallentuu nettona', async () => {
    const { user, dialogi, client } = await avaaUusi({
      AlvVelvollinen: 'true',
      OletusMyyntitili: '3000',
    });
    await user.type(within(dialogi).getByLabelText('Nimike'), 'Kahvi');
    await user.selectOptions(within(dialogi).getByLabelText('Alv'), '11:13.5');
    await user.click(within(dialogi).getByLabelText('Hinta sisältää alv:n'));
    await user.type(within(dialogi).getByLabelText('Hinta'), '11,35');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    await screen.findByText('Kahvi');
    // 11,35 / 1,135 = 10
    expect((await client.haeTuotteet())[0]).toMatchObject({ aNetto: 10, alvProsentti: 13.5 });
  });

  it('virheellinen hinta estää tallennuksen', async () => {
    const { user, dialogi, client } = await avaaUusi({ OletusMyyntitili: '3000' });
    await user.type(within(dialogi).getByLabelText('Nimike'), 'Vika');
    await user.type(within(dialogi).getByLabelText('Hinta'), 'abc');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));
    expect(await within(dialogi).findByRole('alert')).toHaveTextContent('Hinta');
    expect(await client.haeTuotteet()).toHaveLength(0);
  });

  it('Peruuta sulkee dialogin tallentamatta', async () => {
    const { user, dialogi, client } = await avaaUusi({ OletusMyyntitili: '3000' });
    await user.type(within(dialogi).getByLabelText('Nimike'), 'Ei');
    await user.click(within(dialogi).getByRole('button', { name: 'Peruuta' }));
    expect(screen.queryByRole('dialog', { name: 'Uusi tuote' })).not.toBeInTheDocument();
    expect(await client.haeTuotteet()).toHaveLength(0);
  });
});
