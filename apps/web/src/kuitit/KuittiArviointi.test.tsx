import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KuittiArviointi } from './KuittiArviointi.js';
import type { Paattelija } from './paattely.js';

// pdf.js ei toimi jsdomissa (mm. puuttuva DOMMatrix) — mockataan pois, koska nämä testit
// kattavat vain kuvapolun. PDF-polkua ei voi RTL:llä testata tässä ympäristössä.
vi.mock('./pdf.js', () => ({
  luePdfTeksti: vi.fn().mockResolvedValue(''),
}));

function valePaattelija(vastaus: string): Paattelija {
  return {
    saatavilla: vi.fn().mockResolvedValue(true),
    lataa: vi.fn().mockResolvedValue(undefined),
    tulkitse: vi.fn().mockResolvedValue(vastaus),
    lataaTeksti: vi.fn().mockResolvedValue(undefined),
    tulkitseTeksti: vi.fn().mockResolvedValue(vastaus),
    sulje: vi.fn(),
  };
}

describe('KuittiArviointi', () => {
  it('lataa mallin, tulkitsee kuvan ja näyttää raakatulosteen, kentät ja täsmäytyksen', async () => {
    const kayttaja = userEvent.setup();
    const vastaus =
      '{"myyja":"K-Market","pvm":"2026-07-15","valuutta":"EUR","bruttoSumma":24.90,' +
      '"alv":[{"kanta":25.5,"netto":19.84,"vero":5.06,"brutto":24.90}]}';
    render(<KuittiArviointi paattelija={valePaattelija(vastaus)} />);

    await kayttaja.click(screen.getByRole('button', { name: /lataa malli/i }));

    const tiedosto = new File([new Uint8Array([1, 2, 3])], 'kuitti.png', { type: 'image/png' });
    await kayttaja.upload(screen.getByLabelText(/kuittikuva/i), tiedosto);

    const tulkitse = screen.getByRole('button', { name: /tulkitse/i });
    await waitFor(() => expect(tulkitse).toBeEnabled()); // malli ladattu (tila=valmis) JA kuva valittu
    await kayttaja.click(tulkitse);

    // Jäsennetyt kentät luetaan taulukosta (raaka JSON <pre>:ssä sisältää samat luvut).
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const taulu = within(screen.getByRole('table'));
    expect(taulu.getByText('K-Market')).toBeInTheDocument();
    expect(taulu.getByText('24.90')).toBeInTheDocument();
    expect(screen.getByText(/täsmää/i)).toBeInTheDocument();
    expect(screen.getByText(vastaus)).toBeInTheDocument(); // koko JSON vain <pre>:ssä
  });

  it('näyttää WebGPU-varoituksen kun malli ei ole saatavilla', async () => {
    const kayttaja = userEvent.setup();
    const p = valePaattelija('');
    p.saatavilla = vi.fn().mockResolvedValue(false);
    render(<KuittiArviointi paattelija={p} />);
    await kayttaja.click(screen.getByRole('button', { name: /lataa malli/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/webgpu/i));
  });

  it('näyttää virheen ja sallii uuden yrityksen kun mallin lataus epäonnistuu', async () => {
    const kayttaja = userEvent.setup();
    const p = valePaattelija('');
    p.saatavilla = vi.fn().mockResolvedValue(true);
    p.lataa = vi.fn().mockRejectedValue(new Error('verkkovirhe'));
    render(<KuittiArviointi paattelija={p} />);

    const lataaNappi = screen.getByRole('button', { name: /lataa malli/i });
    await kayttaja.click(lataaNappi);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/lataus epäonnistui/i));
    await waitFor(() => expect(lataaNappi).toBeEnabled());
  });
});
