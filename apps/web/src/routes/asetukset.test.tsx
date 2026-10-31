import { renderRoute } from '@/test/renderRoute';
import { muotoilePvm } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: {
    Nimi: 'Demo Oy',
    Ytunnus: '',
    Kotipaikka: 'Helsinki',
    muoto: 'oy',
    AlvVelvollinen: 'false',
    // muodot-vaihtoehdot JSON-merkkijonona (kuten luoSiemen.ts tallentaa).
    muodot: JSON.stringify({
      oy: { fi: 'Osakeyhtiö', sv: 'Aktiebolag' },
      tmi: { fi: 'Toiminimi', sv: 'Firma' },
    }),
  },
};

describe('Asetukset-näkymä — organisaation asetukset', () => {
  it('näyttää nykyiset asetukset lomakkeella', async () => {
    await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');
    expect(within(sivu).getByLabelText('Nimi')).toHaveValue('Demo Oy');
    expect(within(sivu).getByLabelText('Kotipaikka')).toHaveValue('Helsinki');
    expect(within(sivu).getByLabelText('Yritysmuoto')).toHaveValue('oy');
    expect(within(sivu).getByLabelText('Arvonlisäverovelvollinen')).not.toBeChecked();
  });

  it('tallentaa vain muuttuneet avaimet ja näyttää vahvistuksen', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');

    const nimi = within(sivu).getByLabelText('Nimi');
    await user.clear(nimi);
    await user.type(nimi, 'Uusi Oy');
    await user.type(within(sivu).getByLabelText('Y-tunnus'), '1234567-8');
    await user.click(within(sivu).getByLabelText('Arvonlisäverovelvollinen'));
    await user.selectOptions(within(sivu).getByLabelText('Yritysmuoto'), 'tmi');

    await user.click(within(sivu).getByRole('button', { name: 'Tallenna' }));

    // Vahvistus näkyy (async -> findBy).
    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();

    // Saman clientin kautta: muutokset tallentuivat.
    const init = await client.haeInit();
    expect(init.asetukset.Nimi).toBe('Uusi Oy');
    expect(init.asetukset.Ytunnus).toBe('1234567-8');
    expect(init.asetukset.AlvVelvollinen).toBe('true');
    expect(init.asetukset.muoto).toBe('tmi');
    // Muuttumaton kenttä säilyy ennallaan.
    expect(init.asetukset.Kotipaikka).toBe('Helsinki');
  });

  it('tallentaa alv-velvollisuuden alkamispäivän (AlvAlkaa)', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const kentta = await screen.findByLabelText(/ALV-velvollisuus alkaa/i);
    await user.clear(kentta);
    await user.type(kentta, '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset.AlvAlkaa).toBe('2026-01-01');
    });
  });
});

describe('Asetukset-näkymä — tilikaudet', () => {
  it('listaa tilikaudet ja korostaa viimeisen', async () => {
    await renderRoute('/asetukset', {
      seed: {
        ...SEED,
        tilikaudet: [
          { alkaa: '2025-01-01', loppuu: '2025-12-31' },
          { alkaa: '2026-01-01', loppuu: '2026-12-31' },
        ],
      },
    });
    const sivu = await screen.findByLabelText('asetukset');
    const lista = within(sivu).getByLabelText('tilikaudet');
    // Molemmat kaudet näkyvät muotoiltuina.
    expect(
      within(lista).getByText(muotoilePvm('2025-01-01'), { exact: false }),
    ).toBeInTheDocument();
    const viimeinen = within(lista)
      .getByText(muotoilePvm('2026-01-01'), { exact: false })
      .closest('[data-aktiivinen="true"]');
    expect(viimeinen).not.toBeNull();
  });

  it('luo seuraavan tilikauden lisäämällä loppuun', async () => {
    const { user, client } = await renderRoute('/asetukset', {
      seed: { ...SEED, tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }] },
    });
    const sivu = await screen.findByLabelText('asetukset');
    await user.click(within(sivu).getByRole('button', { name: 'Uusi tilikausi' }));

    // Uusi kausi 2027-01-01..2027-12-31 ilmestyy listaan.
    expect(
      await within(sivu).findByText(muotoilePvm('2027-01-01'), { exact: false }),
    ).toBeInTheDocument();

    // Saman clientin kautta: kausi tallentui.
    const kaudet = await client.haeTilikaudet();
    expect(kaudet.some((k) => k.alkaa === '2027-01-01' && k.loppuu === '2027-12-31')).toBe(true);
  });
});

describe('Asetukset-näkymä — laskutustiedot (osoite + IBAN)', () => {
  it('tallentaa osoitteen, postinumeron, kaupungin ja normalisoidun IBANin harvalla PATCHilla', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');

    await user.type(within(sivu).getByLabelText('Osoite'), 'Demokatu 1');
    await user.type(within(sivu).getByLabelText('Postinumero'), '00100');
    await user.type(within(sivu).getByLabelText('Kaupunki'), 'Helsinki');
    await user.type(within(sivu).getByLabelText('IBAN'), 'fi21 1234 5600 0007 85');
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna' }));

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    const init = await client.haeInit();
    expect(init.asetukset.Osoite).toBe('Demokatu 1');
    expect(init.asetukset.Postinumero).toBe('00100');
    expect(init.asetukset.Kaupunki).toBe('Helsinki');
    // IBAN normalisoituu: välit pois, isot kirjaimet.
    expect(init.asetukset.LaskuIban).toBe('FI2112345600000785');
    // Harva PATCH: koskematon avain säilyy ennallaan.
    expect(init.asetukset.Kotipaikka).toBe('Helsinki');
  });

  it('estää virheellisen IBANin tallennuksen viestillä "Tarkista IBAN"', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');

    await user.type(within(sivu).getByLabelText('IBAN'), 'FI99 0000');
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna' }));

    expect(await screen.findByText('Tarkista IBAN')).toBeInTheDocument();
    expect(screen.queryByText('Tallennettu')).not.toBeInTheDocument();
    const init = await client.haeInit();
    expect(init.asetukset.LaskuIban).toBeUndefined();
  });

  it('tyhjennetty IBAN poistaa avaimen null-patchilla', async () => {
    const { user, client } = await renderRoute('/asetukset', {
      seed: {
        ...SEED,
        asetukset: { ...SEED.asetukset, LaskuIban: 'FI2112345600000785' },
      },
    });
    const sivu = await screen.findByLabelText('asetukset');

    const kentta = within(sivu).getByLabelText('IBAN');
    expect(kentta).toHaveValue('FI2112345600000785');
    await user.clear(kentta);
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna' }));

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset.LaskuIban).toBeUndefined();
    });
  });
});

describe('Asetukset-näkymä — laskun alatunnisteen yhteystiedot', () => {
  it('tallentaa puhelimen, sähköpostin ja kotisivun harvalla PATCHilla', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');

    await user.type(within(sivu).getByLabelText('Puhelin'), '040 123 4567');
    await user.type(within(sivu).getByLabelText('Sähköposti'), 'laskut@demo.fi');
    await user.type(within(sivu).getByLabelText('Kotisivu'), 'www.demo.fi');
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna' }));

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    const init = await client.haeInit();
    expect(init.asetukset.Puhelin).toBe('040 123 4567');
    expect(init.asetukset.Email).toBe('laskut@demo.fi');
    expect(init.asetukset.Kotisivu).toBe('www.demo.fi');
    expect(init.asetukset.Kotipaikka).toBe('Helsinki');
  });

  it('tyhjennetty sähköposti poistaa avaimen null-patchilla', async () => {
    const { user, client } = await renderRoute('/asetukset', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, Email: 'laskut@demo.fi' } },
    });
    const sivu = await screen.findByLabelText('asetukset');
    const kentta = within(sivu).getByLabelText('Sähköposti');
    expect(kentta).toHaveValue('laskut@demo.fi');
    await user.clear(kentta);
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna' }));

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    await waitFor(async () => {
      expect((await client.haeInit()).asetukset.Email).toBeUndefined();
    });
  });
});

describe('Asetukset-näkymä — alv-ilmoituskausi ja maksuperusteinen alv', () => {
  it('näyttää verokauden historian ja kirjaa muutoksen alkupäivällä', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');
    const historia = within(sivu).getByRole('list', { name: 'verokausihistoria' });
    expect(historia).toHaveTextContent('Kuukausi');
    expect(historia).toHaveTextContent('kirjanpidon alusta');
    await user.click(within(sivu).getByRole('button', { name: 'Muuta verokautta' }));
    await user.click(within(sivu).getByRole('button', { name: 'Neljännesvuosi' }));
    const alkaen = within(sivu).getByLabelText('Uusi verokausi alkaen');
    await user.clear(alkaen);
    await user.type(alkaen, '2030-01-01');
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna muutos' }));

    expect(await within(sivu).findByText('Tulossa')).toBeInTheDocument();
    const init = await client.haeInit();
    expect(JSON.parse(init.asetukset.AlvKausiHistoria ?? '[]')).toEqual([
      { alkaa: '', kk: 1 },
      { alkaa: '2030-01-01', kk: 3 },
    ]);
    // Legacy-avain seuraa tämänhetkistä pituutta; muut avaimet ennallaan.
    expect(init.asetukset.AlvKausi).toBe('1');
    expect(init.asetukset.Kotipaikka).toBe('Helsinki');

    await user.click(within(sivu).getByRole('button', { name: 'Peru tuleva muutos' }));
    await waitFor(() => expect(within(sivu).queryByText('Tulossa')).not.toBeInTheDocument());
  });

  it('tallentaa maksuperusteisen alv:n alkamis- ja päättymispäivän', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');
    await user.type(within(sivu).getByLabelText('Maksuperusteinen ALV alkaen'), '2026-01-01');
    await user.type(within(sivu).getByLabelText('Maksuperusteinen ALV päättyen'), '2026-12-31');
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna' }));

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    const init = await client.haeInit();
    expect(init.asetukset.MaksuAlvAlkaa).toBe('2026-01-01');
    expect(init.asetukset.MaksuAlvLoppuu).toBe('2026-12-31');
  });

  it('tyhjennetty MaksuAlvAlkaa poistaa avaimen null-patchilla', async () => {
    const { user, client } = await renderRoute('/asetukset', {
      seed: {
        ...SEED,
        asetukset: { ...SEED.asetukset, MaksuAlvAlkaa: '2026-01-01' },
      },
    });
    const sivu = await screen.findByLabelText('asetukset');
    const kentta = within(sivu).getByLabelText('Maksuperusteinen ALV alkaen');
    expect(kentta).toHaveValue('2026-01-01');
    await user.clear(kentta);
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna' }));

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset.MaksuAlvAlkaa).toBeUndefined();
    });
  });
});

describe('Asetukset-näkymä — Kysy', () => {
  it('esitäyttää paikallisen mallin asetukset.KysyMalli-arvosta', async () => {
    await renderRoute('/asetukset', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, KysyMalli: 'qwen3.5:7b' } },
    });
    const sivu = await screen.findByLabelText('asetukset');
    expect(within(sivu).getByLabelText('Paikallinen malli')).toHaveValue('qwen3.5:7b');
  });

  it('näyttää oletusmallin qwen3.5:2b placeholderina, kun KysyMalli puuttuu', async () => {
    await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');
    expect(within(sivu).getByLabelText('Paikallinen malli')).toHaveAttribute(
      'placeholder',
      'qwen3.5:2b',
    );
  });

  it('tallentaa muuttuneen mallinimen harvalla PATCHilla', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');

    const kentta = within(sivu).getByLabelText('Paikallinen malli');
    await user.type(kentta, 'qwen3.5:7b');
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna malli' }));

    await waitFor(async () => {
      expect((await client.haeInit()).asetukset.KysyMalli).toBe('qwen3.5:7b');
    });
    // Harva PATCH: koskematon avain säilyy ennallaan.
    const init = await client.haeInit();
    expect(init.asetukset.Kotipaikka).toBe('Helsinki');
  });

  it('tyhjennetty malli poistaa KysyMalli-avaimen null-patchilla', async () => {
    const { user, client } = await renderRoute('/asetukset', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, KysyMalli: 'qwen3.5:7b' } },
    });
    const sivu = await screen.findByLabelText('asetukset');

    const kentta = within(sivu).getByLabelText('Paikallinen malli');
    expect(kentta).toHaveValue('qwen3.5:7b');
    await user.clear(kentta);
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna malli' }));

    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset.KysyMalli).toBeUndefined();
    });
  });

  it('siistii mallinimen ympäröivän välilyönnin ennen tallennusta', async () => {
    const { user, client } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');

    const kentta = within(sivu).getByLabelText('Paikallinen malli');
    await user.type(kentta, '  qwen3.5:7b  ');
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna malli' }));

    await waitFor(async () => {
      expect((await client.haeInit()).asetukset.KysyMalli).toBe('qwen3.5:7b');
    });
  });

  it('pelkkä välilyönti mallikentässä poistaa KysyMalli-avaimen kuten tyhjä kenttä', async () => {
    const { user, client } = await renderRoute('/asetukset', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, KysyMalli: 'qwen3.5:7b' } },
    });
    const sivu = await screen.findByLabelText('asetukset');

    const kentta = within(sivu).getByLabelText('Paikallinen malli');
    await user.clear(kentta);
    await user.type(kentta, '   ');
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna malli' }));

    await waitFor(async () => {
      const init = await client.haeInit();
      expect(init.asetukset.KysyMalli).toBeUndefined();
    });
  });

  it('ei sisällytä KysyMalli-avainta PATCHiin, kun malli on muuttumaton', async () => {
    const { user, client } = await renderRoute('/asetukset', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, KysyMalli: 'qwen3.5:7b' } },
    });
    const sivu = await screen.findByLabelText('asetukset');

    // Kenttää ei kosketa — tallennus lähettää tyhjän patchin tälle avaimelle.
    await user.click(within(sivu).getByRole('button', { name: 'Tallenna malli' }));

    expect(await screen.findByText('Tallennettu')).toBeInTheDocument();
    const init = await client.haeInit();
    // Harva PATCH: koskematon avain säilyy ennallaan (ei ylikirjoiteta samalla arvolla).
    expect(init.asetukset.KysyMalli).toBe('qwen3.5:7b');
  });
});
