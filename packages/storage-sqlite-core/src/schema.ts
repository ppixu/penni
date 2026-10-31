/**
 * Ordered schema migrations. Index = version number. Append-only: NEVER edit or reorder an
 * existing entry once shipped; add a new entry to evolve the schema. Shape mirrors the legacy
 * sqlite/luo.sql "JSON blob + indexed scalar overlay" pattern (architecture §7), collapsed to
 * the numero-keyed, Tier-0 subset the Storage port needs.
 */
export const SCHEMA_VERSIONS: readonly string[] = [
  `
  CREATE TABLE asetus (
    avain    TEXT PRIMARY KEY NOT NULL,
    arvo     TEXT,
    muokattu INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE tili (
    numero   INTEGER PRIMARY KEY NOT NULL,
    tyyppi   TEXT NOT NULL,
    json     TEXT NOT NULL,
    muokattu INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE tilikausi (
    alkaa  TEXT PRIMARY KEY NOT NULL,
    loppuu TEXT NOT NULL,
    json   TEXT NOT NULL
  );

  CREATE TABLE tosite (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    pvm      TEXT,
    tyyppi   INTEGER NOT NULL DEFAULT 0,
    tila     INTEGER NOT NULL DEFAULT 100,
    tunniste INTEGER NOT NULL DEFAULT 0,
    sarja    TEXT NOT NULL DEFAULT '',
    kumppani INTEGER,
    viite    TEXT,
    laskupvm TEXT,
    erapvm   TEXT,
    json     TEXT NOT NULL
  );
  CREATE INDEX idx_tosite_pvm      ON tosite(pvm);
  CREATE INDEX idx_tosite_tyyppi   ON tosite(tyyppi);
  CREATE INDEX idx_tosite_tila     ON tosite(tila);
  CREATE INDEX idx_tosite_tunniste ON tosite(tunniste);
  CREATE INDEX idx_tosite_sarja    ON tosite(sarja);
  CREATE INDEX idx_tosite_kumppani ON tosite(kumppani);
  CREATE INDEX idx_tosite_viite    ON tosite(viite);

  CREATE TABLE vienti (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tosite    INTEGER NOT NULL REFERENCES tosite(id) ON DELETE CASCADE,
    rivi      INTEGER NOT NULL,
    tili      INTEGER NOT NULL,
    pvm       TEXT NOT NULL,
    debetsnt  INTEGER NOT NULL DEFAULT 0,
    kreditsnt INTEGER NOT NULL DEFAULT 0,
    kohdennus INTEGER NOT NULL DEFAULT 0,
    eraid     INTEGER
  );
  CREATE INDEX idx_vienti_tosite    ON vienti(tosite);
  CREATE INDEX idx_vienti_pvm       ON vienti(pvm);
  CREATE INDEX idx_vienti_tili      ON vienti(tili);
  CREATE INDEX idx_vienti_kohdennus ON vienti(kohdennus);

  CREATE TABLE loki (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    tosite INTEGER NOT NULL,
    aika   TEXT NOT NULL,
    userid INTEGER,
    tila   INTEGER NOT NULL,
    data   TEXT
  );
  CREATE INDEX idx_loki_tosite ON loki(tosite);
  `,
  // v1: kumppani (partner) — json blob + nimi/alvtunnus scalar overlay
  `
  CREATE TABLE kumppani (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nimi      TEXT,
    alvtunnus TEXT,
    json      TEXT NOT NULL
  );
  CREATE INDEX idx_kumppani_nimi ON kumppani(nimi);
  `,
  // v2: liite (attachment) — blob-hyötykuorma + metatieto-overlay, avaimena tosite
  `
  CREATE TABLE liite (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tosite    INTEGER NOT NULL REFERENCES tosite(id) ON DELETE CASCADE,
    nimi      TEXT NOT NULL,
    roolinimi TEXT,
    tyyppi    TEXT NOT NULL,
    sha       TEXT,
    luotu     TEXT NOT NULL,
    data      BLOB NOT NULL,
    json      TEXT NOT NULL
  );
  CREATE INDEX idx_liite_tosite ON liite(tosite);
  CREATE UNIQUE INDEX idx_liite_tosite_rooli ON liite(tosite, roolinimi);
  `,
  // v3: tili avataan (numero, taso) -yhdistelmäavaimeksi — Kitsas sallii otsikon ja tilin, tai
  // kaksi otsikkoa eri tasoilla, jakaa saman numeron. SQLite ei voi muuttaa primaariavainta
  // paikallaan, joten taulu rakennetaan uudelleen. CASE-lauseke peilaa tasoTyypistaa
  // (@penni/engine): lehtitilit tasolle 0, 'H<n>' otsikot tasolle n.
  `
  CREATE TABLE tili_uusi (
    numero   INTEGER NOT NULL,
    taso     INTEGER NOT NULL DEFAULT 0,
    tyyppi   TEXT NOT NULL,
    json     TEXT NOT NULL,
    muokattu INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (numero, taso)
  );
  INSERT INTO tili_uusi (numero, taso, tyyppi, json, muokattu)
    SELECT numero,
           CASE WHEN tyyppi LIKE 'H%' THEN CAST(substr(tyyppi, 2) AS INTEGER) ELSE 0 END,
           tyyppi, json, muokattu
    FROM tili;
  DROP TABLE tili;
  ALTER TABLE tili_uusi RENAME TO tili;
  `,
  // v4: loki saa lahde-sarakkeen — agentti/työkalu-attribuutio auditriville (esim. "cli").
  'ALTER TABLE loki ADD COLUMN lahde TEXT;',
  // v5: liite saa varasto_avain- ja koko-sarakkeet — kun liitteen tavut elävät ulkoisessa
  // liitevarastossa (esim. R2), rivillä on vain metatieto + varaston avain ja data jää tyhjäksi
  // (NOT NULL säilyy). Paikalliset kirjat: varasto_avain on NULL, data kuten ennen.
  `
  ALTER TABLE liite ADD COLUMN varasto_avain TEXT;
  ALTER TABLE liite ADD COLUMN koko INTEGER;
  `,
];
