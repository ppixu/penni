import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { type Tili, lataaKartta } from '../accounts/tili.js';
import { AlvKoodi } from '../alv/koodit.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import { riviTositteeksi } from './riviTositteeksi.js';
import type { TyolistaRivi } from './tyolista.js';

// lataaKartta resolves `tyyppi` (e.g. 'AL', 'BL') into the `luonne` bitmask that
// tiliTyypilla actually matches on; a plain literal cast to Tili[] has no `luonne`
// and silently fails every account-by-nature lookup (see accounts/tili.ts).
const CHART: Tili[] = lataaKartta([
  { numero: 1910, nimi: 'Pankkitili', tyyppi: 'ARP' },
  { numero: 7690, nimi: 'Atk-palvelut', tyyppi: 'D' },
  { numero: 2939, nimi: 'Alv-velka', tyyppi: 'BL' },
  { numero: 1763, nimi: 'Alv-saatava', tyyppi: 'AL' },
]);

// Cents on brändätty tyyppi (@penni/euro); testien literaalit tarvitsevat pienen castin.
const c = (n: number): Cents => n as Cents;

const rivi = (yli: Partial<TyolistaRivi>): TyolistaRivi =>
  ({
    avain: 'a',
    tapahtuma: { pvm: '2026-06-02', nimi: 'K-MARKET', maara: -1240 },
    tila: 'kuittiPuuttuu',
    valittu: true,
    ...yli,
  }) as TyolistaRivi;

describe('riviTositteeksi', () => {
  it('kirjaa kuitittoman rivin luonnokseksi ilman alv-vähennystä', () => {
    const tosite = riviTositteeksi(rivi({}), CHART, { pankkitili: 1910, menotili: 7690 });
    expect(tosite.tila).toBe(TositeTila.LUONNOS);
    expect(tosite.tyyppi).toBe(TositeTyyppi.MENO);
    expect(tosite.otsikko).toBe('K-MARKET');
    // Kaksi vientiä: kulu brutto + pankki. Ei alv-vientiä.
    expect(tosite.viennit).toHaveLength(2);
    expect(tosite.viennit.some((v) => v.tili === 1763 || v.tili === 2939)).toBe(false);
    expect(tosite.viennit.find((v) => v.tili === 7690)?.debet).toBe(1240);
    expect(tosite.viennit.find((v) => v.tili === 1910)?.kredit).toBe(1240);
  });

  it('käyttää käyttäjän valitsemaa tiliä kun se on asetettu', () => {
    const tosite = riviTositteeksi(rivi({ tili: 7660 }), CHART, {
      pankkitili: 1910,
      menotili: 7690,
    });
    expect(tosite.viennit.some((v) => v.tili === 7660)).toBe(true);
  });

  it('purkaa kuitin alv-erittelyn omiksi vienneikseen', () => {
    const tosite = riviTositteeksi(
      rivi({
        tila: 'valmis',
        tapahtuma: { pvm: '2026-04-04', nimi: 'PILVIPALVELU', maara: c(-2000) },
        kuitti: {
          tiedosto: '/a/pilvipalvelu.pdf',
          kuitti: {
            valuutta: 'EUR',
            myyja: 'Pilvipalvelu Ltd',
            alv: [{ kanta: 25.5, brutto: c(2000) }],
          },
        },
      }),
      CHART,
      { pankkitili: 1910, menotili: 7690 },
    );
    expect(tosite.otsikko).toBe('Pilvipalvelu Ltd');
    expect(tosite.viennit.some((v) => v.tili === 1763 && v.debet > 0)).toBe(true);
  });

  it('kirjaa kuitittoman rivin historian ehdotuksen alv:llä ja otsikolla', () => {
    const tosite = riviTositteeksi(
      rivi({
        tili: 7690,
        ehdotus: {
          tili: 7690,
          alvKoodi: AlvKoodi.OSTOT_NETTO,
          alvProsentti: 25.5,
          otsikko: 'K-Market kesäkuu',
          peruste: 'pankkinimi',
        },
      }),
      CHART,
      { pankkitili: 1910 },
    );
    expect(tosite.otsikko).toBe('K-Market kesäkuu');
    expect(tosite.viennit.find((v) => v.tili === 1910)?.kredit).toBe(1240);
    // 12,40 sis. alv 25,5 %: veroton 9,88 + alv 2,52.
    expect(tosite.viennit.find((v) => v.tili === 7690)?.debet).toBe(988);
    expect(tosite.viennit.find((v) => v.tili === 1763)?.debet).toBe(252);
  });

  it('ehdotuksen kumppani siirtyy tositteelle, vaihdettu tili ohittaa senkin', () => {
    const ehdotus = {
      tili: 7690,
      alvKoodi: 0,
      alvProsentti: 0,
      kumppani: 3,
      peruste: 'pankkinimi' as const,
    };
    const ehdotettu = riviTositteeksi(rivi({ tili: 7690, ehdotus }), CHART, { pankkitili: 1910 });
    expect(ehdotettu.kumppani).toBe(3);
    const vaihdettu = riviTositteeksi(rivi({ tili: 7660, ehdotus }), CHART, { pankkitili: 1910 });
    expect(vaihdettu).not.toHaveProperty('kumppani');
  });

  it('ohittaa ehdotuksen kun käyttäjä on vaihtanut tilin', () => {
    const tosite = riviTositteeksi(
      rivi({
        tili: 7660,
        ehdotus: {
          tili: 7690,
          alvKoodi: AlvKoodi.OSTOT_NETTO,
          alvProsentti: 25.5,
          peruste: 'nimi',
        },
      }),
      CHART,
      { pankkitili: 1910 },
    );
    expect(tosite.otsikko).toBe('K-MARKET');
    expect(tosite.viennit).toHaveLength(2);
    expect(tosite.viennit.find((v) => v.tili === 7660)?.debet).toBe(1240);
  });
});
