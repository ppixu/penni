import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { poimiKuittiTekstista } from './poimiKuittiTekstista.js';
import { tasmaa } from './tasmays.js';

describe('poimiKuittiTekstista', () => {
  // pdf.js-tyylinen litteä teksti: osat välilyönnein, rivit hasEOL-vaihdolla.
  const YKSIKANTA = [
    'Kahvila   Aamu   Oy',
    'Y-tunnus   2345678-0',
    'Mannerheimintie   10,   00100   Helsinki',
    'LASKU',
    'Laskun   paivays   15.07.2026',
    'Erapaiva   29.07.2026',
    'Kahvi   2,50',
    'Korvapuusti   3,90',
    'Veroton   5,61',
    'Alv   14   %   0,79',
    'Yhteensa   EUR   6,40',
  ].join('\n');

  it('poimii myyjän ensimmäiseltä riviltä ja tiivistää välit', () => {
    const t = poimiKuittiTekstista(YKSIKANTA);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBe('Kahvila Aamu Oy');
  });

  it('poimii ja validoi Y-tunnuksen', () => {
    const t = poimiKuittiTekstista(YKSIKANTA);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.ytunnus).toBe('2345678-0');
  });

  it('hylkää Y-tunnuksen jonka tarkiste on väärä', () => {
    const t = poimiKuittiTekstista('Firma Oy\nY-tunnus 2345678-1\nYhteensä 6,40');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.ytunnus).toBeUndefined();
  });

  it('valitsee laskun päiväyksen eikä eräpäivää ja normalisoi ISO-muotoon', () => {
    const t = poimiKuittiTekstista(YKSIKANTA);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.pvm).toBe('2026-07-15');
  });

  it('poimii loppusumman yhteensä-avainsanan riviltä', () => {
    const t = poimiKuittiTekstista(YKSIKANTA);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('6.40'));
  });

  it('päättelee yhden kannan netto/vero loppusummasta (täsmää rakenteen mukaan)', () => {
    const t = poimiKuittiTekstista(YKSIKANTA);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.alv).toHaveLength(1);
    expect(t.kuitti.alv[0]?.kanta).toBe(14);
    expect(t.kuitti.alv[0]?.netto).toBe(Euro.fromString('5.61'));
    expect(t.kuitti.alv[0]?.vero).toBe(Euro.fromString('0.79'));
    expect(tasmaa(t.kuitti).tasmaa).toBe(true);
  });

  it('jäsentää monikantaisen alv-erittelyn nimetyistä sarakkeista', () => {
    const teksti = [
      'Firma Oy',
      'Laskun päiväys 3.2.2026',
      'Alv 25,5 %   netto 100,00   vero 25,50   brutto 125,50',
      'Alv 14 %     netto 50,00    vero 7,00     brutto 57,00',
      'Yhteensä 182,50',
    ].join('\n');
    const t = poimiKuittiTekstista(teksti);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('182.50'));
    const kannat = t.kuitti.alv.map((e) => e.kanta).sort((a, b) => a - b);
    expect(kannat).toEqual([14, 25.5]);
    expect(tasmaa(t.kuitti).tasmaa).toBe(true);
  });

  it('palauttaa loppusumman ilman erittelyä kun kantaa ei löydy', () => {
    const t = poimiKuittiTekstista('Kioski\nYhteensä 9,90');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('9.90'));
    expect(t.kuitti.alv).toHaveLength(0);
    expect(tasmaa(t.kuitti).puutteita).toBe(true);
  });

  it('palauttaa virheen tyhjälle tekstille', () => {
    expect(poimiKuittiTekstista('   ').ok).toBe(false);
  });

  // --- Kansainväliset laskut (pistedesimaalit, €/$-merkit, englantilaiset päiväykset) ---

  it('lukee pistedesimaalin ja €-merkin', () => {
    const t = poimiKuittiTekstista('Pilvipalvelu, Ltd\nTotal €20.00');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('20.00'));
    expect(t.kuitti.valuutta).toBe('EUR');
  });

  it.each([
    ['Total USD $20.00', 'USD'],
    ['Total 20.00 GBP', 'GBP'],
    ['Total £20.00', 'GBP'],
    ['Total $20.00', 'XXX'],
    ['Total ¥20.00', 'XXX'],
    ['Currency: usd\nTotal 20.00', 'USD'],
    ['USD\nTotal 20.00', 'USD'],
    ['Total USD 20.00\nPaid EUR 18.50', 'XXX'],
    ['Total EUR 20.00', 'EUR'],
    ['Total 20.00', 'EUR'],
  ])('säilyttää valuuttamerkinnän: %s → %s', (summa, valuutta) => {
    const t = poimiKuittiTekstista(`Example Inc\nDate paid April 4, 2026\n${summa}`);
    expect(t).toMatchObject({
      ok: true,
      kuitti: { myyja: 'Example Inc', pvm: '2026-04-04', valuutta, bruttoSumma: 2000 },
    });
  });

  it('lukee US-tuhaterottimen (1,234.56 → 1234,56)', () => {
    const t = poimiKuittiTekstista('Firma Inc\nTotal $1,234.56');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('1234.56'));
  });

  it('lukee EU-tuhaterottimen (8 764,20)', () => {
    const t = poimiKuittiTekstista('Revontuli Oy\nYhteensä 8 764,20');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('8764.20'));
  });

  it('ei sekoita päivämäärää rahamääräksi', () => {
    const t = poimiKuittiTekstista('Kioski\nPäiväys 15.07.2026');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBeUndefined();
  });

  it('lukee englantilaisen pitkän päiväyksen (April 4, 2026)', () => {
    const t = poimiKuittiTekstista('Pilvipalvelu, Ltd\nDate paid April 4, 2026\nTotal €20.00');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.pvm).toBe('2026-04-04');
  });

  it('lukee ISO-päiväyksen vapaasta tekstistä', () => {
    const t = poimiKuittiTekstista('Firma Oy\nDate 2026-04-04\nTotal 20.00');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.pvm).toBe('2026-04-04');
  });

  it('poimii myyjän "Receipt from X" -otsikosta', () => {
    const t = poimiKuittiTekstista(
      'Matti Meikäläinen <matti@example.com>\nReceipt from Esimerkkibot.ai\nTotal $25.00',
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBe('Esimerkkibot.ai');
  });

  it('ohittaa ostajan/vastaanottajan rivin (sähköposti) myyjää valitessa', () => {
    const t = poimiKuittiTekstista(
      'Matti Meikäläinen <matti@example.com>\nKioski Kulma\nYhteensä 9,90',
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBe('Kioski Kulma');
  });

  it('ohittaa boilerplate-rivit ja valitsee yritysnimen (yhtiöpääte)', () => {
    const t = poimiKuittiTekstista(
      'Page 1 of 1\nReceipt\nInvoice number ABC123\nPilvipalvelu, Ltd\nTotal €20.00',
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBe('Pilvipalvelu, Ltd');
  });

  it('ei tarjoa päiväysriviä myyjäksi (Date of issue / Date paid)', () => {
    const lasku = poimiKuittiTekstista(
      [
        'Invoice',
        'Invoice number 0001-2026',
        'Date of issue August 2, 2026',
        'Date due August 2, 2026',
        'Esimerkki Internet Unlimited Company',
        'One Example Quay',
        'Dublin, Ireland',
        'Total €8.00',
      ].join('\n'),
    );
    expect(lasku.ok).toBe(true);
    if (!lasku.ok) return;
    expect(lasku.kuitti.myyja).toBe('Esimerkki Internet Unlimited Company');
    expect(lasku.kuitti.pvm).toBe('2026-08-02');

    const kuitti = poimiKuittiTekstista(
      ['Receipt', 'Date paid August 17, 2026', 'Kuukausipalvelu', 'Amount paid $20.00'].join('\n'),
    );
    expect(kuitti.ok).toBe(true);
    if (!kuitti.ok) return;
    expect(kuitti.kuitti.myyja).toBe('Kuukausipalvelu');
  });

  it('ei palauta pelkkiä päiväysrivejä myyjäksi edes viimeisenä keinona', () => {
    const t = poimiKuittiTekstista(
      ['Receipt', 'Date paid August 17, 2026', 'Total $5.00'].join('\n'),
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBeUndefined();
  });

  it('tunnistaa käännetyn verovelvollisuuden ja EU:n ulkopuolisen alueen', () => {
    const t = poimiKuittiTekstista(
      'Pilvipalvelu, Ltd\nUnited States\nTax to be paid on reverse charge basis\nTotal €20.00',
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.kaanteinenAlv).toBe(true);
    expect(t.kuitti.alue).toBe('MUU');
  });

  it('tunnistaa EU-alueen maakohtaisesti', () => {
    const t = poimiKuittiTekstista('Mallisivu Systems OÜ\nEstonia\nreverse charge\nTotal €23.47');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.kaanteinenAlv).toBe(true);
    expect(t.kuitti.alue).toBe('EU');
  });

  it('käsittelee 0 %:n käännetyn verovelvollisuuden (netto = brutto)', () => {
    const t = poimiKuittiTekstista('Pilvipalvelu, Ltd\nTax 0%\nTotal €20.00');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.alv).toHaveLength(1);
    expect(t.kuitti.alv[0]?.kanta).toBe(0);
    expect(t.kuitti.alv[0]?.netto).toBe(Euro.fromString('20.00'));
    expect(t.kuitti.alv[0]?.vero).toBe(Euro.fromString('0.00'));
  });
});
