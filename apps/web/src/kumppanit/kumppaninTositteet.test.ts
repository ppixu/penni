import type { Kumppani, ListattuTosite } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { kumppaneidenTilastot, liitettavatTositteet } from './kumppaninTositteet.js';

const KUMPPANIT: Kumppani[] = [
  { id: 3, nimi: 'Github' },
  { id: 8, nimi: 'Adobe' },
];

let seuraava = 1;
function tosite(pvm: string, snt: number, extra: Partial<ListattuTosite> = {}): ListattuTosite {
  const v = (tili: number, debet: number, kredit: number) => ({
    tili,
    debet: Euro.fromCents(debet),
    kredit: Euro.fromCents(kredit),
    pvm,
    alvKoodi: 0,
    alvProsentti: 0,
  });
  return {
    id: seuraava++,
    pvm,
    tyyppi: 100,
    tila: 100,
    tunniste: 1,
    sarja: '',
    liitteita: 0,
    viennit: [v(7661, snt, 0), v(1910, 0, snt)],
    ...extra,
  };
}

const KAUSI = { alkaa: '2026-01-01', loppuu: '2026-12-31' };

describe('kumppaneidenTilastot', () => {
  it('laskee kauden ja kaikkien tositteiden määrän ja summan, myös otsikosta tunnistetut', () => {
    const tilastot = kumppaneidenTilastot(
      [
        tosite('2025-12-16', 500, { kumppani: 3 }),
        tosite('2026-06-16', 564, { kumppani: 3 }),
        tosite('2026-07-16', 564, { otsikko: 'GitHub' }),
        tosite('2026-07-20', 1000, { otsikko: 'Kahvila' }),
      ],
      KUMPPANIT,
      KAUSI,
    );
    expect(tilastot.get(3)).toEqual({
      kausi: { kpl: 2, summa: 1128 },
      kaikki: { kpl: 3, summa: 1628 },
    });
    expect(tilastot.has(8)).toBe(false);
  });
});

describe('liitettavatTositteet', () => {
  it('poimii vain kumppanittomat, tunnistetut ja lukitsemattomat', () => {
    const lukittu = tosite('2025-12-16', 500, { otsikko: 'Github' });
    const avoin = tosite('2026-07-16', 564, { otsikko: 'GitHub' });
    const liitetty = tosite('2026-07-17', 564, { otsikko: 'GitHub', kumppani: 3 });
    const tuntematon = tosite('2026-07-18', 100, { otsikko: 'Kahvila' });
    const liitokset = liitettavatTositteet(
      [lukittu, avoin, liitetty, tuntematon],
      KUMPPANIT,
      '2025-12-31',
    );
    expect(liitokset).toEqual([{ tosite: avoin, kumppani: 3 }]);
  });
});
