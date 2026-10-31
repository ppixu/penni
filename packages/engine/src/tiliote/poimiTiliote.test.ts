import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { poimiTiliote } from './poimiTiliote.js';

describe('poimiTiliote', () => {
  // Nordea "Tapahtumat"-viennin litteä teksti (pdf.js).
  const TILIOTE = [
    'Tapahtumat 1.4.2026–22.6.2026',
    'Päivämäärä   Nimi   Viitenumero   Määrä',
    'Kesäk. 2026',
    '22.6.2026   MEIKÄLÄINEN MATTI   -5 000,00',
    '22.6.2026   Revontuli Oy   412000012   12 480,50',
    '16.6.2026   GITHUB, INC.   260612100247   -6,12',
    '1.6.2026   ESIMERKKI.AI SUBSCRIPTION   260528100319   -18,00',
    'Nostot (20):   -31 540,75',
    'Sivu 1 / 1',
  ].join('\n');

  it('poimii vain tapahtumarivit ja ohittaa otsikot/yhteenvedot', () => {
    expect(poimiTiliote(TILIOTE)).toHaveLength(4);
  });

  it('lukee päivän, nimen, viitteen ja etumerkillisen määrän', () => {
    const t = poimiTiliote(TILIOTE);
    expect(t[1]).toEqual({
      pvm: '2026-06-22',
      nimi: 'Revontuli Oy',
      viite: '412000012',
      maara: Euro.fromString('12480.50'),
    });
    expect(t[2]).toEqual({
      pvm: '2026-06-16',
      nimi: 'GITHUB, INC.',
      viite: '260612100247',
      maara: Euro.fromString('-6.12'),
    });
  });

  it('jättää viitteen pois kun sitä ei ole (yksityisnosto)', () => {
    const t = poimiTiliote(TILIOTE);
    expect(t[0]).toEqual({
      pvm: '2026-06-22',
      nimi: 'MEIKÄLÄINEN MATTI',
      maara: Euro.fromString('-5000.00'),
    });
  });

  it('erottaa RF-viitteen (verohallinto)', () => {
    const t = poimiTiliote('28.5.2026   VEROHALLINTO   RF094120000123   -923,18');
    expect(t[0]?.viite).toBe('RF094120000123');
    expect(t[0]?.nimi).toBe('VEROHALLINTO');
    expect(t[0]?.maara).toBe(Euro.fromString('-923.18'));
  });
});
