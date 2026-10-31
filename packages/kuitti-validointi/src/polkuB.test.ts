import { type Kuitti, type TasmaysRaportti, type Tilitapahtuma, lataaKartta } from '@penni/engine';
import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { ajaPolkuB, rakennaKuittilahteet, tilioteDiagnostiikka } from './polkuB.js';
import { kylmaAsetukset } from './seed.js';
import type { Totuus } from './totuus.js';

const chart = lataaKartta([
  { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
  { numero: 4010, tyyppi: 'D', nimi: { fi: 'Ostot' } },
]);
const kuitti = (yli: Partial<Kuitti> = {}): Kuitti => ({ valuutta: 'EUR', alv: [], ...yli });
const totuus = (id: number, pvm: string, myyja: string, brutto: number): Totuus => ({
  tositeId: id,
  pvm,
  myyja,
  brutto,
  alvYhteensa: 0,
  menot: [{ tili: 4010, netto: brutto, alvKoodi: 0, alvProsentti: 0 }],
});
const tapahtuma = (pvm: string, nimi: string, maara: number): Tilitapahtuma => ({
  pvm: pvm as Tilitapahtuma['pvm'],
  nimi,
  maara: Euro.fromCents(maara),
});

describe('rakennaKuittilahteet', () => {
  it('koodaa tositeId:n tiedostoon ja rakentaa käänteiskartan', () => {
    const t = totuus(5, '2026-06-01', 'Pilvipalvelu', 1800);
    const { kuitit, totuusPerTiedosto } = rakennaKuittilahteet([
      { totuus: t, kuitti: kuitti({ myyja: 'Pilvipalvelu', bruttoSumma: Euro.fromCents(1800) }) },
    ]);
    expect(kuitit[0]?.tiedosto).toBe('5');
    expect(totuusPerTiedosto.get('5')).toBe(t);
  });
});

describe('tilioteDiagnostiikka', () => {
  it('laskee luokat ja täsmäytystarkkuuden (oikein/väärin/ei-täsmätty/eiKohdetta)', () => {
    const t5 = totuus(5, '2026-06-01', 'Pilvipalvelu', 1800); // correct tx exists & matched
    const t9 = totuus(9, '2026-06-10', 'Verkkokauppa', 42900); // correct tx exists, but not paired to it
    const t7 = totuus(7, '2026-06-16', 'Github', 636); // no matching tx (bank charged different amount, none == 636)
    const map = new Map([
      ['5', t5],
      ['9', t9],
      ['7', t7],
    ]);
    const txPilvipalvelu = tapahtuma('2026-06-01', 'ESIMERKKI.AI SUBSCRIPTION', -1800);
    const txVk = tapahtuma('2026-06-10', 'VERKKOKAUPPA.COM', -42900);
    const txGithub = tapahtuma('2026-06-16', 'GITHUB, INC.', -612); // FX: 612 != 636
    const tasmays: TasmaysRaportti = {
      tapahtumat: [
        {
          tapahtuma: txPilvipalvelu,
          luokka: 'tasmays',
          kuitti: { tiedosto: '5', kuitti: kuitti() },
        },
        { tapahtuma: txVk, luokka: 'tasmays', kuitti: { tiedosto: '7', kuitti: kuitti() } }, // 7 matched here: false positive (no tx == 636)
        { tapahtuma: txGithub, luokka: 'kuittiPuuttuu' },
      ],
      kuititIlmanTapahtumaa: [{ tiedosto: '9', kuitti: kuitti() }], // 9's correct tx (txVk) exists but 9 left unmatched
    };
    const d = tilioteDiagnostiikka(tasmays, [txPilvipalvelu, txVk, txGithub], map, 10);
    expect(d.tasmays).toBe(2);
    expect(d.kuittiPuuttuu).toBe(1);
    expect(d.tasmaysOikein).toBe(1); // t5 → its correct tx
    expect(d.tasmaysVaarin).toBe(1); // t7: paired to txVk though no tx has |maara|==636 (false positive)
    expect(d.eiTasmatty).toBe(1); // t9: correct tx (txVk) exists but matcher paired it to t7 instead
    expect(d.eiKohdetta).toBe(0);
  });
});

describe('ajaPolkuB', () => {
  it('rakentaa tositteen täsmätystä parista ja vertaa totuuteen', () => {
    const t5 = totuus(5, '2026-06-01', 'Pilvipalvelu', 1800);
    const map = new Map([['5', t5]]);
    const tasmays: TasmaysRaportti = {
      tapahtumat: [
        {
          tapahtuma: tapahtuma('2026-06-01', 'ESIMERKKI.AI SUBSCRIPTION', -1800),
          luokka: 'tasmays',
          kuitti: {
            tiedosto: '5',
            kuitti: kuitti({
              myyja: 'Pilvipalvelu',
              pvm: '2026-06-01',
              bruttoSumma: Euro.fromCents(1800),
              alv: [{ kanta: 0, brutto: Euro.fromCents(1800) }],
            }),
          },
        },
      ],
      kuititIlmanTapahtumaa: [],
    };
    const tulokset = ajaPolkuB(tasmays, map, chart, () => kylmaAsetukset(chart));
    expect(tulokset).toHaveLength(1);
    const pvm = tulokset[0]?.kentat.find((k) => k.nimi === 'pvm');
    const brutto = tulokset[0]?.kentat.find((k) => k.nimi === 'brutto');
    expect(pvm?.ok).toBe(true); // bank date == booked date
    expect(brutto?.ok).toBe(true); // bank amount == booked total
  });
});
