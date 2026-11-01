import Database from 'better-sqlite3';

/**
 * Expected per-account balances (cents, debit-positive) over FINALIZED vouchers only.
 * The soft-deleted voucher's legs are deliberately excluded.
 */
export const TESTI_SALDOT: Record<number, number> = {
  1910: 66200, //  100000 debit (myynti) − 23800 credit (osto) − 10000 credit (tilinpäätössiirto)
  3000: -80645, // myynti 100000 sis. alv 24 % => netto −80645
  4000: 29194, //  osto 23800 sis. alv 24 % => netto 19194 + 10000 debit (tilinpäätössiirto)
  2939: -14749, // alv-velka: 19355 myynnistä − 4606 ostosta, kreditissä
};

// Sanity: the four balances must sum to 0, because all finalized vouchers balance.
// 66200 − 80645 + 29194 − 14749 = 0 (accounts: 1910, 3000, 4000, 2939)

const SKEEMA = `
CREATE TABLE Asetus(avain varchar(128) PRIMARY KEY NOT NULL, arvo text, muokattu timestamp);
CREATE TABLE Tili(numero integer PRIMARY KEY NOT NULL, tyyppi varchar(10) NOT NULL,
  iban VARCHAR(32), json text, muokattu TIMESTAMP);
CREATE TABLE Otsikko(numero integer NOT NULL, taso integer NOT NULL, json text,
  muokattu TIMESTAMP, PRIMARY KEY (numero,taso));
CREATE TABLE Tilikausi(alkaa date PRIMARY KEY NOT NULL, loppuu date UNIQUE NOT NULL, json text);
CREATE TABLE Kumppani(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, nimi VARCHAR(255),
  alvtunnus VARCHAR(20), json text);
CREATE TABLE KumppaniIban(iban VARCHAR(30) PRIMARY KEY NOT NULL,
  kumppani INTEGER REFERENCES Kumppani(id) ON DELETE CASCADE);
CREATE TABLE Tosite(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, pvm date, tyyppi integer,
  tila integer DEFAULT 100, tunniste integer, sarja VARCHAR(10), otsikko TEXT,
  kumppani integer REFERENCES Kumppani(id), laskupvm DATE, erapvm DATE, viite varchar(64), json text);
CREATE TABLE Vienti(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, rivi integer NOT NULL,
  tosite integer REFERENCES Tosite(id) ON DELETE CASCADE, tyyppi integer DEFAULT (0), pvm date,
  tili integer, kohdennus integer DEFAULT(0), selite text, debetsnt BIGINT, kreditsnt BIGINT,
  eraid integer, alvprosentti numeric(5,2), alvkoodi integer, kumppani integer,
  jaksoalkaa DATE, jaksoloppuu DATE, arkistotunnus VARCHAR(32), json text);
CREATE TABLE Liite(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  tosite integer REFERENCES Tosite (id) ON DELETE CASCADE, nimi text, roolinimi varchar(16),
  tyyppi text, sha text, data bytea, luotu timestamp, json text, UNIQUE(tosite,roolinimi));
CREATE TABLE Kohdennus(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, tyyppi INTEGER NOT NULL, kuuluu INTEGER REFERENCES Kohdennus(id) ON DELETE RESTRICT, json text, CHECK (tyyppi IN (0,1,2,3)));
CREATE TABLE Tositeloki(id integer PRIMARY KEY AUTOINCREMENT NOT NULL, tosite integer REFERENCES Tosite(id), aika timestamp DEFAULT current_timestamp, data jsonb, userid integer, tila integer);
`;

/**
 * Write a small, complete Kitsas book to `polku`: 2 fiscal years, 5 vouchers (one of them
 * soft-deleted, one dated exactly on a fiscal-year boundary), 10 ledger rows, 1 partner with
 * an IBAN, 1 attachment, and a chart heading. Balances over finalized vouchers are exactly
 * `TESTI_SALDOT`.
 */
export function luoTestiKitsas(polku: string): void {
  const db = new Database(polku);
  try {
    db.exec(SKEEMA);

    // Seed the default Kohdennus row as in real Kitsas books
    db.prepare('INSERT INTO Kohdennus (id, tyyppi, kuuluu, json) VALUES (?, ?, ?, ?)').run(
      0,
      0,
      null,
      JSON.stringify({ nimi: { fi: 'Yleinen', se: 'Allmän', en: 'General' } }),
    );

    const asetus = db.prepare('INSERT INTO Asetus (avain, arvo) VALUES (?, ?)');
    asetus.run('Nimi', 'Testikirjanpito Oy');
    asetus.run('KpVersio', '24');
    asetus.run('KitsasVersio', '2.0');
    asetus.run('AlvVelvollinen', 'true');
    asetus.run('LaskuIkkunaX', '100'); // suodattuu pois tuonnissa

    const tili = db.prepare('INSERT INTO Tili (numero, tyyppi, iban, json) VALUES (?, ?, ?, ?)');
    tili.run(1910, 'ARP', 'FI2112345600000785', JSON.stringify({ nimi: { fi: 'Pankkitili' } }));
    tili.run(3000, 'CL', null, JSON.stringify({ nimi: { fi: 'Myynti' } }));
    tili.run(4000, 'D', null, JSON.stringify({ nimi: { fi: 'Ostot' } }));
    tili.run(2939, 'BL', null, JSON.stringify({ nimi: { fi: 'Alv-velka' } }));

    db.prepare('INSERT INTO Otsikko (numero, taso, json) VALUES (?, ?, ?)').run(
      3,
      1,
      JSON.stringify({ nimi: { fi: 'TUOTOT' } }),
    );

    const kausi = db.prepare('INSERT INTO Tilikausi (alkaa, loppuu, json) VALUES (?, ?, ?)');
    kausi.run('2025-01-01', '2025-12-31', '{}');
    kausi.run('2026-01-01', '2026-12-31', '{}');

    db.prepare('INSERT INTO Kumppani (id, nimi, alvtunnus, json) VALUES (?, ?, ?, ?)').run(
      1,
      'Testitoimittaja Oy',
      'FI12345671',
      JSON.stringify({ osoite: 'Katu 1', postinumero: '00100', kaupunki: 'Helsinki' }),
    );
    db.prepare('INSERT INTO KumppaniIban (iban, kumppani) VALUES (?, ?)').run(
      'FI2112345600000785',
      1,
    );

    const tosite = db.prepare(
      'INSERT INTO Tosite (id, pvm, tyyppi, tila, tunniste, sarja, otsikko, kumppani, json) VALUES (?,?,?,?,?,?,?,?,?)',
    );
    const vienti = db.prepare(
      'INSERT INTO Vienti (rivi, tosite, tyyppi, pvm, tili, selite, debetsnt, kreditsnt, alvprosentti, alvkoodi) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );

    // 1: myyntitosite 2025, viimeistelty, tunniste 1
    tosite.run(1, '2025-03-01', 200, 100, 1, '', 'Myyntilasku', null, '{}');
    vienti.run(1, 1, 200, '2025-03-01', 1910, 'Myynti', 100000, 0, 0, 0);
    vienti.run(2, 1, 1, '2025-03-01', 3000, 'Myynti', 0, 80645, 24, 1);
    vienti.run(3, 1, 3, '2025-03-01', 2939, 'Alv', 0, 19355, 24, 1);

    // 2: ostotosite 2025, viimeistelty, tunniste 2, kumppani + liite
    tosite.run(2, '2025-04-15', 100, 100, 2, '', 'Ostolasku', 1, '{}');
    vienti.run(1, 2, 100, '2025-04-15', 4000, 'Osto', 19194, 0, 24, 1);
    vienti.run(2, 2, 3, '2025-04-15', 2939, 'Alv', 4606, 0, 24, 1);
    vienti.run(3, 2, 1, '2025-04-15', 1910, 'Osto', 0, 23800, 0, 0);
    db.prepare(
      'INSERT INTO Liite (tosite, nimi, roolinimi, tyyppi, sha, data, luotu) VALUES (?,?,?,?,?,?,?)',
    ).run(
      2,
      'kuitti.pdf',
      'kuitti',
      'application/pdf',
      'abc123',
      Buffer.from([37, 80, 68, 70]),
      '2025-04-15T12:00:00',
    );

    // 3: poistettu tosite (tila 0) — tunniste säilyy, saldoihin ei lasketa.
    // tunniste is deliberately 99 — higher than every finalized voucher's number (max 4). If
    // maxTunniste ever stopped filtering on tila >= 100, it would return 99 instead of 4 and
    // the numbering test goes red. A lower number here would hide that bug.
    tosite.run(3, '2025-05-01', 100, 0, 99, '', 'Peruttu ostolasku', null, '{}');
    vienti.run(1, 3, 100, '2025-05-01', 4000, 'Peruttu', 500000, 0, 0, 0);
    vienti.run(2, 3, 1, '2025-05-01', 1910, 'Peruttu', 0, 500000, 0, 0);

    // 4: luonnos 2026 (tila 50) — ei tunnistetta, ei saldoihin
    tosite.run(4, '2026-02-01', 100, 50, 0, '', 'Kesken', null, '{}');

    // 5: tilinpäätössiirto tasan tilikauden 2025 viimeisenä päivänä (tila 100, tunniste 4) —
    // pin the fiscal-year boundary: this posting must land inside the [alkaa, loppuu] window
    // on BOTH the source-side sum and the destination querySaldot, or reconciliation regresses
    // silently. Real books are full of exactly this (closing entries land on 12-31/01-01).
    tosite.run(5, '2025-12-31', 0, 100, 4, '', 'Tilinpäätössiirto', null, '{}');
    vienti.run(1, 5, 0, '2025-12-31', 4000, 'Tilinpäätössiirto', 10000, 0, 0, 0);
    vienti.run(2, 5, 0, '2025-12-31', 1910, 'Tilinpäätössiirto', 0, 10000, 0, 0);

    const loki = db.prepare(
      'INSERT INTO Tositeloki (tosite, aika, data, userid, tila) VALUES (?, ?, ?, ?, ?)',
    );
    loki.run(1, '2025-03-01T10:00:00', '{}', 1, 100);
    loki.run(2, '2025-04-15T10:00:00', '{}', 1, 100);
  } finally {
    db.close();
  }
}

/** Kitsas row ids of the ledger rows `luoKohdennusKitsas` tags (1–10 in insertion order). */
export const KOHDENNUS_VIENNIT = { myynti: 2, osto: 4, siirto: 9 } as const;

/**
 * `luoTestiKitsas` plus the three kohdennus tables: cost centres 1 (Helsinki) and 2 (Tampere,
 * with dates and an unmodelled json key), project 3 under centre 1, project 4 under Yleinen
 * with dates, tags 5 and 6; ledger rows 2/4/9 carrying a kohdennus, rows 4 and 2 tagged (row 4
 * with both tags, inserted in descending order), and budgets for both fiscal years — a NULL
 * and an explicit Yleinen row, per-centre and per-project rows, and one zero row.
 */
export function luoKohdennusKitsas(polku: string): void {
  luoTestiKitsas(polku);
  const db = new Database(polku);
  try {
    db.exec(`
CREATE TABLE Merkkaus(vienti INTEGER REFERENCES Vienti(id) ON DELETE CASCADE,
  kohdennus INTEGER REFERENCES Kohdennus(id) ON DELETE CASCADE, PRIMARY KEY (vienti, kohdennus));
CREATE TABLE Budjetti(tilikausi DATE REFERENCES Tilikausi(alkaa),
  kohdennus INTEGER REFERENCES Kohdennus(id) ON DELETE CASCADE,
  tili INTEGER REFERENCES Tili(numero) ON DELETE CASCADE, sentti BIGINT,
  PRIMARY KEY (tilikausi, kohdennus, tili));`);
    const kohdennus = db.prepare(
      'INSERT INTO Kohdennus (id, tyyppi, kuuluu, json) VALUES (?,?,?,?)',
    );
    kohdennus.run(1, 1, null, JSON.stringify({ nimi: { fi: 'Helsinki', sv: 'Helsingfors' } }));
    kohdennus.run(
      2,
      1,
      null,
      JSON.stringify({
        nimi: { fi: 'Tampere' },
        alkaa: '2025-01-01',
        paattyy: '2026-12-31',
        lisatieto: 'x',
      }),
    );
    kohdennus.run(3, 2, 1, JSON.stringify({ nimi: { fi: 'Remontti' } }));
    kohdennus.run(
      4,
      2,
      0,
      JSON.stringify({ nimi: { fi: 'Kampanja' }, alkaa: '2025-06-01', paattyy: '2025-12-31' }),
    );
    kohdennus.run(5, 3, null, JSON.stringify({ nimi: { fi: 'Edustus' } }));
    kohdennus.run(6, 3, null, JSON.stringify({ nimi: { fi: 'Matka' } }));

    const kohdenna = db.prepare('UPDATE Vienti SET kohdennus = ? WHERE id = ?');
    kohdenna.run(1, KOHDENNUS_VIENNIT.myynti);
    kohdenna.run(3, KOHDENNUS_VIENNIT.osto);
    kohdenna.run(4, KOHDENNUS_VIENNIT.siirto);
    const merkkaus = db.prepare('INSERT INTO Merkkaus (vienti, kohdennus) VALUES (?, ?)');
    merkkaus.run(KOHDENNUS_VIENNIT.osto, 6);
    merkkaus.run(KOHDENNUS_VIENNIT.osto, 5);
    merkkaus.run(KOHDENNUS_VIENNIT.myynti, 5);

    const budjetti = db.prepare(
      'INSERT INTO Budjetti (tilikausi, kohdennus, tili, sentti) VALUES (?,?,?,?)',
    );
    budjetti.run('2025-01-01', null, 3000, 500000);
    budjetti.run('2025-01-01', 1, 3000, 200000);
    budjetti.run('2025-01-01', 1, 4000, -80000);
    budjetti.run('2025-01-01', 3, 4000, -30000);
    budjetti.run('2026-01-01', 0, 3000, 600000);
    budjetti.run('2026-01-01', 0, 4000, -90000);
    budjetti.run('2026-01-01', 2, 3000, 0);
  } finally {
    db.close();
  }
}
