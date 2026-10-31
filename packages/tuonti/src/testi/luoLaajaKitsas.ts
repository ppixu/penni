import Database from 'better-sqlite3';
import { luoTestiKitsas } from './luoTestiKitsas.js';

/**
 * Expected open balances after import, keyed by Penni erä key (cents, debit-positive):
 * - tosite 10 (myyntilasku, opens ONE erä) → key 10: 12400 − 5000 maksu − 1240 hyvitys
 * - tosite 12 (tilinavaus, opens TWO erät) → keys −121 and −122 (Kitsas row ids, negated)
 */
export const LAAJA_ERAT: Record<number, number> = { 10: 6160, [-121]: 3000, [-122]: 2000 };

/** The VAT return filed for 2026-03 in the fixture: 2400 sales tax − 240 credited. */
export const LAAJA_ALV = { alkupvm: '2026-03-01', loppupvm: '2026-03-31', vero: 2160 };

/**
 * `luoTestiKitsas` plus the features a real book uses and the base fixture does not: an
 * invoice paid in part on a bank statement (rows carrying their own partner and archive id), a
 * credit note naming the invoice by number, an opening-balance voucher opening two erät, a
 * filed VAT return, change-history rows, a voucherless attachment and an unmapped json key.
 * Kitsas row ids are explicit (101…) so the erä names are known; the base book's rows are 1–10.
 */
export function luoLaajaKitsas(polku: string): void {
  luoTestiKitsas(polku);
  const db = new Database(polku);
  try {
    const tili = db.prepare('INSERT INTO Tili (numero, tyyppi, iban, json) VALUES (?, ?, ?, ?)');
    tili.run(1701, 'AS', null, JSON.stringify({ nimi: { fi: 'Myyntisaamiset' } }));
    tili.run(2001, 'BE', null, JSON.stringify({ nimi: { fi: 'Oma pääoma' } }));
    tili.run(2920, 'BL', null, JSON.stringify({ nimi: { fi: 'Verovelka' } }));

    const tosite = db.prepare(
      'INSERT INTO Tosite (id, pvm, tyyppi, tila, tunniste, sarja, otsikko, kumppani, viite, json) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    const vienti = db.prepare(
      `INSERT INTO Vienti (id, rivi, tosite, tyyppi, pvm, tili, selite, debetsnt, kreditsnt,
         alvprosentti, alvkoodi, eraid, kumppani, arkistotunnus, json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    // 12: tilinavaus 2026-01-01 — two open receivables, each its own erä (eraid = own row id).
    tosite.run(12, '2026-01-01', 9010, 100, 1, '', 'Tilinavaus', null, null, '{}');
    vienti.run(
      121,
      1,
      12,
      0,
      '2026-01-01',
      1701,
      'Avoin A',
      3000,
      null,
      0,
      0,
      121,
      null,
      null,
      null,
    );
    vienti.run(
      122,
      2,
      12,
      0,
      '2026-01-01',
      1701,
      'Avoin B',
      2000,
      null,
      0,
      0,
      122,
      null,
      null,
      null,
    );
    vienti.run(
      123,
      3,
      12,
      0,
      '2026-01-01',
      2001,
      'Pääoma',
      null,
      5000,
      0,
      0,
      null,
      null,
      null,
      null,
    );

    // 10: myyntilasku — Kitsas copies the voucher's partner and reference onto every row.
    tosite.run(
      10,
      '2026-03-01',
      210,
      100,
      2,
      '',
      'Myyntilasku 1001',
      1,
      '1232',
      JSON.stringify({ lasku: { numero: '1001', osoite: 'Katu 1' }, info: 'Muista karhuta' }),
    );
    vienti.run(
      101,
      1,
      10,
      202,
      '2026-03-01',
      1701,
      'Lasku',
      12400,
      null,
      0,
      0,
      101,
      1,
      null,
      '{"viite":"1232"}',
    );
    vienti.run(
      102,
      2,
      10,
      201,
      '2026-03-01',
      3000,
      'Lasku',
      null,
      10000,
      24,
      11,
      null,
      1,
      null,
      null,
    );
    vienti.run(
      103,
      3,
      10,
      203,
      '2026-03-01',
      2939,
      'Alv',
      null,
      2400,
      24,
      111,
      null,
      1,
      null,
      null,
    );

    // 11: tiliote — a payment row whose partner and reference differ from the (partnerless) voucher.
    tosite.run(
      11,
      '2026-03-20',
      400,
      100,
      3,
      '',
      'Tiliote 3/2026',
      null,
      null,
      JSON.stringify({ tiliote: { alkupvm: '2026-03-01', loppupvm: '2026-03-31', tili: '1910' } }),
    );
    vienti.run(
      111,
      1,
      11,
      300,
      '2026-03-20',
      1910,
      'Maksu',
      5000,
      null,
      0,
      0,
      null,
      1,
      'ARK123',
      null,
    );
    vienti.run(
      112,
      2,
      11,
      302,
      '2026-03-20',
      1701,
      'Maksu',
      null,
      5000,
      0,
      0,
      101,
      1,
      'ARK123',
      JSON.stringify({ viite: '1232', palkkakoodi: 'X' }),
    );

    // 13: hyvityslasku — names the credited invoice by number (lasku.alkupNro), not by id.
    tosite.run(
      13,
      '2026-03-25',
      214,
      100,
      4,
      '',
      'Hyvityslasku 1002',
      1,
      null,
      JSON.stringify({ lasku: { numero: '1002', alkupNro: 1001 } }),
    );
    vienti.run(
      131,
      1,
      13,
      202,
      '2026-03-25',
      1701,
      'Hyvitys',
      null,
      1240,
      0,
      0,
      101,
      null,
      null,
      null,
    );
    vienti.run(
      132,
      2,
      13,
      201,
      '2026-03-25',
      3000,
      'Hyvitys',
      1000,
      null,
      24,
      11,
      null,
      null,
      null,
      null,
    );
    vienti.run(
      133,
      3,
      13,
      203,
      '2026-03-25',
      2939,
      'Alv',
      240,
      null,
      24,
      111,
      null,
      null,
      null,
      null,
    );

    // 14: alv-ilmoitus 3/2026 as Kitsas files it (alvlaskelma.cpp:950-967: koodit in cents).
    tosite.run(
      14,
      '2026-03-31',
      9100,
      100,
      5,
      '',
      'Alv-ilmoitus 3/2026',
      null,
      null,
      JSON.stringify({
        alv: {
          kausialkaa: LAAJA_ALV.alkupvm,
          kausipaattyy: LAAJA_ALV.loppupvm,
          erapvm: '2026-05-12',
          koodit: { '301': LAAJA_ALV.vero, '308': LAAJA_ALV.vero },
          maksettava: '21.60',
        },
      }),
    );
    vienti.run(
      141,
      1,
      14,
      0,
      '2026-03-31',
      2939,
      'Alv-tilitys',
      2160,
      null,
      0,
      901,
      null,
      null,
      null,
      null,
    );
    vienti.run(
      142,
      2,
      14,
      0,
      '2026-03-31',
      2920,
      'Alv-tilitys',
      null,
      2160,
      0,
      901,
      null,
      null,
      null,
      null,
    );

    const loki = db.prepare(
      'INSERT INTO Tositeloki (tosite, aika, data, userid, tila) VALUES (?, ?, ?, ?, ?)',
    );
    loki.run(13, '2026-03-25 08:00:00', JSON.stringify({ otsikko: 'Hyvitys (luonnos)' }), 2, 1);
    loki.run(13, '2026-03-25 08:05:00', JSON.stringify({ otsikko: 'Hyvityslasku 1002' }), 2, 100);

    // Kitsas deletes voucherless attachments as garbage (sqlitemodel.cpp:346); reported, not imported.
    db.prepare('INSERT INTO Liite (tosite, nimi, tyyppi, data) VALUES (?,?,?,?)').run(
      null,
      'orpo.pdf',
      'application/pdf',
      Buffer.from([1]),
    );
  } finally {
    db.close();
  }
}
