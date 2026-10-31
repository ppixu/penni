import { type StoredTosite, lataaKartta } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { oletusPankkitili } from './oletusPankkitili.js';

const CHART = lataaKartta([
  { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Käyttötili' } },
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Säästötili' } },
  { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);

function tosite(id: number, pankki: number): StoredTosite {
  const summa = Euro.fromCents(100);
  const nolla = Euro.fromCents(0);
  return {
    id,
    pvm: '2026-03-01',
    tyyppi: 100,
    tila: 100,
    tunniste: id,
    sarja: '',
    viennit: [
      { tili: 4000, debet: summa, kredit: nolla, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
      {
        tili: pankki,
        debet: nolla,
        kredit: summa,
        pvm: '2026-03-01',
        alvKoodi: 0,
        alvProsentti: 0,
      },
    ],
  };
}

describe('oletusPankkitili', () => {
  it('ilman historiaa: tilikartan ensimmäinen pankkitili', () => {
    expect(oletusPankkitili(CHART, [])).toBe(1900);
  });

  it('usean pankkitilin kirjassa: historiassa eniten käytetty', () => {
    expect(oletusPankkitili(CHART, [tosite(1, 1910), tosite(2, 1910), tosite(3, 1900)])).toBe(1910);
  });

  it('ei pankkitiliä kartassa: undefined', () => {
    expect(oletusPankkitili(lataaKartta([{ numero: 4000, tyyppi: 'D' }]), [])).toBeUndefined();
  });
});
