import type { CsvEsikatselu, CsvSarakkeet as CsvSarakejako } from '@penni/engine';
import { type Cents, muotoileEuro } from '@penni/euro';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CsvSarakkeet } from './CsvSarakkeet.js';

const ESIKATSELU: CsvEsikatselu = {
  otsikot: ['Päivä', 'Summa', 'Kuvaus', 'Saaja'],
  esimerkit: [
    ['2.10.2026', '-12,50', 'Kahvi lokakuu', 'Testi Oy'],
    ['5.10.2026', '100,00', 'Lasku 1001', 'Maija Malli'],
  ],
  avain: 'päivä|summa|kuvaus|saaja',
  ehdotus: { pvm: 0, pvmMuoto: 'd.m.yyyy', maara: 1, nimi: [3], viesti: [2] },
};

function piirra(alku: CsvSarakejako = ESIKATSELU.ehdotus) {
  const onVahvista = vi.fn();
  const onPeru = vi.fn();
  render(
    <CsvSarakkeet esikatselu={ESIKATSELU} alku={alku} onVahvista={onVahvista} onPeru={onPeru} />,
  );
  return { user: userEvent.setup(), onVahvista, onPeru };
}

describe('CsvSarakkeet', () => {
  it('esitäyttää roolit ehdotuksesta ja näyttää ensimmäisen rivin niin kuin Penni sen lukee', () => {
    piirra();
    expect(screen.getByRole('heading', { name: 'Mitä sarakkeet sisältävät?' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sarake Päivä' })).toHaveValue('pvm');
    expect(screen.getByRole('combobox', { name: 'Sarake Summa' })).toHaveValue('maara');
    expect(screen.getByRole('combobox', { name: 'Sarake Saaja' })).toHaveValue('nimi');

    const esikatselu = screen.getByRole('table', { name: 'Näin tiliote luetaan' });
    const [, ensimmainen] = within(esikatselu).getAllByRole('row');
    expect(ensimmainen).toHaveTextContent('2.10.2026');
    expect(ensimmainen).toHaveTextContent('Testi Oy');
    // toHaveTextContent normalisoi vastaanotetun tekstin välilyönnit (NBSP → välilyönti).
    expect(ensimmainen).toHaveTextContent(muotoileEuro(-1250 as Cents).replace(/\s/g, ' '));
  });

  it('päivittää esikatselun kun sarakkeen rooli vaihtuu', async () => {
    const { user } = piirra();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sarake Saaja' }), 'Ei käytetä');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sarake Kuvaus' }), 'Nimi');
    const esikatselu = screen.getByRole('table', { name: 'Näin tiliote luetaan' });
    const [, ensimmainen] = within(esikatselu).getAllByRole('row');
    expect(ensimmainen).toHaveTextContent('Kahvi lokakuu');
    expect(ensimmainen).not.toHaveTextContent('Testi Oy');
  });

  it('Lue tiliote on pois käytöstä ilman päivämääräsaraketta', async () => {
    const { user } = piirra();
    const nappi = screen.getByRole('button', { name: 'Lue tiliote' });
    expect(nappi).toBeEnabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sarake Päivä' }), 'Ei käytetä');
    expect(nappi).toBeDisabled();
  });

  it('vaatii summan tai sekä veloituksen että hyvityksen', async () => {
    const { user } = piirra();
    const nappi = screen.getByRole('button', { name: 'Lue tiliote' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sarake Summa' }),
      'Veloitus (ulos)',
    );
    expect(nappi).toBeDisabled();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sarake Kuvaus' }),
      'Hyvitys (sisään)',
    );
    expect(nappi).toBeEnabled();
  });

  it('yksi sarake kerrallaan voi olla päivämäärä: uusi valinta vapauttaa vanhan', async () => {
    const { user } = piirra();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sarake Kuvaus' }), 'Päivämäärä');
    expect(screen.getByRole('combobox', { name: 'Sarake Päivä' })).toHaveValue('ei');
  });

  it('vahvistaa valitun sarakejaon ja päivämuodon', async () => {
    const { user, onVahvista } = piirra();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sarake Kuvaus' }), 'Viite');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Päivämäärän muoto' }),
      '2026-12-31',
    );
    await user.click(screen.getByRole('button', { name: 'Lue tiliote' }));
    expect(onVahvista).toHaveBeenCalledWith({
      pvm: 0,
      pvmMuoto: 'yyyy-mm-dd',
      maara: 1,
      nimi: [3],
      viesti: [],
      viite: 2,
    });
  });

  it('kertoo esikatselussa jos rivejä ei voi lukea valitulla jaolla', async () => {
    const { user } = piirra();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Päivämäärän muoto' }),
      '2026-12-31',
    );
    expect(screen.getByText(/Virheellinen päivämäärä "2\.10\.2026"/)).toBeInTheDocument();
  });

  it('Peru kutsuu onPeru', async () => {
    const { user, onPeru, onVahvista } = piirra();
    await user.click(screen.getByRole('button', { name: 'Peru' }));
    expect(onPeru).toHaveBeenCalled();
    expect(onVahvista).not.toHaveBeenCalled();
  });
});
