import { renderRoute } from '@/test/renderRoute';
import { LAHDEKOODI_URL } from '@penni/contract';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { version } from '../../package.json';

const SEED = { asetukset: { Nimi: 'Demo Oy' } };

describe('Tietoja-näkymä', () => {
  it('näyttää version, beta-tilan, tekijänoikeuden ja AGPL-takuuttomuuden', async () => {
    await renderRoute('/tietoja', { seed: SEED });
    const sivu = await screen.findByLabelText('tietoja');
    expect(within(sivu).getByText(`Versio ${version}`)).toBeInTheDocument();
    expect(within(sivu).getByText('beta')).toBeInTheDocument();
    expect(within(sivu).getByRole('heading', { name: 'Beta-versio' })).toBeInTheDocument();
    expect(within(sivu).getByText('© 2026 Olli Pikkarainen')).toBeInTheDocument();
    expect(sivu).toHaveTextContent('(AGPL-3.0-or-later)');
    expect(sivu).toHaveTextContent('ilman minkäänlaista takuuta');
    expect(
      within(sivu).getByRole('link', { name: 'GNU Affero General Public License' }),
    ).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');
  });

  it('linkittää lähdekoodiin ja nimeää Kitsaan tekijät ja lisenssin', async () => {
    await renderRoute('/tietoja', { seed: SEED });
    const sivu = await screen.findByLabelText('tietoja');
    const lahdekoodi = within(sivu).getByRole('link', { name: LAHDEKOODI_URL });
    expect(lahdekoodi).toHaveAttribute('href', LAHDEKOODI_URL);
    // Ei target="_blank": työpöytäsovellus estää uudet ikkunat (vain will-navigate avaa selaimen).
    expect(lahdekoodi).not.toHaveAttribute('target');
    expect(sivu).toHaveTextContent('© Arto Hyvättinen ja Kitsas Oy, lisenssi GPL-3.0-or-later');
    expect(sivu).toHaveTextContent('Kitsas Oy ei ole Pennin tekijä eikä tue sitä');
    expect(within(sivu).getByRole('link', { name: 'Kitsas-kirjanpito-ohjelmaan' })).toHaveAttribute(
      'href',
      'https://github.com/artoh/kitupiikki',
    );
  });

  it('avautuu Asetuksista', async () => {
    const { user, router } = await renderRoute('/asetukset', { seed: SEED });
    const sivu = await screen.findByLabelText('asetukset');
    await user.click(within(sivu).getByRole('link', { name: 'Tietoja Pennistä' }));
    expect(await screen.findByLabelText('tietoja')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/tietoja');
  });
});
