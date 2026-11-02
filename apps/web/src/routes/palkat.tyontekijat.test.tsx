import { renderRoute } from '@/test/renderRoute';
import { type Tyontekija, lueTyontekijat } from '@penni/palkat';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Synteettiset tunnukset: yksilönumero 900-999 (ei oikeita henkilöitä), kelvollinen tarkistemerkki.
const HETU = '010190-900P';
const HETU_2 = '150575-9313';

const SEED = {
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy' },
};

function tyontekija(osa: Partial<Tyontekija> = {}): Tyontekija {
  return {
    id: 'abc12345',
    nimi: 'Testinen Tuula',
    hetu: HETU,
    vakuutusperuste: 'tyontekija',
    ammattikoodi: '12345',
    palkkamuoto: 'kuukausi',
    puhelinetu: false,
    verokortit: [],
    aktiivinen: true,
    ...osa,
  };
}

const siemenellaTyontekijat = (lista: unknown[]) => ({
  ...SEED,
  asetukset: { ...SEED.asetukset, PalkatTyontekijat: JSON.stringify(lista) },
});

async function luettu(client: { haeAsetukset(): Promise<Record<string, string>> }) {
  return lueTyontekijat(await client.haeAsetukset());
}

describe('/palkat/tyontekijat', () => {
  it('lisää työntekijän: hetu normalisoidaan, 23,5 % tallentuu 2350 bp:nä, id ei johdu hetusta', async () => {
    const { user, client } = await renderRoute('/palkat/tyontekijat', { seed: SEED });
    expect(await screen.findByText('Ei työntekijöitä.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Lisää työntekijä' }));

    await user.type(await screen.findByLabelText('Nimi'), 'Testinen Tuula');
    await user.type(screen.getByLabelText('Henkilötunnus'), ` ${HETU.toLowerCase()} `);
    await user.type(screen.getByLabelText('Ammattikoodi (TK10)'), '12345');
    await user.type(screen.getByLabelText('Kuukausipalkka'), '3000');

    await user.click(screen.getByRole('button', { name: '+ Lisää verokortti' }));
    fireEvent.change(screen.getByLabelText('Verokortti 1: alkaa'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText('Verokortti 1: päättyy'), {
      target: { value: '2026-12-31' },
    });
    await user.type(screen.getByLabelText('Verokortti 1: perusprosentti'), '23,5');
    await user.type(screen.getByLabelText('Verokortti 1: lisäprosentti'), '40');
    await user.type(screen.getByLabelText('Verokortti 1: tuloraja'), '30000');
    await user.type(screen.getByLabelText('Verokortti 1: aiemmin maksettu'), '1200,50');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    await waitFor(async () => expect(await luettu(client)).toHaveLength(1));
    const [t] = await luettu(client);
    expect(t).toMatchObject({
      nimi: 'Testinen Tuula',
      hetu: HETU,
      ammattikoodi: '12345',
      vakuutusperuste: 'tyontekija',
      palkkamuoto: 'kuukausi',
      kuukausipalkka: 300000,
      aktiivinen: true,
      verokortit: [
        {
          alkaa: '2026-01-01',
          paattyy: '2026-12-31',
          perusBp: 2350,
          lisaBp: 4000,
          tuloraja: 3000000,
          aiemminMaksettu: 120050,
        },
      ],
    });
    expect(t?.id).toMatch(/^[0-9a-z]{8}$/);
    expect(t?.id).not.toContain('900');
    // Lomake sulkeutuu ja lista näyttää nimen
    expect(await screen.findByText('Testinen Tuula')).toBeInTheDocument();
  });

  it('virheellinen hetu näyttää virheen eikä tallenna', async () => {
    const { user, client } = await renderRoute('/palkat/tyontekijat', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Lisää työntekijä' }));
    await user.type(await screen.findByLabelText('Nimi'), 'Testinen Tuula');
    await user.type(screen.getByLabelText('Henkilötunnus'), '010190-900X');
    await user.type(screen.getByLabelText('Ammattikoodi (TK10)'), '12345');
    expect(screen.getByText('Tarkista henkilötunnus')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(screen.getByText('Tarkista henkilötunnus')).toBeInTheDocument();
    expect((await client.haeAsetukset()).PalkatTyontekijat).toBeUndefined();
  });

  it('virheellinen IBAN estää tallennuksen', async () => {
    const { user, client } = await renderRoute('/palkat/tyontekijat', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Lisää työntekijä' }));
    await user.type(await screen.findByLabelText('Nimi'), 'Testinen Tuula');
    await user.type(screen.getByLabelText('Henkilötunnus'), HETU);
    await user.type(screen.getByLabelText('Ammattikoodi (TK10)'), '12345');
    await user.type(screen.getByLabelText('IBAN'), 'FI00 1234');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(screen.getByText('Tarkista IBAN')).toBeInTheDocument();
    expect((await client.haeAsetukset()).PalkatTyontekijat).toBeUndefined();
  });

  it('ammattikoodi on pakollinen työntekijälle, mutta ei YEL-vakuutetulle', async () => {
    const { user, client } = await renderRoute('/palkat/tyontekijat', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Lisää työntekijä' }));
    await user.type(await screen.findByLabelText('Nimi'), 'Testinen Tuula');
    await user.type(screen.getByLabelText('Henkilötunnus'), HETU);
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(screen.getByText('Anna viisinumeroinen ammattikoodi')).toBeInTheDocument();
    expect((await client.haeAsetukset()).PalkatTyontekijat).toBeUndefined();
    // Linkki Tilastokeskuksen ammattiluokitukseen
    expect(screen.getByRole('link', { name: /Ammattiluokitus 2010/ })).toHaveAttribute(
      'href',
      'https://www.stat.fi/fi/luokitukset/ammatti/',
    );

    await user.selectOptions(screen.getByLabelText('Vakuutusperuste'), 'yel');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () => expect(await luettu(client)).toHaveLength(1));
    expect((await luettu(client))[0]).toMatchObject({ vakuutusperuste: 'yel' });
  });

  it('lista ei näytä koko hetua, vain nimen ja syntymäajan', async () => {
    await renderRoute('/palkat/tyontekijat', {
      seed: siemenellaTyontekijat([tyontekija()]),
    });
    expect(await screen.findByText('Testinen Tuula')).toBeInTheDocument();
    expect(screen.getByText('s. 1.1.1990')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('900P');
    expect(document.body.textContent).not.toContain('010190-9');
  });

  it('virheellinen tallennettu tietue näytetään nimellä eikä kaada sivua; muut näkyvät', async () => {
    const rikki = { ...tyontekija({ id: 'rikki001', nimi: 'Rikkinen Rauni' }), hetu: 'EI-HETU' };
    await renderRoute('/palkat/tyontekijat', {
      seed: siemenellaTyontekijat([tyontekija(), rikki]),
    });
    expect(await screen.findByText('Testinen Tuula')).toBeInTheDocument();
    const halytys = await screen.findByRole('alert');
    expect(halytys).toHaveTextContent('Tietue 2');
    expect(halytys).toHaveTextContent('Rikkinen Rauni');
    expect(halytys.textContent).not.toContain('EI-HETU');
  });

  it('rikkinäisen tietueen kanssa uuden tallennus säilyttää rikkinäisen tietueen sellaisenaan', async () => {
    const rikki = { ...tyontekija({ id: 'rikki001', nimi: 'Rikkinen Rauni' }), hetu: 'EI-HETU' };
    const { user, client } = await renderRoute('/palkat/tyontekijat', {
      seed: siemenellaTyontekijat([rikki]),
    });
    await user.click(await screen.findByRole('button', { name: '+ Lisää työntekijä' }));
    await user.type(await screen.findByLabelText('Nimi'), 'Toinen Toivo');
    await user.type(screen.getByLabelText('Henkilötunnus'), HETU_2);
    await user.type(screen.getByLabelText('Ammattikoodi (TK10)'), '12345');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () => {
      const raaka = JSON.parse((await client.haeAsetukset()).PalkatTyontekijat ?? '[]');
      expect(raaka).toHaveLength(2);
    });
    const raaka = JSON.parse((await client.haeAsetukset()).PalkatTyontekijat ?? '[]');
    expect(raaka[0]).toMatchObject({ id: 'rikki001', hetu: 'EI-HETU' });
    expect(raaka[1]).toMatchObject({ nimi: 'Toinen Toivo', hetu: HETU_2 });
  });

  it('muokkaus säilyttää tuntemattomat kentät; passivointi ei poista työntekijää', async () => {
    const { user, client } = await renderRoute('/palkat/tyontekijat', {
      seed: siemenellaTyontekijat([{ ...tyontekija(), tulevaisuuden: 'säilyy' }]),
    });
    await user.click(await screen.findByRole('button', { name: 'Muokkaa: Testinen Tuula' }));
    const nimi = await screen.findByLabelText('Nimi');
    await user.clear(nimi);
    await user.type(nimi, 'Testinen Tuulia');
    expect(screen.getByLabelText('Henkilötunnus')).toHaveValue(HETU);
    await user.click(screen.getByLabelText('Aktiivinen'));
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));

    await waitFor(async () => expect((await luettu(client))[0]?.nimi).toBe('Testinen Tuulia'));
    const raaka = JSON.parse((await client.haeAsetukset()).PalkatTyontekijat ?? '[]');
    expect(raaka).toHaveLength(1);
    expect(raaka[0]).toMatchObject({ id: 'abc12345', aktiivinen: false, tulevaisuuden: 'säilyy' });
    expect(await screen.findByText('Ei käytössä')).toBeInTheDocument();
  });

  it('toiminimen kirjalla YEL-valinta näyttää huomautuksen', async () => {
    const { user } = await renderRoute('/palkat/tyontekijat', {
      seed: { ...SEED, asetukset: { Nimi: 'Demo', muoto: 'tmi' } },
    });
    await user.click(await screen.findByRole('button', { name: '+ Lisää työntekijä' }));
    await user.selectOptions(await screen.findByLabelText('Vakuutusperuste'), 'yel');
    expect(screen.getByText(/toiminimi/i)).toBeInTheDocument();
    const lomake = screen.getByLabelText('työntekijälomake');
    expect(within(lomake).getByText(/yksityisnostoja/)).toBeInTheDocument();
  });

  it('uusi tunnus ei koskaan ylikirjoita rikkinäisen tietueen tunnusta', async () => {
    const rikki = { ...tyontekija({ id: 'rikki001', nimi: 'Rikkinen Rauni' }), hetu: 'EI-HETU' };
    // Ensimmäinen arvonta tuottaa täsmälleen rikkinäisen tietueen tunnuksen (r,i,k,k,i,0,0,1 base36).
    const kolikko = [27, 18, 20, 20, 18, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
    const muut = [5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 0, 0, 0, 0, 0];
    const taytto = (kohde: Uint8Array, lahde: number[]) => {
      kohde.set(lahde);
      return kohde;
    };
    const arvonta = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementationOnce(((k: Uint8Array) => taytto(k, kolikko)) as never)
      .mockImplementation(((k: Uint8Array) => taytto(k, muut)) as never);
    const { user, client } = await renderRoute('/palkat/tyontekijat', {
      seed: siemenellaTyontekijat([rikki]),
    });
    await user.click(await screen.findByRole('button', { name: '+ Lisää työntekijä' }));
    await user.type(await screen.findByLabelText('Nimi'), 'Toinen Toivo');
    await user.type(screen.getByLabelText('Henkilötunnus'), HETU_2);
    await user.type(screen.getByLabelText('Ammattikoodi (TK10)'), '12345');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () => {
      const raaka = JSON.parse((await client.haeAsetukset()).PalkatTyontekijat ?? '[]');
      expect(raaka).toHaveLength(2);
    });
    expect(arvonta).toHaveBeenCalled();
    const raaka = JSON.parse((await client.haeAsetukset()).PalkatTyontekijat ?? '[]');
    expect(raaka[0]).toMatchObject({ id: 'rikki001', hetu: 'EI-HETU' });
    expect(raaka[1].id).not.toBe('rikki001');
  });

  it('virheellinen euroteksti (kuukausipalkka) estää tallennuksen eikä tallenna vanhaa arvoa', async () => {
    const { user, client } = await renderRoute('/palkat/tyontekijat', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Lisää työntekijä' }));
    await user.type(await screen.findByLabelText('Nimi'), 'Testinen Tuula');
    await user.type(screen.getByLabelText('Henkilötunnus'), HETU);
    await user.type(screen.getByLabelText('Ammattikoodi (TK10)'), '12345');
    await user.type(screen.getByLabelText('Kuukausipalkka'), '3000');
    await user.tab(); // vahvistaa 3000 €
    const palkka = screen.getByLabelText('Kuukausipalkka');
    await user.clear(palkka);
    await user.type(palkka, '30x0');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText(/Tarkista euromäärät/)).toBeInTheDocument();
    expect((await client.haeAsetukset()).PalkatTyontekijat).toBeUndefined();

    // Korjaus poistaa virheen ja tallennus onnistuu uudella arvolla
    await user.clear(palkka);
    await user.type(palkka, '3100');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () => expect(await luettu(client)).toHaveLength(1));
    expect((await luettu(client))[0]?.kuukausipalkka).toBe(310000);
  });

  it('virheellinen euroteksti verokortin tulorajassa estää tallennuksen', async () => {
    const { user, client } = await renderRoute('/palkat/tyontekijat', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: '+ Lisää työntekijä' }));
    await user.type(await screen.findByLabelText('Nimi'), 'Testinen Tuula');
    await user.type(screen.getByLabelText('Henkilötunnus'), HETU);
    await user.type(screen.getByLabelText('Ammattikoodi (TK10)'), '12345');
    await user.click(screen.getByRole('button', { name: '+ Lisää verokortti' }));
    await user.type(screen.getByLabelText('Verokortti 1: perusprosentti'), '20');
    await user.type(screen.getByLabelText('Verokortti 1: tuloraja'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText(/Tarkista euromäärät/)).toBeInTheDocument();
    expect((await client.haeAsetukset()).PalkatTyontekijat).toBeUndefined();
    // Kortin poisto poistaa myös virhetilan
    await user.click(screen.getByRole('button', { name: 'Poista verokortti 1' }));
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () => expect(await luettu(client)).toHaveLength(1));
  });
});
