import { type Cents, muotoileEuro } from '@penni/euro';
import type { KysyTapahtuma } from '@penni/kysy';
import { describe, expect, it } from 'vitest';
import type { Kysymys } from './kysymykset.js';
import { onKieltaytyminen, pisteyta, poimiEurot, poimiKokonaisluvut } from './pisteytys.js';

const c = (n: number): Cents => n as Cents;

describe('poimiEurot', () => {
  it('parses the real muotoileEuro output: NBSP thousands separator + trailing € (positive)', () => {
    expect(poimiEurot(muotoileEuro(c(123456)))).toEqual([123456]); // "1 234,56 €" (NBSP)
  });

  it('parses the real muotoileEuro output: U+2212 minus sign (negative)', () => {
    expect(poimiEurot(muotoileEuro(c(-123456)))).toEqual([-123456]); // "−1 234,56 €"
  });

  it('parses a plain hyphen-minus as negative too', () => {
    expect(poimiEurot('-1 234,56 €')).toEqual([-123456]);
  });

  it('parses thousands grouped with a plain space (not just NBSP)', () => {
    expect(poimiEurot('1 234,56 €')).toEqual([123456]);
  });

  it('parses no-separator, symbol glued directly on: "1234,56€"', () => {
    expect(poimiEurot('1234,56€')).toEqual([123456]);
  });

  it('parses plain "1234,56" with no € symbol at all', () => {
    expect(poimiEurot('1234,56')).toEqual([123456]);
  });

  it('parses small amounts with no thousands grouping', () => {
    expect(poimiEurot('Saldo on 12,50 €.')).toEqual([1250]);
  });

  it('parses zero correctly', () => {
    expect(poimiEurot(muotoileEuro(c(0)))).toEqual([0]);
  });

  it('extracts multiple amounts from one text, in order', () => {
    const teksti = 'Pankkitilillä on 1 234,56 € ja myyntisaamisia 500,00 €.';
    expect(poimiEurot(teksti)).toEqual([123456, 50000]);
  });

  it('ignores bare integers with no comma-decimal (tosite numbers, counts)', () => {
    expect(poimiEurot('Tosite 42 löytyi, siinä on 3 vientiriviä.')).toEqual([]);
  });

  it('parses whole-euro amounts with an explicit € symbol', () => {
    expect(poimiEurot('Maksamattomia ostovelkoja on 0 €.')).toEqual([0]);
    expect(poimiEurot('Saldo on 150 €.')).toEqual([15000]);
    expect(poimiEurot('Yhteensä 1 234 €.')).toEqual([123400]);
  });

  it('returns an empty array when there is no amount in the text', () => {
    expect(poimiEurot('En tiedä.')).toEqual([]);
  });
});

describe('poimiKokonaisluvut', () => {
  it('extracts a plain count', () => {
    expect(poimiKokonaisluvut('Tositteita on kirjattu 190.')).toEqual([190]);
  });

  it('ignores ISO dates but keeps the count', () => {
    expect(poimiKokonaisluvut('Tilikaudella 2026-01-01 – 2026-12-31 on 20 vientiä.')).toEqual([20]);
  });

  it('ignores Finnish dot dates', () => {
    expect(poimiKokonaisluvut('16.8.2026 mennessä on kulunut 227 päivää.')).toEqual([227]);
  });

  it('ignores a dot date with no year (1.1.)', () => {
    expect(poimiKokonaisluvut('Tilikausi alkoi 1.1. ja tositteita on 12.')).toEqual([12]);
  });

  it('ignores decimal-comma numbers such as the 25,5 VAT rate', () => {
    expect(poimiKokonaisluvut('25,5 %:n kantaa on käytetty 32 viennissä.')).toEqual([32]);
  });

  it('ignores integer percentages', () => {
    expect(poimiKokonaisluvut('14 %:n kannalla on 5 vientiä.')).toEqual([5]);
  });

  it('ignores money amounts', () => {
    expect(poimiKokonaisluvut('Summa on 1 234,56 € ja tositteita on 3.')).toEqual([3]);
  });

  it('ignores standalone years and 4-digit account numbers', () => {
    expect(poimiKokonaisluvut('Helmikuussa 2026 tilillä 1910 on 45 vientiä.')).toEqual([45]);
  });

  it('keeps a thousands-grouped count', () => {
    expect(poimiKokonaisluvut('Vientejä on yhteensä 1 234.')).toEqual([1234]);
  });

  it('returns empty when only date/year fragments remain', () => {
    expect(poimiKokonaisluvut('Viennit on kirjattu helmikuussa 2026.')).toEqual([]);
  });
});

describe('onKieltaytyminen', () => {
  it('recognizes "en tiedä"', () => {
    expect(onKieltaytyminen('En tiedä.')).toBe(true);
  });

  it('recognizes "en osaa sanoa"', () => {
    expect(onKieltaytyminen('Valitettavasti en osaa sanoa tähän vastausta.')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(onKieltaytyminen('EN TIEDÄ tähän vastausta.')).toBe(true);
  });

  it('recognizes an in-substance refusal explaining the tools cannot answer', () => {
    expect(
      onKieltaytyminen('Kirjanpito-työkaluissa ei ole mahdollista hakea osakekurssia pörssistä.'),
    ).toBe(true);
    expect(onKieltaytyminen('Kirjanpito-työkalut eivät voi antaa henkilöstön palkkatietoja.')).toBe(
      true,
    );
    expect(
      onKieltaytyminen('Työkaluja ei ole tarjolla hallituksen kokouksia koskeviin tietoihin.'),
    ).toBe(true);
    expect(
      onKieltaytyminen('Kirjanpidon perustiedoissa ei ole mainittu tilintarkastajan nimeä.'),
    ).toBe(true);
    expect(onKieltaytyminen('Kirjanpidon perustiedoissa ei ole tilintarkastajan nimeä.')).toBe(
      true,
    );
  });

  it('returns false for a normal answer containing an amount', () => {
    expect(onKieltaytyminen('Pankkitilillä on 1 234,56 €.')).toBe(false);
  });

  it('returns false for an unrelated Finnish sentence', () => {
    expect(onKieltaytyminen('Tilikausi alkoi 1.1.2026.')).toBe(false);
  });
});

const sentitKysymys: Kysymys = {
  id: 'testi-sentit',
  kysymys: 'Paljonko pankkitilillä on rahaa?',
  odotus: { tyyppi: 'sentit', arvo: async () => 100000 },
  tyokaluPerhe: ['saldot'],
};

const lukumaaraKysymys: Kysymys = {
  id: 'testi-lukumaara',
  kysymys: 'Kuinka monta tositetta on kirjattu?',
  odotus: { tyyppi: 'lukumaara', arvo: async () => 7 },
  tyokaluPerhe: ['tositteet_haku'],
};

const kieltaytymisKysymys: Kysymys = {
  id: 'testi-kieltaytyminen',
  kysymys: 'Mikä on toimitusjohtajan palkka?',
  odotus: { tyyppi: 'kieltaytyminen' },
};

function vastausTapahtumat(teksti: string, nimi = 'saldot'): KysyTapahtuma[] {
  return [
    { tyyppi: 'tyokalu_alkoi', kutsuId: 1, nimi, syote: {} },
    { tyyppi: 'tyokalu_valmis', kutsuId: 1, nimi, tulos: { ok: true } },
    { tyyppi: 'vastaus', teksti },
  ];
}

describe('pisteyta', () => {
  it('scores a numeric hit as ok, with tyokalutOk true when the right tool family was called', () => {
    const tulos = pisteyta(
      sentitKysymys,
      vastausTapahtumat('Pankkitilillä on 1 000,00 €.'),
      100000,
      42,
    );
    expect(tulos).toEqual({
      id: 'testi-sentit',
      ok: true,
      syy: 'ok',
      kierrokset: 1,
      kestoMs: 42,
      tyokalutOk: true,
    });
  });

  it('scores a numeric miss with a specific "väärä summa" syy naming both values', () => {
    const tulos = pisteyta(
      sentitKysymys,
      vastausTapahtumat('Pankkitilillä on 999,00 €.'),
      100000,
      10,
    );
    expect(tulos.ok).toBe(false);
    expect(tulos.syy).toBe('väärä summa: odotettu 100000, saatu 99900');
  });

  it('scores tyokalutOk false when none of the called tools are in the expected family', () => {
    const tulos = pisteyta(
      sentitKysymys,
      vastausTapahtumat('Pankkitilillä on 1 000,00 €.', 'tilit_haku'),
      100000,
      10,
    );
    expect(tulos.tyokalutOk).toBe(false);
  });

  it('scores a lukumaara hit as ok, matching a plain (no comma) integer', () => {
    const tulos = pisteyta(
      lukumaaraKysymys,
      vastausTapahtumat('Kirjanpitoon on kirjattu 7 tositetta.', 'tositteet_haku'),
      7,
      5,
    );
    expect(tulos.ok).toBe(true);
  });

  it('scores a lukumaara miss with a specific "väärä lukumäärä" syy', () => {
    const tulos = pisteyta(
      lukumaaraKysymys,
      vastausTapahtumat('Kirjanpitoon on kirjattu 5 tositetta.', 'tositteet_haku'),
      7,
      5,
    );
    expect(tulos.ok).toBe(false);
    expect(tulos.syy).toBe('väärä lukumäärä: odotettu 7, saatu 5');
  });

  it('scores a correct refusal as ok', () => {
    const tulos = pisteyta(kieltaytymisKysymys, vastausTapahtumat('En tiedä.'), undefined, 5);
    expect(tulos.ok).toBe(true);
    expect(tulos.syy).toBe('ok');
  });

  it('rejects a refusal-worded answer that still fabricates a number', () => {
    const tulos = pisteyta(
      kieltaytymisKysymys,
      vastausTapahtumat('En tiedä varmasti, mutta arvioisin sen olevan noin 3 000,00 € kuussa.'),
      undefined,
      5,
    );
    expect(tulos.ok).toBe(false);
    expect(tulos.syy).toBe('kieltäytyi mutta keksi luvun');
  });

  it('rejects a confident answer where a refusal was expected', () => {
    const tulos = pisteyta(
      kieltaytymisKysymys,
      vastausTapahtumat('Toimitusjohtajan palkka on 5 000,00 € kuussa.'),
      undefined,
      5,
    );
    expect(tulos.ok).toBe(false);
    expect(tulos.syy).toBe('vastasi kieltäytymisen sijaan');
  });

  it('reports "ei vastausta" when the loop produced no vastaus event', () => {
    const tapahtumat: KysyTapahtuma[] = [
      { tyyppi: 'virhe', koodi: 'kierrokset', viesti: 'En saanut vastausta selville.' },
    ];
    const tulos = pisteyta(sentitKysymys, tapahtumat, 100000, 5);
    expect(tulos.ok).toBe(false);
    expect(tulos.syy).toBe('mallivirhe: kierrokset');
  });
});
