import { renderReitittimessa } from '@/test/renderReitittimessa';
import { Link, useNavigate } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useMuutosseuranta } from './useMuutosseuranta.js';
import { useTallentamatonVaroitus } from './useTallentamatonVaroitus.js';

const identiteetti = (t: string) => t;

/** Pienin lomake: yksi tekstikenttä, linkki pois ja tallennus, joka navigoi heti. */
function TestiLomake({ getterilla = true }: { getterilla?: boolean }) {
  const [teksti, setTeksti] = useState('');
  const { likainen, onkoLikainen, asetaPohja } = useMuutosseuranta(teksti, identiteetti);
  const varoitus = useTallentamatonVaroitus(getterilla ? onkoLikainen : likainen);
  const navigate = useNavigate();

  async function tallenna() {
    await Promise.resolve(); // tallennus on asynkroninen kuten oikeassa lomakkeessa
    asetaPohja(teksti);
    void navigate({ to: '/tositteet' });
  }

  return (
    <>
      <input aria-label="Teksti" value={teksti} onChange={(e) => setTeksti(e.target.value)} />
      <Link to="/tositteet">Muualle</Link>
      <button type="button" onClick={() => void tallenna()}>
        Tallenna
      </button>
      {varoitus}
    </>
  );
}

describe('useTallentamatonVaroitus', () => {
  it('puhtaalta lomakkeelta navigoidaan ilman dialogia', async () => {
    const { user } = await renderReitittimessa(<TestiLomake />);
    await user.click(screen.getByRole('link', { name: 'Muualle' }));
    expect(await screen.findByText('Toinen sivu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('likaiselta lomakkeelta poistuminen näyttää dialogin; "Jää sivulle" pitää sivulla', async () => {
    const { user, router } = await renderReitittimessa(<TestiLomake />);
    await user.type(screen.getByLabelText('Teksti'), 'abc');
    await user.click(screen.getByRole('link', { name: 'Muualle' }));

    const dialogi = await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' });
    expect(dialogi).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jää sivulle' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByLabelText('Teksti')).toHaveValue('abc');
    expect(screen.queryByText('Toinen sivu')).not.toBeInTheDocument();
  });

  it('"Poistu tallentamatta" jatkaa navigointia', async () => {
    const { user, router } = await renderReitittimessa(<TestiLomake />);
    await user.type(screen.getByLabelText('Teksti'), 'abc');
    await user.click(screen.getByRole('link', { name: 'Muualle' }));
    await user.click(await screen.findByRole('button', { name: 'Poistu tallentamatta' }));

    expect(await screen.findByText('Toinen sivu')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/tositteet');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('käsin peruttu muokkaus ei varoita', async () => {
    const { user } = await renderReitittimessa(<TestiLomake />);
    const kentta = screen.getByLabelText('Teksti');
    await user.type(kentta, 'ab');
    await user.clear(kentta);
    await user.click(screen.getByRole('link', { name: 'Muualle' }));
    expect(await screen.findByText('Toinen sivu')).toBeInTheDocument();
  });

  it('tallennuksen jälkeinen välitön navigointi ei näytä dialogia', async () => {
    const { user } = await renderReitittimessa(<TestiLomake />);
    await user.type(screen.getByLabelText('Teksti'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Tallenna' }));
    expect(await screen.findByText('Toinen sivu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('toimii myös pelkällä boolean-arvolla', async () => {
    const { user } = await renderReitittimessa(<TestiLomake getterilla={false} />);
    await user.type(screen.getByLabelText('Teksti'), 'abc');
    await user.click(screen.getByRole('link', { name: 'Muualle' }));
    expect(
      await screen.findByRole('dialog', { name: 'Tallentamattomia muutoksia' }),
    ).toBeInTheDocument();
  });

  it('beforeunload estetään (preventDefault) vain likaisena', async () => {
    const { user } = await renderReitittimessa(<TestiLomake />);
    const puhdas = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(puhdas);
    expect(puhdas.defaultPrevented).toBe(false);

    await user.type(screen.getByLabelText('Teksti'), 'abc');
    const likainen = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(likainen);
    expect(likainen.defaultPrevented).toBe(true);
  });
});
