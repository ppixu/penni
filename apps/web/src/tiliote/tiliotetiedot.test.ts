import { alustaTila } from '@/editori/reducer';
import { TositeTyyppi } from '@penni/engine';
import type { Cents } from '@penni/euro';
import { describe, expect, it, vi } from 'vitest';
import {
  lueTiliotePdf,
  lueTositteenTiliote,
  poimiIban,
  tilioteTaytto,
  tilioteTiedoiksi,
  tiliotteenOtsikko,
} from './tiliotetiedot.js';

const c = (n: number) => n as Cents;

/** Keksitty kuukausitiliote pdf.js-poiminnan muodossa (vrt. moottorin poimiKuukausitiliote.test). */
const TEKSTI = [
  'Tiliote',
  'ESIMERKKI TMI',
  'Tilinumero FI00 1234 5600 0000 00',
  'Kausi: 01.07.2026 - 31.07.2026',
  'Kirjauspäivä Arvopäivä Saaja/Maksaja Määrä Saldo',
  '30.06.2026 Saldo 2 000,00',
  '03.07 03.07 ASIAKAS OY 1 240,00 3 240,00',
  '31.07.2026 Saldo 3 240,00',
].join('\n');

describe('tiliotteen tiedot', () => {
  it('poimii IBANin välilyönnit poistettuina', () => {
    expect(poimiIban('Tilinumero FI00 1234 5600 0000 00 BIC')).toBe('FI0012345600000000');
    expect(poimiIban('ei tiliä')).toBeUndefined();
  });

  it('lukee kuukausitiliotteen PDF:n tekstistä; muu tiedosto on null', async () => {
    const luettu = await lueTiliotePdf(new Blob(), async () => TEKSTI);
    expect(luettu?.tiliote.kausi).toEqual({ alkaa: '2026-07-01', loppuu: '2026-07-31' });
    expect(luettu?.tiliote.alkusaldo).toBe(200_000);
    expect(luettu?.tiliote.loppusaldo).toBe(324_000);
    expect(luettu?.iban).toBe('FI0012345600000000');
    expect(await lueTiliotePdf(new Blob(), async () => 'Kuitti\nYhteensä 12,00 €')).toBeNull();
  });

  it('tiedoiksi ja otsikoksi', () => {
    const t = tilioteTiedoiksi(
      { kausi: { alkaa: '2026-09-01', loppuu: '2026-09-30' }, loppusaldo: c(603_176) },
      1910,
    );
    expect(t).toEqual({
      tili: 1910,
      alkupvm: '2026-09-01',
      loppupvm: '2026-09-30',
      loppusaldo: 603_176,
    });
    expect(tiliotteenOtsikko({ alkupvm: '2026-09-01', loppupvm: '2026-09-30' })).toBe(
      'Tiliote 9/2026',
    );
    expect(tiliotteenOtsikko({ alkupvm: '2026-09-01', loppupvm: '2026-09-15' })).toBe(
      'Tiliote 1.9.2026–15.9.2026',
    );
    expect(tilioteTiedoiksi({}, 1910)).toBeNull();
  });

  it('täyttö tekee lomakkeesta Tiliote-tositteen eikä korvaa käyttäjän selitettä', () => {
    const tiedot = { tili: 1910, alkupvm: '2026-09-01', loppupvm: '2026-09-30' };
    const tyhja = alustaTila({ paiva: '2026-10-25' });
    const { tila } = tilioteTaytto(tiedot, tyhja);
    expect(tila).toMatchObject({
      tyyppi: TositeTyyppi.TILIOTE,
      paiva: '2026-09-30',
      selite: 'Tiliote 9/2026',
      tiliote: tiedot,
    });
    expect(tilioteTaytto(tiedot, { ...tyhja, selite: 'Oma' }).tila.selite).toBe('Oma');
  });

  it('tositteen liite: ilman PDF:ää syy, ei pankkitiliä syy', async () => {
    const client = { haeLiitteet: vi.fn(async () => []), haeLiite: vi.fn() };
    expect(await lueTositteenTiliote(client, 1, 1910)).toBe('Tositteella ei ole PDF-liitettä.');
    expect(await lueTositteenTiliote(client, 1, undefined)).toBe(
      'Kirjanpidossa ei ole pankkitiliä.',
    );
  });
});
