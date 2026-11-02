import type { Kumppani } from '@penni/engine';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { VastaanottajaLista, lisaaVastaanottajat } from './VastaanottajaLista.js';

const KUMPPANIT: Kumppani[] = [
  { id: 1, nimi: 'Maija Oy' },
  { id: 2, nimi: 'Pekka Ky' },
  { id: 3, nimi: 'Maisa Tmi' },
];

function Kaare({ alku = [] }: { alku?: number[] }) {
  const [valitut, setValitut] = useState<number[]>(alku);
  return <VastaanottajaLista kumppanit={KUMPPANIT} valitut={valitut} onMuutos={setValitut} />;
}

const valitut = () => within(screen.getByRole('list', { name: 'Vastaanottajat' }));

describe('lisaaVastaanottajat', () => {
  it('ohittaa kaksoiskappaleet ja säilyttää järjestyksen', () => {
    expect(lisaaVastaanottajat([2], [1, 2, 1, 3])).toEqual([2, 1, 3]);
  });
});

describe('VastaanottajaLista', () => {
  it('haku suodattaa ehdokkaat', async () => {
    const user = userEvent.setup();
    render(<Kaare />);
    expect(screen.getByRole('button', { name: 'Lisää Pekka Ky' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Hae asiakasta' }), 'mai');
    expect(screen.getByRole('button', { name: 'Lisää Maija Oy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lisää Maisa Tmi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lisää Pekka Ky' })).not.toBeInTheDocument();
  });

  it('klikkaus lisää vastaanottajan ja Poista poistaa', async () => {
    const user = userEvent.setup();
    render(<Kaare />);
    await user.click(screen.getByRole('button', { name: 'Lisää Pekka Ky' }));
    expect(valitut().getByText('Pekka Ky')).toBeInTheDocument();
    // Lisätty asiakas poistuu ehdokkaista.
    expect(screen.queryByRole('button', { name: 'Lisää Pekka Ky' })).not.toBeInTheDocument();
    expect(screen.getByText('1 vastaanottaja')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Poista Pekka Ky' }));
    expect(screen.queryByRole('list', { name: 'Vastaanottajat' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lisää Pekka Ky' })).toBeInTheDocument();
  });

  it('Lisää kaikki lisää suodatetun joukon eikä tuplaa jo lisättyjä', async () => {
    const user = userEvent.setup();
    render(<Kaare alku={[1]} />);
    await user.type(screen.getByRole('searchbox', { name: 'Hae asiakasta' }), 'mai');
    await user.click(screen.getByRole('button', { name: 'Lisää kaikki' }));
    const rivit = valitut().getAllByRole('listitem');
    expect(rivit.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Maija Oy'),
      expect.stringContaining('Maisa Tmi'),
    ]);
    expect(screen.getByText('2 vastaanottajaa')).toBeInTheDocument();
    // Pekka ei kuulunut suodatukseen.
    await user.clear(screen.getByRole('searchbox', { name: 'Hae asiakasta' }));
    expect(screen.getByRole('button', { name: 'Lisää Pekka Ky' })).toBeInTheDocument();
    // Ei ehdokkaita jäljellä suodatuksella → Lisää kaikki pois käytöstä.
    await user.type(screen.getByRole('searchbox', { name: 'Hae asiakasta' }), 'mai');
    expect(screen.getByRole('button', { name: 'Lisää kaikki' })).toBeDisabled();
  });

  it('ei näytä kielisaraketta', () => {
    render(<Kaare alku={[1]} />);
    expect(screen.queryByText(/kieli/i)).not.toBeInTheDocument();
  });
});
