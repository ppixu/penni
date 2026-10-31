import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

const LAYOUT = JSON.stringify({
  nimi: { fi: 'Tuloslaskelma' },
  muoto: { fi: 'Yleinen' },
  rivit: [
    { fi: 'Liikevaihto', L: '3', M: 'bold' },
    { fi: 'Tilikauden tulos', L: '3..4 =', M: 'bold' },
  ],
});

const SEED = {
  tilit: [
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tulos' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false', 'tulos/yleinen': LAYOUT },
};

describe('Raportit-näkymä', () => {
  it('"Mikä tämä on?" kertoo valitun raportin tarkoituksen', async () => {
    const user = userEvent.setup();
    await renderRoute('/raportit?raportti=paakirja', { seed: SEED });
    const ohje = await screen.findByRole('button', { name: 'Mikä tämä on?' });
    expect(ohje).toHaveAccessibleDescription(/Kirjaukset tileittäin/);
    const valitsin = screen.getByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Tuloslaskelma' });
    await user.selectOptions(valitsin, 'tulos');
    expect(
      await screen.findByRole('button', { name: 'Mikä tämä on?' }),
    ).toHaveAccessibleDescription(/voitto tai tappio/);
  });

  it('tarjoaa tasetta ja tuloslaskelmaa vain yleisellä kaavalla', async () => {
    const kaava = (nimi: string, muoto: string, rivi: string) =>
      JSON.stringify({
        nimi: { fi: nimi },
        muoto: { fi: muoto },
        rivit: [{ fi: rivi, L: '1..9' }],
      });
    await renderRoute('/raportit', {
      seed: {
        ...SEED,
        asetukset: {
          ...SEED.asetukset,
          'tase/PMA': kaava('Tase', 'Pien- ja mikroyritys', 'PMA-rivi'),
          'tase/yleinen': kaava('Tase', 'Yleinen', 'Yleinen tase-rivi'),
          'tulos/mikrobrutto': kaava('Tuloslaskelma', 'Mikro', 'Mikro-rivi'),
        },
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Tase' });
    const vaihtoehdot = within(valitsin).getAllByRole('option');
    const nimet = vaihtoehdot.map((o) => o.textContent);
    expect(nimet.filter((n) => n?.startsWith('Tase') || n?.startsWith('Tulos'))).toEqual([
      'Tase',
      'Tuloslaskelma',
      'Tase kuukausittain',
      'Tuloslaskelma kuukausittain',
      'Tase-erittely',
    ]);
    // Tase opens by default, on the general layout rather than PMA.
    expect(valitsin).toHaveValue('tase');
    expect(await screen.findByText('Yleinen tase-rivi')).toBeInTheDocument();
    expect(screen.queryByText('PMA-rivi')).not.toBeInTheDocument();
  });

  it('renderöi tuloslaskelman summat seedatusta kirjanpidosta', async () => {
    await renderRoute('/raportit', {
      seed: SEED,
      arrange: async (c) => {
        // myynti 8 642,10 -> kredit 3000 / debet 1900
        await c.luoTosite({
          pvm: '2026-03-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            {
              tili: 1900,
              debet: Euro.fromCents(864_210),
              kredit: Euro.fromCents(0),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(864_210),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    expect(await screen.findByLabelText('raportti')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Tuloslaskelma' })).toBeInTheDocument();
    // RTL normalizes NBSP to a regular space in textContent.
    const liikevaihto = await screen.findByText('Liikevaihto');
    expect(liikevaihto.closest('tr')).toHaveTextContent('8 642,10 €');
  });

  it('näyttää *-rivien alla tilit numeroineen; "Näytä tilit" piilottaa ne', async () => {
    const erittelyLayout = JSON.stringify({
      nimi: { fi: 'Tuloslaskelma' },
      muoto: { fi: 'Yleinen' },
      rivit: [
        { fi: 'Liikevaihto', L: '30..35 S *', M: 'bold' },
        { fi: 'Ostot tilikauden aikana', L: '40..43 *', S: 2 },
        { fi: 'Tilikauden voitto/tappio', L: '3..9 S', M: 'bold' },
      ],
    });
    await renderRoute('/raportit', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, 'tulos/yleinen': erittelyLayout } },
      arrange: async (c) => {
        // myynti 100,00 ja osto 28,81 pankista
        await c.luoTosite({
          pvm: '2026-03-01',
          tyyppi: 200,
          sarja: '',
          tila: 100,
          viennit: [
            {
              tili: 1900,
              debet: Euro.fromCents(7119),
              kredit: Euro.fromCents(0),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 4000,
              debet: Euro.fromCents(2881),
              kredit: Euro.fromCents(0),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: Euro.fromCents(0),
              kredit: Euro.fromCents(10_000),
              pvm: '2026-03-01',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        });
      },
    });
    const ostot = await screen.findByText('4000 Ostot');
    expect(ostot.closest('tr')).toHaveTextContent('−28,81 €');
    const myynti = screen.getByText('3000 Myynti').closest('tr') as HTMLElement;
    expect(within(myynti).getByText('100,00 €')).toBeInTheDocument();
    // Tilirivi avaa tilin tilikartassa (kaikki-näkymä, tilin kohdalle).
    expect(screen.getByRole('link', { name: '4000 Ostot' })).toHaveAttribute(
      'href',
      '/tilikartta?nakyma=kaikki&tili=4000',
    );
    // Tilirivi sisennetään rivinsä alle (S 2 -> 3 tasoa).
    expect(ostot.closest('td')).toHaveStyle({ paddingLeft: '48px' });

    const valinta = screen.getByRole('checkbox', { name: 'Näytä tilit' });
    expect(valinta).toBeChecked();
    await userEvent.click(valinta);
    expect(screen.queryByText('4000 Ostot')).not.toBeInTheDocument();
    expect(screen.getByText('Ostot tilikauden aikana').closest('tr')).toHaveTextContent('−28,81 €');
  });

  it('tulosteen otsikossa on yritys, ja tase näyttää päivän eikä jaksoa', async () => {
    const tase = JSON.stringify({
      nimi: { fi: 'Tase' },
      muoto: { fi: 'Yleinen' },
      rivit: [{ fi: 'Vastaavaa', L: '1 S' }],
    });
    const { user } = await renderRoute('/raportit', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, 'tase/yleinen': tase } },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Tase kuukausittain' });
    const otsikko = () => screen.getByRole('heading', { level: 1, hidden: true });
    expect(otsikko()).toHaveTextContent(/^Demo Oy – Tase 31\.12\.2026$/);
    await user.selectOptions(valitsin, 'Tase-erittely');
    expect(otsikko()).toHaveTextContent(/^Demo Oy – Tase-erittely 31\.12\.2026$/);
    await user.selectOptions(valitsin, 'Tase kuukausittain');
    expect(otsikko()).toHaveTextContent('Demo Oy – Tase kuukausittain 1.1.2026 – 31.12.2026');
    await user.selectOptions(valitsin, 'Tuloslaskelma');
    expect(otsikko()).toHaveTextContent('Demo Oy – Tuloslaskelma 1.1.2026 – 31.12.2026');
  });

  it('näyttää virheen "Ladataan…"-tekstin sijaan, kun raportin kysely epäonnistuu', async () => {
    const { user } = await renderRoute('/raportit', {
      seed: SEED,
      arrange: async (c) => {
        c.listaaTositteet = () => Promise.reject(new Error('palvelin ei vastaa'));
      },
    });
    const valitsin = await screen.findByLabelText('Raportti');
    await within(valitsin).findByRole('option', { name: 'Tositeluettelo' });
    await user.selectOptions(valitsin, 'Tositeluettelo');
    expect(await screen.findByRole('alert')).toHaveTextContent('Raportin laadinta epäonnistui.');
    expect(screen.queryByText('Ladataan…')).not.toBeInTheDocument();
  });
});

describe('Raportit: pääkirja rajattuna tilikartasta', () => {
  const myynti = async (c: KpClient) => {
    await c.luoTosite({
      pvm: '2026-03-01',
      tyyppi: 200,
      sarja: '',
      tila: 100,
      viennit: [
        {
          tili: 1900,
          debet: Euro.fromCents(10_000),
          kredit: Euro.fromCents(0),
          pvm: '2026-03-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
        {
          tili: 3000,
          debet: Euro.fromCents(0),
          kredit: Euro.fromCents(10_000),
          pvm: '2026-03-01',
          alvKoodi: 0,
          alvProsentti: 0,
        },
      ],
    });
  };
  const tilitPaakirjassa = async () => {
    const taulu = await screen.findByRole('table', { name: 'Pääkirja' });
    return within(taulu)
      .getAllByRole('link', { name: /^\d{4} / })
      .map((l) => l.textContent);
  };

  it('tili-parametri näyttää vain sen tilin; "Kaikki tilit" poistaa rajauksen', async () => {
    const { user, router } = await renderRoute('/raportit?raportti=paakirja&tili=1900', {
      seed: SEED,
      arrange: myynti,
    });
    expect(await screen.findByLabelText('Raportti')).toHaveValue('paakirja');
    expect(await tilitPaakirjassa()).toEqual(['1900 Pankki']);
    expect(screen.getByText('Tili 1900 Pankki')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kaikki tilit' }));
    expect(router.state.location.search).toEqual({ raportti: 'paakirja' });
    await waitFor(async () =>
      expect(await tilitPaakirjassa()).toEqual(['1900 Pankki', '3000 Myynti']),
    );
  });

  it('tiliryhmä-parametri rajaa etuliitteellä', async () => {
    await renderRoute('/raportit?raportti=paakirja&tiliryhma=3', { seed: SEED, arrange: myynti });
    expect(await tilitPaakirjassa()).toEqual(['3000 Myynti']);
    expect(screen.getByText('Tilit 3000–3999')).toBeInTheDocument();
  });

  it('rajaus ilman kirjauksia kertoo sen', async () => {
    await renderRoute('/raportit?raportti=paakirja&tili=4000', { seed: SEED, arrange: myynti });
    expect(
      await screen.findByText(
        'Rajauksen tileillä ei ole kirjauksia eikä saldoa tällä tilikaudella.',
      ),
    ).toBeInTheDocument();
  });
});
