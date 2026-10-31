import { type Kuitti, lataaKartta } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { generoiTosite, kuittiTilitapahtumaksi } from './naytto.js';

const chart = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 1763, tyyppi: 'AL', nimi: { fi: 'ALV-saatava' } },
  { numero: 4010, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);

const kuitti = (yli: Partial<Kuitti> = {}): Kuitti => ({
  valuutta: 'EUR',
  alv: [],
  ...yli,
});

describe('kuittiTilitapahtumaksi', () => {
  it('rakentaa negatiivisen (meno) tapahtuman kuitin bruttosummasta', () => {
    const t = kuittiTilitapahtumaksi(
      kuitti({ myyja: 'Patreon', pvm: '2025-01-03', bruttoSumma: Euro.fromCents(1244) }),
    );
    expect(t.maara).toBe(Euro.fromCents(-1244));
    expect(t.pvm).toBe('2025-01-03');
    expect(t.nimi).toBe('Patreon');
  });
});

describe('generoiTosite', () => {
  it('tuottaa tasapainoisen luonnostositteen (menorivi + pankkirivi)', () => {
    const t = generoiTosite(
      kuitti({
        myyja: 'EA',
        pvm: '2025-01-03',
        bruttoSumma: Euro.fromCents(1644),
        alv: [{ kanta: 0, brutto: Euro.fromCents(1644) }],
      }),
      chart,
      { menotili: 4010, pankkitili: 1910, menotiliSaannot: [] },
    );
    const debet = t.viennit.reduce((s, v) => s + v.debet, 0);
    const kredit = t.viennit.reduce((s, v) => s + v.kredit, 0);
    expect(debet).toBe(kredit); // balanced
    expect(t.viennit.some((v) => v.tili === 4010 && v.debet === Euro.fromCents(1644))).toBe(true);
    expect(t.viennit.some((v) => v.tili === 1910 && v.kredit === Euro.fromCents(1644))).toBe(true);
  });
});
