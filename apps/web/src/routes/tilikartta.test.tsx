import { renderRoute } from '@/test/renderRoute';
import type { KpClient } from '@penni/asiakas';
import { tyyppiKoodilla } from '@penni/engine';
import { Euro } from '@penni/euro';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SEED = {
  tilit: [
    { numero: 1, tyyppi: 'H1', nimi: { fi: 'VASTAAVAA' } },
    { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankki' } },
    { numero: 2, tyyppi: 'H1', nimi: { fi: 'VASTATTAVAA' } },
    { numero: 2371, tyyppi: 'T', nimi: { fi: 'Tilikauden tulos' } },
    { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
    { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
  ],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Demo Oy', AlvVelvollinen: 'false' },
};

describe('Tilikartta-näkymä', () => {
  it('renderöi lehtitilit ensimmäisen numeron ryhmiin kartan otsikoiden nimillä', async () => {
    await renderRoute('/tilikartta', { seed: SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    // No favourites and no postings → opens on Kaikki.
    expect(screen.getByRole('button', { name: 'Kaikki' })).toHaveAttribute('aria-pressed', 'true');
    // One group per first digit (shown as 1000, 2000 …) and a sub-group per two first digits;
    // 3 and 4 have no heading of their own and inherit VASTATTAVAA. The seed has only H1
    // headings, so sub-groups fall back to their number range. The repeated VASTATTAVAA has no
    // deeper headings to tell the groups apart, so their accounts' names do.
    const ryhmat = [...sivu.querySelectorAll('tr[data-ryhma]')].map((r) => r.textContent);
    expect(ryhmat).toEqual([
      '1000VASTAAVAA1',
      '19001900-alkuiset tilit1',
      '2000VASTATTAVAA (tilikauden tulos)1',
      '23002300-alkuiset tilit1',
      '3000VASTATTAVAA (myynti)1',
      '30003000-alkuiset tilit1',
      '4000VASTATTAVAA (ostot)1',
      '40004000-alkuiset tilit1',
    ]);
    // Leaf row shows number, name and human type label.
    const pankki = within(sivu).getByText('Pankki').closest('tr');
    expect(pankki).not.toBeNull();
    expect(pankki).toHaveTextContent('1900');
    expect(pankki).toHaveTextContent('Pankki');
    // ARP's type label ("Pankkitili") is the human kuvaus shown in the type column.
    expect(pankki).toHaveTextContent('Pankkitili');
  });

  it('ryhmän otsikko taittaa ryhmän; Avaa kaikki ja Sulje kaikki koskevat kaikkia', async () => {
    const { user } = await renderRoute('/tilikartta', { seed: SEED });
    await screen.findByLabelText('tilikartta');
    const vastaavaa = screen.getByRole('button', { name: /^1000\s*VASTAAVAA/ });
    expect(vastaavaa).toHaveAttribute('aria-expanded', 'true');
    await user.click(vastaavaa);
    expect(vastaavaa).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Pankki')).not.toBeInTheDocument();
    expect(screen.getByText('Myynti')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sulje kaikki' }));
    expect(screen.queryByText('Myynti')).not.toBeInTheDocument();
    expect(screen.queryByText('Ostot')).not.toBeInTheDocument();
    // Search shows hits even inside collapsed groups, and hides the bulk buttons.
    await user.type(screen.getByLabelText('Hae tiliä'), 'myyn');
    expect(screen.getByText('Myynti')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Avaa kaikki' })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Hae tiliä'));

    await user.click(screen.getByRole('button', { name: 'Avaa kaikki' }));
    expect(screen.getByText('Pankki')).toBeInTheDocument();
    expect(screen.getByText('Ostot')).toBeInTheDocument();
  });

  it('alaryhmä taittuu erikseen; Sulje kaikki sulkee myös alaryhmät', async () => {
    const { user } = await renderRoute('/tilikartta', { seed: SEED });
    await screen.findByLabelText('tilikartta');
    const ala = screen.getByRole('button', { name: /^1900/ });
    await user.click(ala);
    expect(ala).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Pankki')).not.toBeInTheDocument();
    // The parent stays open with its sub-header visible.
    expect(screen.getByRole('button', { name: /^1000/ })).toHaveAttribute('aria-expanded', 'true');
    await user.click(ala);
    expect(screen.getByText('Pankki')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sulje kaikki' }));
    await user.click(screen.getByRole('button', { name: /^1000/ }));
    // Opening the parent shows its sub-groups still collapsed.
    expect(screen.getByRole('button', { name: /^1900/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Pankki')).not.toBeInTheDocument();
  });

  it('ryhmän otsikko toimii näppäimistöllä: Enter taittaa, nuolet sulkevat ja avaavat', async () => {
    const { user } = await renderRoute('/tilikartta', { seed: SEED });
    await screen.findByLabelText('tilikartta');
    const ryhma = screen.getByRole('button', { name: /^3000\s*VASTATTAVAA/ });
    ryhma.focus();
    await user.keyboard('{Enter}');
    expect(ryhma).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Myynti')).not.toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(ryhma).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Myynti')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(ryhma).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(ryhma).toHaveAttribute('aria-expanded', 'true');
  });

  it('viisinumeroinen tili ei toista ryhmää (rikkoi kokoontaiton)', async () => {
    const { user } = await renderRoute('/tilikartta', {
      seed: {
        ...SEED,
        tilit: [...SEED.tilit, { numero: 19001, tyyppi: 'ARP', nimi: { fi: 'Alatili' } }],
      },
    });
    const sivu = await screen.findByLabelText('tilikartta');
    const ryhmat = [...sivu.querySelectorAll('tr[data-ryhma]')].map((r) =>
      r.getAttribute('data-ryhma'),
    );
    expect(ryhmat).toEqual(['1', '19', '2', '23', '3', '30', '4', '40']);
    const tilit = [...sivu.querySelectorAll('tr[data-tili]')].map((r) =>
      r.getAttribute('data-tili'),
    );
    expect(tilit.slice(0, 2)).toEqual(['1900', '19001']);
    await user.click(screen.getByRole('button', { name: /^1000\s*VASTAAVAA/ }));
    expect(within(sivu).queryByText('Alatili')).not.toBeInTheDocument();
    expect(within(sivu).queryByText('Pankki')).not.toBeInTheDocument();
  });

  it('jokaiselta riviltä pääsee tilin tai tiliryhmän pääkirjaan', async () => {
    await renderRoute('/tilikartta', { seed: SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    expect(within(sivu).getByRole('link', { name: 'Näytä tilin 1900 viennit' })).toHaveAttribute(
      'href',
      '/raportit?raportti=paakirja&tili=1900',
    );
    expect(within(sivu).getByRole('link', { name: 'Näytä viennit 1000–1999' })).toHaveAttribute(
      'href',
      '/raportit?raportti=paakirja&tiliryhma=1',
    );
    expect(within(sivu).getByRole('link', { name: 'Näytä viennit 1900–1999' })).toHaveAttribute(
      'href',
      '/raportit?raportti=paakirja&tiliryhma=19',
    );
  });

  it('nimen voi vaihtaa rivillä: kynä tai F2, Enter tallentaa ja Esc peruu', async () => {
    const { user, client } = await renderRoute('/tilikartta', {
      seed: {
        ...SEED,
        tilit: SEED.tilit.map((t) =>
          t.numero === 3000 ? { ...t, nimi: { fi: 'Myynti', sv: 'Försäljning' } } : t,
        ),
      },
    });
    const sivu = await screen.findByLabelText('tilikartta');
    const rivi = within(sivu).getByText('Myynti').closest('tr') as HTMLElement;
    await user.click(within(rivi).getByRole('button', { name: 'Nimeä tili 3000 uudelleen' }));
    const kentta = within(rivi).getByLabelText('Tilin 3000 nimi');
    expect(kentta).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('Palvelumyynti{Enter}');
    await waitFor(async () =>
      expect((await client.haeInit()).tilit.find((t) => t.numero === 3000)?.nimi).toEqual({
        fi: 'Palvelumyynti',
        sv: 'Försäljning',
      }),
    );
    expect(await within(sivu).findByText('Palvelumyynti')).toBeInTheDocument();
    // Enter returns focus to the row, so F2 starts a new rename; Esc cancels it.
    expect(rivi).toHaveFocus();
    await user.keyboard('{F2}');
    await user.keyboard('Jotain muuta{Escape}');
    expect(within(sivu).getByText('Palvelumyynti')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await client.haeInit()).tilit.find((t) => t.numero === 3000)?.nimi).toEqual({
      fi: 'Palvelumyynti',
      sv: 'Försäljning',
    });
  });

  it('suodattaa numerolla (etuliite) ja nimellä (osajono)', async () => {
    const { user } = await renderRoute('/tilikartta', { seed: SEED });
    const haku = await screen.findByLabelText('Hae tiliä');
    // Numeric query -> number prefix.
    await user.type(haku, '19');
    expect(screen.getByText('Pankki')).toBeInTheDocument();
    expect(screen.queryByText('Myynti')).not.toBeInTheDocument();
    // Clear, then name substring (case-insensitive).
    await user.clear(haku);
    await user.type(haku, 'myyn');
    expect(screen.getByText('Myynti')).toBeInTheDocument();
    expect(screen.queryByText('Pankki')).not.toBeInTheDocument();
  });

  it('lisää uuden lehtitilin tallennaTili-kutsulla', async () => {
    const { user, client } = await renderRoute('/tilikartta', { seed: SEED });
    await screen.findByLabelText('tilikartta');
    await user.click(screen.getByRole('button', { name: 'Uusi tili' }));

    const dialogi = await screen.findByRole('dialog');
    await user.type(within(dialogi).getByLabelText('Tilinumero'), '1950');
    await user.type(within(dialogi).getByLabelText('Nimi'), 'Käteiskassa');
    // Number starts with 1 → asset types; pick one (ARP / Pankkitili).
    await user.selectOptions(within(dialogi).getByLabelText('Tyyppi'), 'ARP');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));

    // The new account is persisted through the same client.
    const init = await client.haeInit();
    const lisatty = init.tilit.find((t) => t.numero === 1950);
    expect(lisatty).toBeDefined();
    expect(lisatty?.nimi).toEqual({ fi: 'Käteiskassa' });
    expect(lisatty?.tyyppi).toBe('ARP');
    // And it appears in the tree.
    expect(await screen.findByText('Käteiskassa')).toBeInTheDocument();
  });

  it('muokattaessa numero on lukittu ja nimi/tyyppi tallentuvat', async () => {
    const { user, client } = await renderRoute('/tilikartta', { seed: SEED });
    await screen.findByLabelText('tilikartta');
    await user.dblClick(screen.getByText('Myynti'));

    const dialogi = await screen.findByRole('dialog');
    expect(within(dialogi).getByLabelText('Tilinumero')).toBeDisabled();
    const nimiKentta = within(dialogi).getByLabelText('Nimi');
    await user.clear(nimiKentta);
    await user.type(nimiKentta, 'Myyntituotot');
    await user.click(within(dialogi).getByRole('button', { name: 'Tallenna' }));

    const init = await client.haeInit();
    expect(init.tilit.find((t) => t.numero === 3000)?.nimi).toEqual({ fi: 'Myyntituotot' });
  });

  it('poistaa lehtitilin jolla ei ole vientejä', async () => {
    const { user, client } = await renderRoute('/tilikartta', { seed: SEED });
    await screen.findByLabelText('tilikartta');
    await user.dblClick(screen.getByText('Ostot')); // 4000 / D, no postings, not a varo-type

    const dialogi = await screen.findByRole('dialog');
    const poista = await within(dialogi).findByRole('button', { name: 'Poista' });
    expect(poista).toBeEnabled();
    await user.click(poista);

    const init = await client.haeInit();
    expect(init.tilit.find((t) => t.numero === 4000)).toBeUndefined();
  });

  it('estää poiston kun tilillä on vientejä', async () => {
    const { user } = await renderRoute('/tilikartta', {
      seed: SEED,
      arrange: async (c) => {
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
      },
    });
    await screen.findByLabelText('tilikartta');
    // Postings → opens on Viimeksi käytetyt, where a click jumps; edit from Kaikki.
    await user.click(screen.getByRole('button', { name: 'Kaikki' }));
    await user.dblClick(screen.getByText('Myynti')); // 3000 now has a posting
    const dialogi = await screen.findByRole('dialog');
    const poista = await within(dialogi).findByRole('button', { name: 'Poista' });
    expect(poista).toBeDisabled();
    expect(within(dialogi).getByText(/vientejä/i)).toBeInTheDocument();
  });

  it('estää poiston varotyypiltä', async () => {
    const { user } = await renderRoute('/tilikartta', { seed: SEED });
    await screen.findByLabelText('tilikartta');
    // "Tilikauden tulos" is also the human label of type T, so the name appears twice on the row;
    // open the leaf via its unique number cell instead.
    const rivi = screen.getByText('2371').closest('tr');
    expect(rivi).not.toBeNull();
    await user.dblClick(rivi as HTMLTableRowElement); // tyyppi T = varo-type
    const dialogi = await screen.findByRole('dialog');
    expect(await within(dialogi).findByRole('button', { name: 'Poista' })).toBeDisabled();
  });
  it('avautuu suosikkeihin kun niitä on; Kitsaksen "0" ei ole tili', async () => {
    await renderRoute('/tilikartta', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, suosikkitilit: '3000,0' } },
    });
    const sivu = await screen.findByLabelText('tilikartta');
    expect(await screen.findByRole('button', { name: 'Suosikit' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const rivit = within(sivu).getAllByRole('row').slice(1); // skip header row
    expect(rivit).toHaveLength(1);
    expect(rivit[0]).toHaveTextContent('3000');
    expect(
      within(rivit[0] as HTMLElement).getByRole('button', { name: 'Poista suosikeista' }),
    ).toBeInTheDocument();
  });

  it('suosikkinäkymä ilman suosikkeja kertoo miten niitä lisätään', async () => {
    const { user } = await renderRoute('/tilikartta', { seed: SEED });
    await user.click(await screen.findByRole('button', { name: 'Suosikit' }));
    expect(
      screen.getByText('Ei suosikkitilejä. Merkitse tili suosikiksi tähdestä.'),
    ).toBeInTheDocument();
  });

  it('avautuu viimeksi käytettyihin kun suosikkeja ei ole mutta kirjauksia on', async () => {
    await renderRoute('/tilikartta', { seed: SEED, arrange: kirjaaKayttoa });
    expect(await screen.findByRole('button', { name: 'Viimeksi käytetyt' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('viimeksi käytetyt: uusin käyttö ensin, viimeisin päivä ja vientimäärä', async () => {
    await renderRoute('/tilikartta?nakyma=viimeksi', { seed: SEED, arrange: kirjaaKayttoa });
    const sivu = await screen.findByLabelText('tilikartta');
    await within(sivu).findByText('Myynti');
    const rivit = within(sivu).getAllByRole('row').slice(1);
    expect(rivit.map((r) => within(r).getByText(/^\d{4}$/).textContent)).toEqual([
      '3000',
      '4000',
      '1900',
    ]);
    expect(rivit[0]).toHaveTextContent('20.5.2026');
    expect(within(rivit[0] as HTMLElement).getByTestId('viennit')).toHaveTextContent('3');
    expect(rivit[2]).toHaveTextContent('10.3.2026');
    expect(within(rivit[2] as HTMLElement).getByTestId('viennit')).toHaveTextContent('2');
    // Unused accounts are not listed.
    expect(within(sivu).queryByText('Tilikauden tulos')).not.toBeInTheDocument();
  });

  it('saldo ja viennit valitulta kaudelta: kulut positiivisina, ryhmälle summa', async () => {
    await renderRoute('/tilikartta?nakyma=kaikki', { seed: SEED, arrange: kirjaaKayttoa });
    const sivu = await screen.findByLabelText('tilikartta');
    const tilinRivi = (numero: number) =>
      sivu.querySelector(`tr[data-tili="${numero}"]`) as HTMLElement;
    await waitFor(() =>
      expect(within(tilinRivi(1900)).getByTestId('saldo')).toHaveTextContent('200,00'),
    );
    expect(within(tilinRivi(1900)).getByTestId('viennit')).toHaveTextContent('2');
    expect(within(tilinRivi(3000)).getByTestId('saldo')).toHaveTextContent('300,00');
    // Kulutili näytetään positiivisena, ei −100,00.
    expect(within(tilinRivi(4000)).getByTestId('saldo')).toHaveTextContent(/^100,00/);
    const ryhma = sivu.querySelector('tr[data-ryhma="1"]') as HTMLElement;
    expect(within(ryhma).getByTestId('saldo')).toHaveTextContent('200,00');
    expect(within(ryhma).getByTestId('viennit')).toHaveTextContent('2');
  });

  it('"Vain tilit, joilla tapahtumia" piilottaa tilit ilman vientejä ja saldoa', async () => {
    const seed = {
      ...SEED,
      tilit: [...SEED.tilit, { numero: 4500, tyyppi: 'D', nimi: { fi: 'Käyttämätön' } }],
    };
    const { user } = await renderRoute('/tilikartta?nakyma=kaikki', {
      seed,
      arrange: kirjaaKayttoa,
    });
    const sivu = await screen.findByLabelText('tilikartta');
    await within(sivu).findByText('Käyttämätön');
    // Saldot latautuvat erikseen; ennen niitä suodatin ei rajaa mitään.
    await waitFor(() =>
      expect(sivu.querySelector('tr[data-tili="1900"] [data-testid="saldo"]')).toHaveTextContent(
        '200,00',
      ),
    );
    await user.click(screen.getByLabelText('Vain tilit, joilla tapahtumia'));
    await waitFor(() => expect(within(sivu).queryByText('Käyttämätön')).not.toBeInTheDocument());
    // 2371 jää: sillä ei ole vientejä, mutta saldona on laskettu kauden tulos.
    const numerot = [...sivu.querySelectorAll('tr[data-tili]')].map((r) =>
      r.getAttribute('data-tili'),
    );
    expect(numerot).toEqual(['1900', '2371', '3000', '4000']);
  });

  it('tyypin selite näkyy hiiren alla', async () => {
    await renderRoute('/tilikartta?nakyma=kaikki', { seed: SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    await within(sivu).findByText('Pankki');
    const rivi = sivu.querySelector('tr[data-tili="1900"]') as HTMLElement;
    const tyyppi = within(rivi).getByText(tyyppiKoodilla('ARP').kuvaus);
    expect(tyyppi).toHaveAttribute('title', expect.stringContaining('tiliotteen'));
  });

  it('haku rajaa aktiivisen näkymän sisällä', async () => {
    const { user } = await renderRoute('/tilikartta?nakyma=viimeksi', {
      seed: SEED,
      arrange: kirjaaKayttoa,
    });
    const sivu = await screen.findByLabelText('tilikartta');
    await within(sivu).findByText('Myynti');
    await user.type(screen.getByLabelText('Hae tiliä'), 'o');
    // "Ostot" matches; "Tilikauden tulos" matches too but is unused, so it stays out.
    expect(within(sivu).getByText('Ostot')).toBeInTheDocument();
    expect(within(sivu).queryByText('Tilikauden tulos')).not.toBeInTheDocument();
    expect(within(sivu).queryByText('Myynti')).not.toBeInTheDocument();
  });

  it('tähti tallentaa suosikin ja tili siirtyy suosikkeihin', async () => {
    const { user, client } = await renderRoute('/tilikartta', { seed: SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    const myynti = within(sivu).getByText('Myynti').closest('tr') as HTMLElement;
    await user.click(within(myynti).getByRole('button', { name: 'Lisää suosikkeihin' }));
    // Star click must not open the editor.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(async () =>
      expect((await client.haeInit()).asetukset.suosikkitilit).toBe('3000'),
    );
    await user.click(screen.getByRole('button', { name: 'Suosikit' }));
    const rivit = within(sivu).getAllByRole('row').slice(1);
    expect(rivit).toHaveLength(1);
    expect(rivit[0]).toHaveTextContent('Myynti');
    // Un-star from the favourites view.
    await user.click(
      within(rivit[0] as HTMLElement).getByRole('button', { name: 'Poista suosikeista' }),
    );
    expect(
      await screen.findByText('Ei suosikkitilejä. Merkitse tili suosikiksi tähdestä.'),
    ).toBeInTheDocument();
  });

  it('kaikki-näkymä piilottaa piilotetut tilit kunnes ne valitaan näkyviin', async () => {
    const { user, client } = await renderRoute('/tilikartta', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, piilotilit: '4000' } },
    });
    const sivu = await screen.findByLabelText('tilikartta');
    expect(within(sivu).queryByText('Ostot')).not.toBeInTheDocument();
    const nayta = screen.getByLabelText('Näytä piilotetut (1)');
    await user.click(nayta);
    const ostot = within(sivu).getByText('Ostot').closest('tr') as HTMLElement;
    expect(ostot).toHaveTextContent('piilotettu');
    // Un-hide it; it then stays visible with the toggle off.
    await user.click(within(ostot).getByRole('button', { name: 'Näytä tili' }));
    await waitFor(async () => expect((await client.haeInit()).asetukset.piilotilit).toBe(''));
    await user.click(screen.getByLabelText('Näytä piilotetut (0)'));
    expect(within(sivu).getByText('Ostot')).toBeInTheDocument();
    // Hide Myynti; it disappears from Kaikki.
    const myynti = within(sivu).getByText('Myynti').closest('tr') as HTMLElement;
    await user.click(within(myynti).getByRole('button', { name: 'Piilota tili' }));
    await waitFor(() => expect(within(sivu).queryByText('Myynti')).not.toBeInTheDocument());
    expect((await client.haeInit()).asetukset.piilotilit).toBe('3000');
  });

  it('Enter avaa kohdistetun rivin muokattavaksi', async () => {
    const { user } = await renderRoute('/tilikartta', { seed: SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    const myynti = within(sivu).getByText('Myynti').closest('tr') as HTMLElement;
    myynti.focus();
    await user.keyboard('{Enter}');
    const dialogi = await screen.findByRole('dialog');
    expect(within(dialogi).getByLabelText('Tilinumero')).toHaveValue('3000');
  });
});

describe('Tilikartta: hyppy tilin kohdalle kaikki-näkymässä', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const SUOSIKKI_SEED = { ...SEED, asetukset: { ...SEED.asetukset, suosikkitilit: '3000' } };

  it('suosikkirivin klikkaus avaa kaikki-näkymän tilin kohdalta', async () => {
    const vieritys = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { user, router } = await renderRoute('/tilikartta', { seed: SUOSIKKI_SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    await user.click(await within(sivu).findByText('Myynti'));

    expect(screen.getByRole('button', { name: 'Kaikki' })).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.search).toEqual({ nakyma: 'kaikki', tili: 3000 });
    // The whole chart is listed again, and the target row is centred, focused and highlighted.
    expect(within(sivu).getByText('Pankki')).toBeInTheDocument();
    const myynti = within(sivu).getByText('Myynti').closest('tr') as HTMLElement;
    await waitFor(() => expect(myynti).toHaveFocus());
    expect(vieritys.mock.contexts).toContain(myynti);
    expect(vieritys).toHaveBeenCalledWith({ block: 'center' });
    expect(myynti).toHaveAttribute('data-korostettu', 'true');
    // Clicking in Kaikki does not open the editor; Enter on the focused row still does.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(within(await screen.findByRole('dialog')).getByLabelText('Tilinumero')).toHaveValue(
      '3000',
    );
  });

  it('Enter viimeksi käytetyissä hyppää tilin kohdalle', async () => {
    const { user, router } = await renderRoute('/tilikartta?nakyma=viimeksi', {
      seed: SEED,
      arrange: kirjaaKayttoa,
    });
    const sivu = await screen.findByLabelText('tilikartta');
    const ostot = (await within(sivu).findByText('Ostot')).closest('tr') as HTMLElement;
    ostot.focus();
    await user.keyboard('{Enter}');
    expect(router.state.location.search).toEqual({ nakyma: 'kaikki', tili: 4000 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(sivu).getByText('Ostot').closest('tr') as HTMLElement).toHaveFocus(),
    );
  });

  it('tähti ja piilotusnappi eivät hyppää', async () => {
    const { user, router } = await renderRoute('/tilikartta?nakyma=viimeksi', {
      seed: SEED,
      arrange: kirjaaKayttoa,
    });
    const sivu = await screen.findByLabelText('tilikartta');
    const myynti = (await within(sivu).findByText('Myynti')).closest('tr') as HTMLElement;
    await user.click(within(myynti).getByRole('button', { name: 'Lisää suosikkeihin' }));
    await user.click(within(myynti).getByRole('button', { name: 'Piilota tili' }));
    expect(router.state.location.search).toEqual({ nakyma: 'viimeksi' });
    expect(screen.getByRole('button', { name: 'Viimeksi käytetyt' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('hakutuloksen klikkaus kaikki-näkymässä tyhjentää haun ja hyppää tilin kohdalle', async () => {
    const { user, router } = await renderRoute('/tilikartta', { seed: SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    const haku = screen.getByLabelText('Hae tiliä');
    await user.type(haku, 'ost');
    await user.click(within(sivu).getByText('Ostot'));
    expect(haku).toHaveValue('');
    expect(within(sivu).getByText('Pankki')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ nakyma: 'kaikki', tili: 4000 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('syvälinkki piilotettuun tiliin tuo piilotetut näkyviin', async () => {
    await renderRoute('/tilikartta?nakyma=kaikki&tili=4000', {
      seed: { ...SEED, asetukset: { ...SEED.asetukset, piilotilit: '4000' } },
    });
    const sivu = await screen.findByLabelText('tilikartta');
    expect(screen.getByLabelText('Näytä piilotetut (1)')).toBeChecked();
    const ostot = within(sivu).getByText('Ostot').closest('tr') as HTMLElement;
    expect(ostot).toHaveTextContent('piilotettu');
    await waitFor(() => expect(ostot).toHaveFocus());
  });

  it('hyppy suosikista avaa suljetut ryhmät, joissa tili on', async () => {
    const { user } = await renderRoute('/tilikartta?nakyma=kaikki', { seed: SUOSIKKI_SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    await user.click(screen.getByRole('button', { name: 'Sulje kaikki' }));
    expect(within(sivu).queryByText('Myynti')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suosikit' }));
    await user.click(await within(sivu).findByText('Myynti'));
    const myynti = within(sivu).getByText('Myynti').closest('tr') as HTMLElement;
    await waitFor(() => expect(myynti).toHaveFocus());
    expect(screen.getByRole('button', { name: /^3000\s*VASTATTAVAA/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /^3000\s*3000/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // Other groups stay collapsed.
    expect(within(sivu).queryByText('Pankki')).not.toBeInTheDocument();
  });

  it('suosikit ja viimeksi käytetyt ovat tasaisia listoja ilman ryhmiä', async () => {
    const { user } = await renderRoute('/tilikartta?nakyma=viimeksi', {
      seed: SUOSIKKI_SEED,
      arrange: kirjaaKayttoa,
    });
    const sivu = await screen.findByLabelText('tilikartta');
    await within(sivu).findByText('Myynti');
    expect(sivu.querySelector('tr[data-ryhma]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Suosikit' }));
    await within(sivu).findByText('Myynti');
    expect(sivu.querySelector('tr[data-ryhma]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sulje kaikki' })).not.toBeInTheDocument();
  });

  it('pelkkä tili-parametri avaa kaikki-näkymän', async () => {
    await renderRoute('/tilikartta?tili=1900', { seed: SUOSIKKI_SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    expect(screen.getByRole('button', { name: 'Kaikki' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(within(sivu).getByText('Pankki').closest('tr') as HTMLElement).toHaveFocus(),
    );
  });

  it('tuntematon tili näyttää kaikki-näkymän ilman virhettä', async () => {
    await renderRoute('/tilikartta?nakyma=kaikki&tili=9999', { seed: SEED });
    const sivu = await screen.findByLabelText('tilikartta');
    expect(screen.getByRole('button', { name: 'Kaikki' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sivu).getByText('Myynti')).toBeInTheDocument();
    expect(sivu.querySelector('[data-korostettu="true"]')).toBeNull();
  });
});

function vienti(tili: number, pvm: string, debet: number, kredit: number) {
  return {
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
  };
}

/** 1900: 2 postings (last 10.3.), 3000: 3 (last 20.5.), 4000: 1 (20.5.). */
async function kirjaaKayttoa(c: KpClient) {
  for (const [pvm, debet] of [
    ['2026-02-01', 1900],
    ['2026-03-10', 1900],
    ['2026-05-20', 4000],
  ] as const) {
    await c.luoTosite({
      pvm,
      tyyppi: 200,
      sarja: '',
      tila: 100,
      viennit: [vienti(debet, pvm, 10_000, 0), vienti(3000, pvm, 0, 10_000)],
    });
  }
}
