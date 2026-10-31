import { type Cents, Euro } from '@penni/euro';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OmaVeroTayttoapu, kaudenTunnus } from './OmaVeroTayttoapu.js';

describe('kaudenTunnus', () => {
  it('kuukausi, neljännes ja vuosi', () => {
    expect(kaudenTunnus({ alkupvm: '2026-03-01', loppupvm: '2026-03-31' }, 1)).toBe('3/2026');
    expect(kaudenTunnus({ alkupvm: '2026-07-01', loppupvm: '2026-09-30' }, 3)).toBe('Q3/2026');
    expect(kaudenTunnus({ alkupvm: '2026-01-01', loppupvm: '2026-12-31' }, 12)).toBe('2026');
  });
});

describe('OmaVeroTayttoapu', () => {
  it('palautukseen oikeuttava vero näkyy etumerkillä ja vaatii tilityksen ennen ilmoittamista', () => {
    render(
      <OmaVeroTayttoapu
        kausi={{ alkupvm: '2026-03-01', loppupvm: '2026-03-31' }}
        kausiKk={1}
        laskelma={{
          koodit: new Map<number, Cents>([
            [307, Euro.fromCents(12_345)],
            [308, Euro.fromCents(-12_345)],
          ]),
          maksettava: Euro.fromCents(-12_345),
        }}
        erapvm="2026-05-12"
        ytunnus={undefined}
        ilmoitettu={false}
        auki
        onVaihda={() => {}}
      />,
    );
    const apu = screen.getByLabelText('omavero-tayttoapu');
    expect(apu).toHaveTextContent('3/2026, 1.3.–31.3.2026');
    expect(apu).toHaveTextContent('12.5.2026');
    expect(within(apu).getByText('Palautukseen oikeuttava vero').closest('tr')).toHaveTextContent(
      '-123,45',
    );
    expect(apu).toHaveTextContent('Tilitä kausi ennen ilmoittamista');
    expect(within(apu).getByRole('button', { name: 'Lataa Ilmoitin.fi-tiedosto' })).toBeDisabled();
  });
});
