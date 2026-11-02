import type { Cents } from '@penni/euro';
import { rfViite } from '@penni/validator';
import { describe, expect, it } from 'vitest';
import type { Vakioviite } from '../laskutus/vakioviite.js';
import type { Tilitapahtuma } from './poimiTiliote.js';
import { normalisoiViite, vakioviiteEhdotus } from './vakioviiteEhdotus.js';

const c = (n: number): Cents => n as Cents;
const JASENMAKSU: Vakioviite = { viite: '1012', tili: 3010, kohdennus: 2, otsikko: 'Jäsenmaksut' };
const tapahtuma = (maara: number, viite?: string): Tilitapahtuma => ({
  pvm: '2026-07-03',
  nimi: 'MATTI MEIKÄLÄINEN',
  maara: c(maara),
  ...(viite !== undefined ? { viite } : {}),
});

describe('normalisoiViite', () => {
  it('poistaa välilyönnit, RF-etuliitteen ja etunollat', () => {
    expect(normalisoiViite('1009')).toBe('1009');
    expect(normalisoiViite('00001009')).toBe('1009');
    expect(normalisoiViite('10 09')).toBe('1009');
    expect(normalisoiViite(rfViite('1009'))).toBe('1009');
    expect(normalisoiViite(rfViite('00001009'))).toBe('1009');
    expect(normalisoiViite(' ')).toBe('');
    expect(normalisoiViite('0000')).toBe('');
  });

  it('jättää virheellisen RF-viitteen sellaisenaan', () => {
    expect(normalisoiViite('RF99 1009')).toBe('RF991009');
  });
});

describe('vakioviiteEhdotus', () => {
  it('ehdottaa vakioviitteen tiliä ja kohdennusta saapuvalle maksulle', () => {
    expect(vakioviiteEhdotus(tapahtuma(5000, '1012'), [JASENMAKSU])).toEqual({
      tili: 3010,
      kohdennus: 2,
      otsikko: 'Jäsenmaksut',
      alvKoodi: 0,
      alvProsentti: 0,
      peruste: 'vakioviite',
    });
  });

  it('tunnistaa viitteen RF-muodossa ja etunollilla', () => {
    expect(vakioviiteEhdotus(tapahtuma(5000, rfViite('1012')), [JASENMAKSU])?.tili).toBe(3010);
    expect(vakioviiteEhdotus(tapahtuma(5000, '0001012'), [JASENMAKSU])?.tili).toBe(3010);
  });

  it('jättää kohdennuksen pois, jos vakioviitteellä ei ole sitä', () => {
    const e = vakioviiteEhdotus(tapahtuma(5000, '1012'), [
      { viite: '1012', tili: 3010, otsikko: 'X' },
    ]);
    expect(e).toBeDefined();
    expect('kohdennus' in (e ?? {})).toBe(false);
  });

  it('ei ehdota lähtevälle maksulle, tuntemattomalle viitteelle eikä ilman viitettä', () => {
    expect(vakioviiteEhdotus(tapahtuma(-5000, '1012'), [JASENMAKSU])).toBeUndefined();
    expect(vakioviiteEhdotus(tapahtuma(5000, '9999'), [JASENMAKSU])).toBeUndefined();
    expect(vakioviiteEhdotus(tapahtuma(5000), [JASENMAKSU])).toBeUndefined();
    expect(
      vakioviiteEhdotus(tapahtuma(5000, '0000'), [{ ...JASENMAKSU, viite: '0' }]),
    ).toBeUndefined();
  });
});
