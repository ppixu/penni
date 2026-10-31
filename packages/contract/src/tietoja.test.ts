import { describe, expect, it } from 'vitest';
import { LAHDEKOODI_URL, lahdekoodiTarjous } from './tietoja.js';

describe('lahdekoodiTarjous (AGPL §13)', () => {
  it('nimeää tekijän, lisenssin, takuuttomuuden ja Kitsas-alkuperän', () => {
    const teksti = lahdekoodiTarjous();
    expect(teksti).toContain('© 2026 Olli Pikkarainen');
    expect(teksti).toContain('AGPL-3.0-or-later');
    expect(teksti).toContain('TAKUUTA');
    expect(teksti).toContain('© Arto Hyvättinen ja Kitsas Oy');
    expect(teksti).toContain('GPL-3.0-or-later');
    expect(teksti).toContain(`Tämän palvelun lähdekoodi: ${LAHDEKOODI_URL}`);
  });

  it('osoittaa annettuun lähdekoodiin (muokatun version ylläpitäjän oma repo)', () => {
    const teksti = lahdekoodiTarjous('https://git.example.fi/oma-penni');
    expect(teksti).toContain('Tämän palvelun lähdekoodi: https://git.example.fi/oma-penni');
    expect(teksti).not.toContain(LAHDEKOODI_URL);
  });
});
