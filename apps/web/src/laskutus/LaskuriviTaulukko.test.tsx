import { OSTOKOODIT } from '@/ostolaskut/ostolaskuReducer';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LaskuriviTaulukko } from './LaskuriviTaulukko.js';
import { alustaLaskuTila } from './laskuReducer.js';

describe('LaskuriviTaulukko koodit-propti', () => {
  it('tarjoaa annetut ALV-koodit (ostokoodit)', async () => {
    const user = userEvent.setup();
    const tila = alustaLaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    render(
      <LaskuriviTaulukko
        rivit={tila.rivit}
        pvm="2026-06-10"
        dispatch={() => {}}
        koodit={OSTOKOODIT}
      />,
    );
    await user.click(screen.getByLabelText('ALV, rivi 1'));
    expect(screen.getByText(/Verollinen osto/)).toBeTruthy();
  });

  it('ilman koodit-proppia käyttää myyntikoodeja (myyntikäyttö säilyy)', async () => {
    const user = userEvent.setup();
    const tila = alustaLaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    render(<LaskuriviTaulukko rivit={tila.rivit} pvm="2026-06-10" dispatch={() => {}} />);
    await user.click(screen.getByLabelText('ALV, rivi 1'));
    expect(screen.getByText(/Verollinen myynti/)).toBeTruthy();
    expect(screen.queryByText(/Verollinen osto/)).toBeNull();
  });
});
