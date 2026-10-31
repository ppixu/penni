import { Kirjautuminen } from '@/auth/Kirjautuminen';
import { Rekisteroidy } from '@/auth/Rekisteroidy';
import { LAHDEKOODI_URL } from '@penni/contract';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Pilvessä kirjautumissivu näkyy ennen sovellusta: AGPL §13 -tarjous kirjautumattomallekin.
describe('LahdekoodiHuomautus kirjautumis- ja rekisteröintisivulla', () => {
  it('kirjautumissivu linkittää lähdekoodiin ja nimeää lisenssin', () => {
    render(<Kirjautuminen onKirjaudu={async () => {}} onVaihdaRekisterointiin={() => {}} />);
    expect(screen.getByRole('link', { name: 'Lähdekoodi' })).toHaveAttribute(
      'href',
      LAHDEKOODI_URL,
    );
    expect(screen.getByText(/AGPL-3\.0-or-later, ei takuuta/)).toBeInTheDocument();
  });

  it('rekisteröintisivu linkittää lähdekoodiin', () => {
    render(<Rekisteroidy onRekisteroi={async () => {}} onVaihdaKirjautumiseen={() => {}} />);
    expect(screen.getByRole('link', { name: 'Lähdekoodi' })).toHaveAttribute(
      'href',
      LAHDEKOODI_URL,
    );
  });
});
