import { AlvKoodi } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { alustaOstolaskuTila } from './ostolaskuReducer.js';
import { rakennaOstolaskuSyote } from './rakennaOstolaskuSyote.js';

function tilaRivilla() {
  const tila = alustaOstolaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
  tila.viite = 'RF4912345';
  const rivi = tila.rivit[0];
  if (rivi) {
    tila.rivit[0] = {
      ...rivi,
      selite: 'Toimistotarvikkeet',
      aNettoSnt: Euro.fromCents(10000),
      alvKoodi: AlvKoodi.OSTOT_NETTO,
      alvProsentti: 25.5,
    };
  }
  return tila;
}

describe('rakennaOstolaskuSyote', () => {
  it('muuntaa sentit euroiksi rivin aNetto-kentässä ja asettaa pvm + laskupvm', () => {
    const syote = rakennaOstolaskuSyote(tilaRivilla());
    expect(syote.pvm).toBe('2026-06-10');
    expect(syote.laskupvm).toBe('2026-06-10');
    expect(syote.erapvm).toBe('2026-06-24');
    expect(syote.viite).toBe('RF4912345');
    expect(syote.rivit).toHaveLength(1);
    expect(syote.rivit[0]?.aNetto).toBe(100); // 10000 snt → 100 €
    expect(syote.rivit[0]?.alvKoodi).toBe(AlvKoodi.OSTOT_NETTO);
  });

  it('pudottaa nollasummaiset rivit ja jättää tyhjän viitteen/kumppanin pois', () => {
    const tila = alustaOstolaskuTila({ laskupvm: '2026-06-10', alvVelvollinen: true });
    // viite tyhjä, kumppania ei aseteta, ainoa rivi nollasumma
    const syote = rakennaOstolaskuSyote(tila);
    expect(syote.rivit).toHaveLength(0);
    expect('viite' in syote).toBe(false);
    expect('kumppani' in syote).toBe(false);
  });
});
