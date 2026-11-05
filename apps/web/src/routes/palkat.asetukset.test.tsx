import { renderRoute } from '@/test/renderRoute';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const TILIT = [
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 2931, tyyppi: 'BL', nimi: { fi: 'Tyel-velka' } },
  { numero: 5000, tyyppi: 'D', nimi: { fi: 'Palkat' } },
];

const SEED = {
  tilit: TILIT,
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy' },
};

const MAKSUTILILLA = { ...SEED, asetukset: { Nimi: 'Demo Oy', LaskuMaksutili: '1900' } };

describe('/palkat/asetukset — palkkatilit', () => {
  it('tallentaa koko tilikartan: TL 2931, MP kirjan maksutilistä, Kitsas-koodit säilyvät', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', {
      seed: {
        ...MAKSUTILILLA,
        asetukset: {
          ...MAKSUTILILLA.asetukset,
          palkkatilit: JSON.stringify({ AY: 7000, PA: 5100 }),
        },
      },
    });
    const osio = await screen.findByLabelText('palkkatilit');
    await user.click(within(osio).getByRole('button', { name: 'Tallenna palkkatilit' }));
    await waitFor(async () => {
      const a = await client.haeAsetukset();
      expect(JSON.parse(a.palkkatilit ?? '{}').TL).toBe(2931);
    });
    const tallennettu = JSON.parse((await client.haeAsetukset()).palkkatilit ?? '{}');
    expect(tallennettu).toMatchObject({ TL: 2931, TT: 2965, MP: 1900, PA: 5100, AY: 7000 });
  });

  it('tuoreessa kirjassa MP puuttuu: kehote, eikä tallenna ennen valintaa', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', { seed: SEED });
    const osio = await screen.findByLabelText('palkkatilit');
    expect(within(osio).getByText('Valitse nettopalkkojen maksutili')).toBeInTheDocument();
    await user.click(within(osio).getByRole('button', { name: 'Tallenna palkkatilit' }));
    expect((await client.haeAsetukset()).palkkatilit).toBeUndefined();
    expect(await within(osio).findByRole('alert')).toHaveTextContent('nettopalkkojen maksutili');

    const mp = within(osio).getByRole('combobox', { name: 'MP Nettopalkkojen maksutili' });
    await user.click(mp);
    await user.click(await screen.findByText(/Pankkitili/));
    await user.click(within(osio).getByRole('button', { name: 'Tallenna palkkatilit' }));
    await waitFor(async () => expect((await client.haeAsetukset()).palkkatilit).toBeDefined());
    const tallennettu = JSON.parse((await client.haeAsetukset()).palkkatilit ?? '{}');
    expect(tallennettu).toMatchObject({ MP: 1900, TL: 2931 });
  });
});

describe('/palkat/asetukset — työnantajan tiedot', () => {
  it('tallentaa TyEL-yhtiön koodin, sopimusnumeron, vuoden TyEL-prosentin ja liput', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', { seed: MAKSUTILILLA });
    const osio = await screen.findByLabelText('työnantajan tiedot');
    await user.selectOptions(within(osio).getByLabelText('TyEL-vakuutusyhtiö'), '55');
    await user.type(within(osio).getByLabelText('TyEL-sopimusnumero'), '5512345');
    await user.selectOptions(await screen.findByLabelText('Vuosi'), '2026');
    // Oletus näkyy taulukosta (2026: 24,85 %), ei tallennettuna arvona
    expect(within(osio).getByLabelText('TyEL-kokonaismaksu (%)')).toHaveAttribute(
      'placeholder',
      '24,85',
    );
    await user.type(within(osio).getByLabelText('TyEL-kokonaismaksu (%)'), '25,1');
    await user.click(within(osio).getByLabelText(/alle 1 500/));
    await user.type(within(osio).getByLabelText('Yhteyshenkilön nimi'), 'Testi Teuvo');
    await user.type(within(osio).getByLabelText('Yhteyshenkilön puhelin'), '0401234567');
    await user.type(within(osio).getByLabelText('OmaVero-viite'), '1234567890');
    await user.click(within(osio).getByRole('button', { name: 'Tallenna työnantajan tiedot' }));

    await waitFor(async () => expect((await client.haeAsetukset()).PalkatAsetukset).toBeDefined());
    const a = JSON.parse((await client.haeAsetukset()).PalkatAsetukset ?? '{}');
    expect(a).toMatchObject({
      tyelYhtio: '55',
      tyelSopimus: '5512345',
      tyelKokonaisBp: { '2026': 2510 },
      tilapainenTyonantaja: false,
      tvrVapautus: true,
      yhteyshenkilo: { nimi: 'Testi Teuvo', puhelin: '0401234567' },
      omaVeroViite: '1234567890',
    });
  });

  it('tilapäisen työnantajan oletus-TyEL vaihtuu taulukon tilapäiseen arvoon', async () => {
    const { user } = await renderRoute('/palkat/asetukset', { seed: MAKSUTILILLA });
    const osio = await screen.findByLabelText('työnantajan tiedot');
    await user.selectOptions(await screen.findByLabelText('Vuosi'), '2026');
    await user.click(within(osio).getByLabelText('Tilapäinen työnantaja'));
    expect(within(osio).getByLabelText('TyEL-kokonaismaksu (%)')).toHaveAttribute(
      'placeholder',
      '25,85',
    );
  });

  it('vakuutusnumeron on alettava eläkelaitoksen tunnuksella', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', { seed: MAKSUTILILLA });
    const osio = await screen.findByLabelText('työnantajan tiedot');
    await user.selectOptions(within(osio).getByLabelText('TyEL-vakuutusyhtiö'), '55');
    await user.type(within(osio).getByLabelText('TyEL-sopimusnumero'), '1234567');
    await user.click(within(osio).getByRole('button', { name: 'Tallenna työnantajan tiedot' }));
    expect(await within(osio).findByRole('alert')).toHaveTextContent(
      'Vakuutusnumeron pitää alkaa eläkelaitoksen tunnuksella (55)',
    );
    expect((await client.haeAsetukset()).PalkatAsetukset).toBeUndefined();
  });

  it('vakuutusnumero ilman eläkelaitosta ei tallennu', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', { seed: MAKSUTILILLA });
    const osio = await screen.findByLabelText('työnantajan tiedot');
    await user.type(within(osio).getByLabelText('TyEL-sopimusnumero'), '5512345');
    await user.click(within(osio).getByRole('button', { name: 'Tallenna työnantajan tiedot' }));
    expect(await within(osio).findByRole('alert')).toHaveTextContent('Valitse TyEL-vakuutusyhtiö');
    expect((await client.haeAsetukset()).PalkatAsetukset).toBeUndefined();
  });

  it('tapaturmavakuutusyhtiön Y-tunnus tarkistetaan ja tallennetaan muotoiltuna', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', { seed: MAKSUTILILLA });
    const osio = await screen.findByLabelText('työnantajan tiedot');
    await user.type(within(osio).getByLabelText('Tapaturmavakuutusyhtiön Y-tunnus'), '1234567-2');
    await user.type(within(osio).getByLabelText('Tapaturmavakuutuksen numero'), 'AB123');
    await user.click(within(osio).getByRole('button', { name: 'Tallenna työnantajan tiedot' }));
    expect(await within(osio).findByRole('alert')).toHaveTextContent('Y-tunnus');
    expect((await client.haeAsetukset()).PalkatAsetukset).toBeUndefined();

    const tunnus = within(osio).getByLabelText('Tapaturmavakuutusyhtiön Y-tunnus');
    await user.clear(tunnus);
    await user.type(tunnus, '12345671'); // kelvollinen tarkiste, ilman väliviivaa
    await user.click(within(osio).getByRole('button', { name: 'Tallenna työnantajan tiedot' }));
    await waitFor(async () => expect((await client.haeAsetukset()).PalkatAsetukset).toBeDefined());
    expect(JSON.parse((await client.haeAsetukset()).PalkatAsetukset ?? '{}')).toMatchObject({
      tapaturmaYhtio: '1234567-1',
      tapaturmaSopimus: 'AB123',
    });
  });

  it('virheellinen TyEL-prosentti ei tallennu', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', { seed: MAKSUTILILLA });
    const osio = await screen.findByLabelText('työnantajan tiedot');
    await user.selectOptions(await screen.findByLabelText('Vuosi'), '2026');
    await user.type(within(osio).getByLabelText('TyEL-kokonaismaksu (%)'), '1,234');
    await user.click(within(osio).getByRole('button', { name: 'Tallenna työnantajan tiedot' }));
    expect(await within(osio).findByRole('alert')).toHaveTextContent('TyEL-kokonaismaksu');
    expect((await client.haeAsetukset()).PalkatAsetukset).toBeUndefined();
  });
});

describe('/palkat/asetukset — palkkataulukko', () => {
  it('oma arvo 2027 sava 1,84 % tallentuu PalkatTaulukot-asetukseen', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', { seed: MAKSUTILILLA });
    await user.selectOptions(await screen.findByLabelText('Vuosi'), '2027');
    const osio = await screen.findByLabelText('palkkataulukko'); // vuoden vaihto mounttaa osion uudelleen
    await user.type(within(osio).getByLabelText('Oma arvo: Sairausvakuutusmaksu (sava)'), '1,84');
    await user.click(within(osio).getByRole('button', { name: 'Tallenna taulukon omat arvot' }));
    await waitFor(async () => expect((await client.haeAsetukset()).PalkatTaulukot).toBeDefined());
    expect(JSON.parse((await client.haeAsetukset()).PalkatTaulukot ?? '{}')).toEqual({
      '2027': { savaBp: 184 },
    });
  });

  it('näyttää lähteen linkkinä ja puuttuvan arvon merkinnän', async () => {
    const { user } = await renderRoute('/palkat/asetukset', { seed: MAKSUTILILLA });
    await user.selectOptions(await screen.findByLabelText('Vuosi'), '2027');
    const osio = await screen.findByLabelText('palkkataulukko'); // vuoden vaihto mounttaa osion uudelleen
    expect(within(osio).getAllByText('Ei vielä vahvistettu').length).toBeGreaterThan(0);
    expect(within(osio).getAllByRole('link', { name: 'Lähde' })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\//),
    );
  });

  it('olemassa oleva oma arvo näkyy ja sen tyhjennys poistaa ohituksen', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', {
      seed: {
        ...MAKSUTILILLA,
        asetukset: {
          ...MAKSUTILILLA.asetukset,
          PalkatTaulukot: JSON.stringify({ '2027': { savaBp: 184 } }),
        },
      },
    });
    await user.selectOptions(await screen.findByLabelText('Vuosi'), '2027');
    const osio = await screen.findByLabelText('palkkataulukko'); // vuoden vaihto mounttaa osion uudelleen
    const kentta = within(osio).getByLabelText('Oma arvo: Sairausvakuutusmaksu (sava)');
    expect(kentta).toHaveValue('1,84');
    await user.clear(kentta);
    await user.click(within(osio).getByRole('button', { name: 'Tallenna taulukon omat arvot' }));
    await waitFor(async () =>
      expect(JSON.parse((await client.haeAsetukset()).PalkatTaulukot ?? 'null')).toEqual({}),
    );
  });
});

describe('/palkat/asetukset — viallinen tallennettu taulukko', () => {
  it('tuntematon kenttä PalkatTaulukot-asetuksessa näyttää virheen eikä kaada sivua', async () => {
    const { user, client } = await renderRoute('/palkat/asetukset', {
      seed: {
        ...MAKSUTILILLA,
        asetukset: {
          ...MAKSUTILILLA.asetukset,
          PalkatTaulukot: JSON.stringify({ '2027': { foo: 1 } }),
        },
      },
    });
    const osio = await screen.findByLabelText('palkkataulukko');
    expect(await within(osio).findByRole('alert')).toHaveTextContent('PalkatTaulukot');
    // Muut osiot renderöityvät edelleen, myös valitulle vuodelle
    await user.selectOptions(await screen.findByLabelText('Vuosi'), '2027');
    const tyonantaja = await screen.findByLabelText('työnantajan tiedot');
    expect(within(tyonantaja).getByLabelText('TyEL-kokonaismaksu (%)')).toBeInTheDocument();
    const taulukko = await screen.findByLabelText('palkkataulukko');
    expect(
      within(taulukko).getByRole('button', { name: 'Tallenna taulukon omat arvot' }),
    ).toBeDisabled();
    expect((await client.haeAsetukset()).PalkatTaulukot).toBe(
      JSON.stringify({ '2027': { foo: 1 } }),
    );
  });
});
