import Database from 'better-sqlite3';

/** Kitsaksen laskutustaulut sellaisinaan (kitsas/sqlite/luo.sql:174-205). */
const LASKUTUS_SKEEMA = `
CREATE TABLE IF NOT EXISTS Tuote(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  nimike VARCHAR(255), json text);
CREATE TABLE IF NOT EXISTS Rivi(tosite integer REFERENCES Tosite(id) ON DELETE CASCADE,
  rivi integer, tuote integer, myyntikpl real, ostokpl real, ahinta real DEFAULT(0.0),
  json text, PRIMARY KEY(tosite, rivi));
CREATE TABLE IF NOT EXISTS Vakioviite(viite integer PRIMARY KEY NOT NULL,
  tili INTEGER REFERENCES Tili(numero) ON DELETE CASCADE,
  kohdennus INTEGER REFERENCES Kohdennus(id) ON DELETE CASCADE, otsikko TEXT,
  alkaen DATE, paattyen DATE, json TEXT);
`;

/** Lisätyt tositteet ja tuote, jotta testit voivat viitata niihin nimellä. */
export const LASKUTUS_TESTI = {
  /** Tuote, jonka Kitsas-id säilyy tuonnissa. */
  tuote: 7,
  /** Kirjattu myyntilasku numero 17: kaksi riviä, laskutusjakso, viivästyskorko 8 %. */
  lasku: 10,
  /** Maksumuistutusluonnos, joka viittaa laskuun 17 (alkupNro). */
  muistutus: 11,
  /** Maksumuistutusluonnos, jonka alkupNro ei vastaa mitään laskua. */
  orpoMuistutus: 12,
  /** Laskun viennit (senttejä): 2 × 45,50 + 10,00 = 101,00 netto, alv 25,5 % = 25,76. */
  laskunViennit: { 1910: 12676, 3000: -10100, 2939: -2576 },
} as const;

/**
 * Lisää testikirjaan (luoTestiKitsas) Kitsaksen laskutustiedot: tuote, vakioviite, kirjattu
 * myyntilasku riveineen ja kaksi maksumuistutusluonnosta. Rivit lisätään väärässä järjestyksessä
 * (rivi 2 ennen riviä 1), koska Kitsas ei järjestä niitä luettaessa (tositeroute.cpp:486-489).
 * Laskun viennit täsmäävät keskenään, joten täsmäytys pysyy kunnossa.
 */
export function lisaaLaskutusKitsas(polku: string): void {
  const db = new Database(polku);
  try {
    db.exec(LASKUTUS_SKEEMA);

    db.prepare('INSERT INTO Tuote (id, nimike, json) VALUES (?, ?, ?)').run(
      LASKUTUS_TESTI.tuote,
      'Konsultointi',
      JSON.stringify({
        UNkoodi: 'HUR',
        ahinta: 45.5,
        alvkoodi: 11,
        alvprosentti: 25.5,
        tili: 3000,
        koodi: 'K1',
        nimi: { fi: 'Konsultointi', sv: 'Konsultering' },
      }),
    );

    db.prepare(
      'INSERT INTO Vakioviite (viite, tili, kohdennus, otsikko, json) VALUES (?, ?, ?, ?, ?)',
    ).run(
      1009,
      3000,
      null,
      'Vuokrat',
      JSON.stringify({ otsikko: 'Vuokrat', kohdennus: 0, huom: 'säilyy' }),
    );

    const tosite = db.prepare(
      'INSERT INTO Tosite (id, pvm, tyyppi, tila, tunniste, sarja, otsikko, kumppani, laskupvm, erapvm, viite, json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    const vienti = db.prepare(
      'INSERT INTO Vienti (rivi, tosite, tyyppi, pvm, tili, selite, debetsnt, kreditsnt, alvprosentti, alvkoodi) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    const rivi = db.prepare(
      'INSERT INTO Rivi (tosite, rivi, tuote, myyntikpl, ostokpl, ahinta, json) VALUES (?,?,?,?,?,?,?)',
    );

    // Kirjattu myyntilasku numero 17 (MYYNTILASKU = 210).
    tosite.run(
      LASKUTUS_TESTI.lasku,
      '2026-11-01',
      210,
      100,
      10,
      '',
      'Lasku 17',
      1,
      '2026-11-01',
      '2026-11-15',
      '170',
      JSON.stringify({
        lasku: {
          numero: 17,
          maksutapa: 1,
          viivkorko: 8,
          toimituspvm: '2026-11-01',
          jaksopvm: '2026-11-30',
        },
      }),
    );
    vienti.run(1, LASKUTUS_TESTI.lasku, 200, '2026-11-01', 1910, 'Lasku 17', 12676, 0, 0, 0);
    vienti.run(2, LASKUTUS_TESTI.lasku, 1, '2026-11-01', 3000, 'Työ', 0, 10100, 25.5, 11);
    vienti.run(3, LASKUTUS_TESTI.lasku, 3, '2026-11-01', 2939, 'Alv', 0, 2576, 25.5, 11);
    // Rivi 2 ensin: lukijan on järjestettävä.
    rivi.run(
      LASKUTUS_TESTI.lasku,
      2,
      '',
      1,
      0,
      10,
      JSON.stringify({ nimike: 'Matka', alvkoodi: 11, alvprosentti: 25.5, yksikko: 'krt' }),
    );
    rivi.run(
      LASKUTUS_TESTI.lasku,
      1,
      String(LASKUTUS_TESTI.tuote),
      2,
      0,
      45.5,
      JSON.stringify({
        nimike: 'Työ',
        kuvaus: 'marraskuu',
        alvkoodi: 11,
        alvprosentti: 25.5,
        unkoodi: 'HUR',
        tili: 3000,
        aleprosentti: 0,
        ennakkoera: 3,
        laskutetaan: '2',
      }),
    );

    // Maksumuistutusluonnos (MAKSUMUISTUTUS = 216, tila 50) laskulle 17.
    tosite.run(
      LASKUTUS_TESTI.muistutus,
      '2026-12-15',
      216,
      50,
      0,
      '',
      'Maksumuistutus laskulle 17',
      1,
      null,
      '2026-12-29',
      null,
      JSON.stringify({
        lasku: {
          alkupNro: 17,
          viivkorko: 8,
          muistutusmaksu: '5.00',
          korko: 0.31,
          korkoalkaa: '2026-11-16',
          korkoloppuu: '2026-12-15',
          aiempisaldo: '126.76',
          toimituspvm: '2026-12-15',
        },
      }),
    );

    // Maksumuistutusluonnos, jonka laskua ei ole kirjassa.
    tosite.run(
      LASKUTUS_TESTI.orpoMuistutus,
      '2026-12-15',
      216,
      50,
      0,
      '',
      'Maksumuistutus laskulle 999',
      1,
      null,
      '2026-12-29',
      null,
      JSON.stringify({ lasku: { alkupNro: 999, muistutusmaksu: '5.00' } }),
    );
  } finally {
    db.close();
  }
}
