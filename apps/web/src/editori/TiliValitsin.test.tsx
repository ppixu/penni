import { TiliValintaKonteksti } from '@/tilikartta/TiliValinta';
import { lataaKartta } from '@penni/engine';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TiliValitsin } from './TiliValitsin.js';

const CHART = lataaKartta([
  { numero: 7800, tyyppi: 'D', nimi: { fi: 'Toimistotarvikkeet' } },
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 1, tyyppi: 'H1', nimi: { fi: 'VASTAAVAA' } }, // heading: must NOT be selectable
]);

describe('TiliValitsin', () => {
  it('filters by name and selects the top match on Enter', async () => {
    const user = userEvent.setup();
    const onValitse = vi.fn();
    render(<TiliValitsin tilit={CHART} ariaLabel="Tili, rivi 1" onValitse={onValitse} />);
    const input = screen.getByRole('combobox', { name: 'Tili, rivi 1' });
    await user.click(input);
    await user.type(input, 'pank'); // filter by NAME
    expect(screen.getByText(/Pankkitili/)).toBeVisible();
    expect(screen.queryByText(/Toimistotarvikkeet/)).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onValitse).toHaveBeenCalledWith(1900);
  });

  it('filters by account number too', async () => {
    const user = userEvent.setup();
    const onValitse = vi.fn();
    render(<TiliValitsin tilit={CHART} ariaLabel="Tili, rivi 1" onValitse={onValitse} />);
    const input = screen.getByRole('combobox', { name: 'Tili, rivi 1' });
    await user.click(input);
    await user.type(input, '7800'); // filter by NUMBER
    expect(screen.getByText(/Toimistotarvikkeet/)).toBeVisible();
    await user.keyboard('{Enter}');
    expect(onValitse).toHaveBeenCalledWith(7800);
  });

  it('hiiriklikkaus listan riviin valitsee sen (regressio: onBlur ei saa sulkea listaa ennen klikkausta)', async () => {
    const user = userEvent.setup();
    const onValitse = vi.fn();
    render(<TiliValitsin tilit={CHART} ariaLabel="Tili, rivi 1" onValitse={onValitse} />);
    const input = screen.getByRole('combobox', { name: 'Tili, rivi 1' });
    await user.click(input);
    await user.click(screen.getByText(/Pankkitili/));
    expect(onValitse).toHaveBeenCalledWith(1900);
  });

  it('never offers heading accounts', async () => {
    const user = userEvent.setup();
    render(<TiliValitsin tilit={CHART} ariaLabel="Tili, rivi 1" onValitse={() => {}} />);
    const input = screen.getByRole('combobox', { name: 'Tili, rivi 1' });
    await user.click(input);
    await user.type(input, 'VASTAAVAA');
    expect(screen.queryByText('VASTAAVAA')).not.toBeInTheDocument();
  });
  it('fokusoitaessa kirjoitus korvaa valitun tilin (ei jatka sen nimeä)', async () => {
    const user = userEvent.setup();
    const onValitse = vi.fn();
    render(
      <TiliValitsin tilit={CHART} arvo={7800} ariaLabel="Tili, rivi 1" onValitse={onValitse} />,
    );
    const input = screen.getByRole('combobox', { name: 'Tili, rivi 1' });
    expect(input).toHaveValue('7800 Toimistotarvikkeet');
    await user.click(input);
    await user.keyboard('1900{Enter}');
    expect(onValitse).toHaveBeenCalledWith(1900);
  });

  it('seuraa ulkoa vaihtuvaa arvoa ilman remountia ja palauttaa keskeneräisen haun blurissa', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TiliValitsin tilit={CHART} arvo={7800} ariaLabel="Tili, rivi 1" onValitse={() => {}} />,
    );
    const input = screen.getByRole('combobox', { name: 'Tili, rivi 1' });
    rerender(
      <TiliValitsin tilit={CHART} arvo={1900} ariaLabel="Tili, rivi 1" onValitse={() => {}} />,
    );
    expect(screen.getByRole('combobox', { name: 'Tili, rivi 1' })).toBe(input);
    expect(input).toHaveValue('1900 Pankkitili');
    await user.click(input);
    await user.keyboard('toim');
    await user.tab();
    expect(input).toHaveValue('1900 Pankkitili');
  });

  it('piilotettu tili ei näy listalla, ellei se ole jo valittuna', async () => {
    const user = userEvent.setup();
    const piilotetut = new Set([7800]);
    const { unmount } = render(
      <TiliValitsin tilit={CHART} piilotetut={piilotetut} ariaLabel="Tili" onValitse={vi.fn()} />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Tili' }));
    expect(screen.getByText(/Pankkitili/)).toBeVisible();
    expect(screen.queryByText(/Toimistotarvikkeet/)).not.toBeInTheDocument();
    unmount();

    render(
      <TiliValitsin
        tilit={CHART}
        piilotetut={piilotetut}
        arvo={7800}
        ariaLabel="Tili"
        onValitse={vi.fn()}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Tili' });
    expect(input).toHaveValue('7800 Toimistotarvikkeet');
    await user.click(input);
    expect(screen.getByRole('option', { name: /Toimistotarvikkeet/ })).toBeInTheDocument();
  });

  describe('välilehdet: suosikit, viimeksi käytetyt, kaikki', () => {
    const KARTTA = lataaKartta([
      { numero: 7800, tyyppi: 'D', nimi: { fi: 'Toimistotarvikkeet' } },
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    ]);
    const valinta = {
      suosikit: new Set([7800]),
      kaytto: new Map([[1900, { viimeksi: '2026-09-01', maara: 3 }]]),
    };
    const avaa = async () => {
      const user = userEvent.setup();
      const onValitse = vi.fn();
      render(
        <TiliValintaKonteksti.Provider value={valinta}>
          <TiliValitsin tilit={KARTTA} ariaLabel="Tili, rivi 1" onValitse={onValitse} />
        </TiliValintaKonteksti.Provider>,
      );
      await user.click(screen.getByRole('combobox', { name: 'Tili, rivi 1' }));
      return { user, onValitse };
    };
    const tilit = () => screen.getAllByRole('option').map((o) => o.textContent);

    it('avautuu suosikkeihin ja vaihtaa välilehteä klikkaamalla', async () => {
      const { user } = await avaa();
      expect(screen.getByRole('tab', { name: 'Suosikit' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(tilit()).toEqual(['7800Toimistotarvikkeet']);

      await user.click(screen.getByRole('tab', { name: 'Viimeksi käytetyt' }));
      expect(tilit()).toEqual(['1900Pankkitili']);
      // Fokus pysyy kentässä, joten näppäimistöllä voi jatkaa.
      expect(screen.getByRole('combobox', { name: 'Tili, rivi 1' })).toHaveFocus();

      await user.click(screen.getByRole('tab', { name: 'Kaikki' }));
      expect(tilit()).toEqual(['1900Pankkitili', '4000Ostot', '7800Toimistotarvikkeet']);
    });

    it('kirjoitettu haku etsii kaikista tileistä numerolla ja nimellä', async () => {
      const { user, onValitse } = await avaa();
      await user.keyboard('ost');
      expect(tilit()).toEqual(['4000Ostot']);
      await user.keyboard('{Enter}');
      expect(onValitse).toHaveBeenCalledWith(4000);
    });

    it('ilman suosikkeja ja käyttöä näytetään kaikki ilman välilehtiä', async () => {
      const user = userEvent.setup();
      render(<TiliValitsin tilit={KARTTA} ariaLabel="Tili, rivi 1" onValitse={vi.fn()} />);
      await user.click(screen.getByRole('combobox', { name: 'Tili, rivi 1' }));
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(tilit()).toHaveLength(3);
    });
  });
});
