import { Euro } from '@penni/euro';
import { tarkistaViite } from '@penni/validator';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi } from '../alv/koodit.js';
import { Maksutapa } from '../vouchers/enums.js';
import { tallennaHyvityslasku } from './hyvityslaskuResource.js';
import {
  listaaMyyntilaskut,
  tallennaMyyntilasku,
  tallennaSuoritus,
} from './myyntilaskuResource.js';
import { ResourceError } from './storage.js';

const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
      { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Käteinen' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
      { numero: 2949, tyyppi: 'BLM', nimi: { fi: 'Kohdentamaton alv-velka' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {
      AlvVelvollinen: 'true',
      LaskuSaatavaTili: '1701',
      LaskuKateistili: '1910',
      OletusMyyntitili: '3000',
      AlvVelkaTili: '2939',
    },
  });

const yksiRivi = {
  myyntiKpl: 1,
  aNetto: 100,
  alvKoodi: AlvKoodi.MYYNNIT_NETTO,
  alvProsentti: 25.5,
};

describe('tallennaMyyntilasku', () => {
  it('posts a numbered, referenced, balanced invoice and bumps LaskuSeuraavaId', async () => {
    const s = seed();
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    expect(lasku.numero).toBe('1');
    expect(tarkistaViite(lasku.viite as string)).toBe(true);
    expect(lasku.tunniste).toBeGreaterThanOrEqual(1);
    expect(lasku.tila).toBe(100);
    expect(lasku.viennit.find((v) => v.tili === 1701)?.debet).toBe(12550);
    expect(lasku.viennit.find((v) => v.tili === 3000)?.kredit).toBe(10000);
    expect(lasku.viennit.find((v) => v.tili === 2939)?.kredit).toBe(2550);
    const seuraava = await tallennaMyyntilasku(s, { pvm: '2026-06-02', rivit: [yksiRivi] }, env);
    expect(seuraava.numero).toBe('2');
  });

  it('respects the LaskuNumerointialkaa floor', async () => {
    const s = seed();
    await s.patchAsetukset({ LaskuNumerointialkaa: '1000' });
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    expect(lasku.numero).toBe('1000');
  });

  it('rejects an invoice with no rows', async () => {
    const s = seed();
    await expect(
      tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [] }, env),
    ).rejects.toMatchObject({
      code: 'EIRIVEJA',
    });
  });

  it('rejects when a required account setting is missing', async () => {
    const s = createMemoryStorage({
      tilit: [{ numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } }],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { AlvVelvollinen: 'true', OletusMyyntitili: '3000' }, // no LaskuSaatavaTili
    });
    await expect(
      tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env),
    ).rejects.toMatchObject({
      code: 'EILASKUTILIA',
    });
  });

  it('KATEINEN debits the cash account and opens no era', async () => {
    const s = seed();
    const lasku = await tallennaMyyntilasku(
      s,
      { pvm: '2026-06-01', maksutapa: Maksutapa.KATEINEN, rivit: [yksiRivi] },
      env,
    );
    const kassa = lasku.viennit.find((v) => v.tili === 1910);
    expect(kassa?.debet).toBe(12550);
    expect(kassa?.era).toBeUndefined();
  });

  it('marks a ResourceError instance', async () => {
    const s = seed();
    await expect(
      tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [] }, env),
    ).rejects.toBeInstanceOf(ResourceError);
  });
});

describe('tallennaMyyntilasku maksuperusteinen', () => {
  it('defers sale VAT to the KOHDENTAMATON holding account under cash-basis LASKU', async () => {
    const s = seed(); // must include 2949 typed BLM
    await s.patchAsetukset({ MaksuAlvAlkaa: '2026-01-01' }); // seed already has AlvVelvollinen:true
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    expect(lasku.viennit.find((v) => v.tili === 2949)?.kredit).toBe(2_550); // deferred VAT
    expect(lasku.viennit.some((v) => v.tili === 2939)).toBe(false); // not in real ALVVELKA
    expect(lasku.viennit.find((v) => v.tili === 3000)?.alvKoodi).toBe(18);
    // AR settlement leg still carries era = tosite.id
    expect(lasku.viennit.find((v) => v.debet > 0)?.era).toBe(lasku.id);
  });

  it('cash sale (KATEINEN) stays accrual even under cash-basis', async () => {
    const s = seed();
    await s.patchAsetukset({ MaksuAlvAlkaa: '2026-01-01' });
    const lasku = await tallennaMyyntilasku(
      s,
      { pvm: '2026-06-01', maksutapa: Maksutapa.KATEINEN, rivit: [yksiRivi] },
      env,
    );
    expect(lasku.viennit.find((v) => v.tili === 2939)?.kredit).toBe(2_550); // real ALVVELKA
    expect(lasku.viennit.some((v) => v.tili === 2949)).toBe(false);
  });

  it('rejects when the holding account is missing from the chart under cash-basis', async () => {
    const s = createMemoryStorage({
      tilit: [
        { numero: 1701, tyyppi: 'AS', nimi: { fi: 'Myyntisaamiset' } },
        { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Käteinen' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
        { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Suoritettava alv' } },
      ], // ei 2949-tiliä
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: {
        AlvVelvollinen: 'true',
        LaskuSaatavaTili: '1701',
        LaskuKateistili: '1910',
        OletusMyyntitili: '3000',
        AlvVelkaTili: '2939',
        MaksuAlvAlkaa: '2026-01-01',
      },
    });
    await expect(
      tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env),
    ).rejects.toMatchObject({ code: 'EIKOHDENTAMATONTILIA' });
  });
});

describe('listaaMyyntilaskut', () => {
  it('returns one row per invoice with avoin === summa when unpaid', async () => {
    const s = seed();
    await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const lista = await listaaMyyntilaskut(s, {});
    expect(lista).toHaveLength(1);
    expect(lista[0]?.summa).toBe(12550);
    expect(lista[0]?.avoin).toBe(12550);
    expect(lista[0]?.numero).toBe('1');
    expect(lista[0]?.tili).toBe(1701);
    expect(lista[0]?.era).toBeTruthy();
  });

  it('shows avoin === 0 for a cash invoice (no era leg)', async () => {
    const s = seed();
    await tallennaMyyntilasku(
      s,
      { pvm: '2026-06-01', maksutapa: Maksutapa.KATEINEN, rivit: [yksiRivi] },
      env,
    );
    const lista = await listaaMyyntilaskut(s, {});
    expect(lista[0]?.avoin).toBe(0);
  });

  it('joins the customer name from kumppani', async () => {
    const s = seed();
    const asiakas = await s.saveKumppani({ nimi: 'Asiakas Oy' });
    await tallennaMyyntilasku(
      s,
      { pvm: '2026-06-01', kumppani: asiakas.id, rivit: [yksiRivi] },
      env,
    );
    const lista = await listaaMyyntilaskut(s, {});
    expect(lista[0]?.asiakas).toBe('Asiakas Oy');
    expect(lista[0]?.asiakasId).toBe(asiakas.id);
  });

  it('sorts by pvm then viite and filters by laskupvm range', async () => {
    const s = seed();
    await tallennaMyyntilasku(s, { pvm: '2026-06-10', rivit: [yksiRivi] }, env);
    await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const kaikki = await listaaMyyntilaskut(s, {});
    expect(kaikki.map((r) => r.pvm)).toEqual(['2026-06-01', '2026-06-10']);
    const rajattu = await listaaMyyntilaskut(s, { alkupvm: '2026-06-05' });
    expect(rajattu).toHaveLength(1);
    expect(rajattu[0]?.pvm).toBe('2026-06-10');
  });

  it('eraantynyt returns only overdue invoices that are still open', async () => {
    const s = seed();
    // Overdue + open (LASKU, past due date).
    await tallennaMyyntilasku(
      s,
      { pvm: '2026-04-01', erapvm: '2026-05-01', rivit: [yksiRivi] },
      env,
    );
    // Not yet due (future due date) → excluded.
    await tallennaMyyntilasku(
      s,
      { pvm: '2026-06-01', erapvm: '2026-12-31', rivit: [yksiRivi] },
      env,
    );
    // Overdue but no open balance (cash sale, avoin 0) → excluded.
    await tallennaMyyntilasku(
      s,
      { pvm: '2026-04-01', erapvm: '2026-05-01', maksutapa: Maksutapa.KATEINEN, rivit: [yksiRivi] },
      env,
    );
    const eraantyneet = await listaaMyyntilaskut(s, { eraantynyt: '2026-06-15' });
    expect(eraantyneet).toHaveLength(1);
    expect(eraantyneet[0]?.erapvm).toBe('2026-05-01');
    expect(eraantyneet[0]?.avoin).toBe(12550);
  });

  it('avoin:true returns only invoices with an open balance', async () => {
    const s = seed();
    await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env); // LASKU, open
    await tallennaMyyntilasku(
      s,
      { pvm: '2026-06-02', maksutapa: Maksutapa.KATEINEN, rivit: [yksiRivi] },
      env,
    ); // cash → avoin 0
    const avoimet = await listaaMyyntilaskut(s, { avoin: true });
    expect(avoimet).toHaveLength(1);
    expect(avoimet[0]?.avoin).toBe(12550);
  });

  it('sorts same-pvm invoices by viite', async () => {
    const s = seed();
    const a = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const b = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const lista = await listaaMyyntilaskut(s, {});
    expect(lista.map((r) => r.viite)).toEqual([a.viite, b.viite].sort());
  });
});

describe('tallennaSuoritus', () => {
  const maksutili = { LaskuMaksutili: '1910' }; // 1910 = seeded cash/bank account

  it('posts a balanced two-leg payment that reduces avoin', async () => {
    const s = seed();
    await s.patchAsetukset(maksutili);
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const suoritus = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-15', summa: Euro.fromCents(2550) },
      env,
    );
    expect(suoritus.tyyppi).toBe(400); // TositeTyyppi.TILIOTE
    expect(suoritus.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
      suoritus.viennit.reduce((a, v) => a + v.kredit, 0),
    );
    // bank leg debits 1910, AR leg credits 1701 with the invoice era
    expect(suoritus.viennit.find((v) => v.tili === 1910)?.debet).toBe(2550);
    const arLeg = suoritus.viennit.find((v) => v.tili === 1701);
    expect(arLeg?.kredit).toBe(2550);
    expect(arLeg?.era).toBeTruthy();
    // avoin dropped from 12550 to 10000
    const lista = await listaaMyyntilaskut(s, {});
    expect(lista[0]?.avoin).toBe(10000);
  });

  it('rejects a non-positive amount with EISUMMAA', async () => {
    const s = seed();
    await s.patchAsetukset(maksutili);
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    await expect(
      tallennaSuoritus(s, { tosite: lasku.id, pvm: '2026-06-15', summa: Euro.fromCents(0) }, env),
    ).rejects.toMatchObject({ code: 'EISUMMAA' });
  });

  it('rejects a missing invoice with EITOSITETTA', async () => {
    const s = seed();
    await s.patchAsetukset(maksutili);
    await expect(
      tallennaSuoritus(s, { tosite: 999, pvm: '2026-06-15', summa: Euro.fromCents(100) }, env),
    ).rejects.toMatchObject({ code: 'EITOSITETTA' });
  });

  it('rejects a cash invoice (no era leg) with EIAVOINTAERAA', async () => {
    const s = seed();
    await s.patchAsetukset(maksutili);
    const kateinen = await tallennaMyyntilasku(
      s,
      { pvm: '2026-06-01', maksutapa: Maksutapa.KATEINEN, rivit: [yksiRivi] },
      env,
    );
    await expect(
      tallennaSuoritus(
        s,
        { tosite: kateinen.id, pvm: '2026-06-15', summa: Euro.fromCents(100) },
        env,
      ),
    ).rejects.toMatchObject({ code: 'EIAVOINTAERAA' });
  });

  it('rejects when no rahatili can be resolved with EILASKUTILIA', async () => {
    const s = seed(); // seed() sets no LaskuMaksutili
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    await expect(
      tallennaSuoritus(s, { tosite: lasku.id, pvm: '2026-06-15', summa: Euro.fromCents(100) }, env),
    ).rejects.toMatchObject({ code: 'EILASKUTILIA' });
  });
});

describe('tallennaSuoritus maksuperusteinen tunnistaminen', () => {
  const maksutili = { LaskuMaksutili: '1910' };

  it('täysi suoritus tunnistaa koko lykätyn alv:n oikealle alv-tilille', async () => {
    const s = seed(); // sisältää 2939 (BL, oikea alv-velka) ja 2949 (BLM, kohdentamaton)
    await s.patchAsetukset({ MaksuAlvAlkaa: '2026-01-01', ...maksutili });
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const maksu = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-15', summa: Euro.fromCents(12_550) },
      env,
    );
    // tunnistettu: oikea alv-velka kredit 2550 koodilla 118; kohdentamaton debet 2550 koodilla 418
    expect(maksu.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit).toBe(2_550);
    expect(maksu.viennit.find((v) => v.tili === 2949 && v.alvKoodi === 418)?.debet).toBe(2_550);
    expect(maksu.viennit.reduce((a, v) => a + v.debet, 0)).toBe(
      maksu.viennit.reduce((a, v) => a + v.kredit, 0),
    );
  });

  it('kaksi osasuoritusta tunnistavat suhteessa ja summautuvat täsmälleen lykättyyn veroon (ei kertymävirhettä)', async () => {
    const s = seed();
    await s.patchAsetukset({ MaksuAlvAlkaa: '2026-01-01', ...maksutili });
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const p1 = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-10', summa: Euro.fromCents(5_000) },
      env,
    );
    const p2 = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-20', summa: Euro.fromCents(7_550) },
      env,
    );
    const r1 = p1.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit ?? 0;
    const r2 = p2.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit ?? 0;
    // round(2550 * 5000/12550) = round(1015.9..) = 1016; loppuosa 1534; summa = 2550 täsmälleen
    expect(r1).toBe(1_016);
    expect(r2).toBe(1_534);
    expect(r1 + r2).toBe(2_550);
  });

  it('ylisuoritus ei tunnista enempää kuin lykätyn alv:n verran', async () => {
    const s = seed();
    await s.patchAsetukset({ MaksuAlvAlkaa: '2026-01-01', ...maksutili });
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const maksu = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-15', summa: Euro.fromCents(20_000) },
      env,
    );
    expect(maksu.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit).toBe(2_550);
  });

  it('suoriteperusteisen laskun suoritus ei kirjaa alv-tunnistusvientejä', async () => {
    const s = seed(); // ei MaksuAlvAlkaa -> suoriteperusteinen
    await s.patchAsetukset(maksutili);
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const maksu = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-15', summa: Euro.fromCents(12_550) },
      env,
    );
    expect(maksu.viennit).toHaveLength(2); // pankki + erä vain
  });

  it('ylisuorituksen jälkeinen lisäsuoritus ei tunnista fantomia (negatiivinen erän saldo pysyy)', async () => {
    const s = seed();
    await s.patchAsetukset({ MaksuAlvAlkaa: '2026-01-01', ...maksutili });
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const p1 = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-15', summa: Euro.fromCents(20_000) }, // ylisuoritus
      env,
    );
    const p2 = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-20', summa: Euro.fromCents(1_000) }, // lisäsuoritus
      env,
    );
    const r1 = p1.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit ?? 0;
    const r2 = p2.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit ?? 0;
    expect(r2).toBe(0); // koko lykätty vero jo tunnistettu p1:ssä
    expect(r1 + r2).toBe(2_550); // ei enempää kuin lykätty vero V
    // kohdentamaton alv-velkatili nettoutuu nollaan, ei mene miinukselle
    const netto2949 = lasku.viennit
      .concat(p1.viennit, p2.viennit)
      .filter((v) => v.tili === 2949)
      .reduce((a, v) => a + v.kredit - v.debet, 0);
    expect(netto2949).toBe(0);
  });

  it('osasuorituksen ja täyden hyvityslaskun jälkeinen suoritus ei tunnista lisää alv:a', async () => {
    const s = seed();
    await s.patchAsetukset({ MaksuAlvAlkaa: '2026-01-01', ...maksutili });
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const p1 = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-10', summa: Euro.fromCents(5_000) },
      env,
    );
    const r1 = p1.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit ?? 0;
    expect(r1).toBe(1_016);
    await tallennaHyvityslasku(s, { alkuperainenTosite: lasku.id, pvm: '2026-06-12' }, env);
    const p2 = await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-20', summa: Euro.fromCents(1_000) },
      env,
    );
    const r2 = p2.viennit.find((v) => v.tili === 2939 && v.alvKoodi === 118)?.kredit;
    expect(r2).toBeUndefined(); // ei uutta koodi-118-vientiä
    expect(r1).toBe(1_016); // kokonaistunnistus pysyy ennallaan
  });
});

describe('erä = tosite.id (nimiavaruuskorjaus)', () => {
  it('LASKU: saatavarivi kantaa era === tosite.id, ei numeroa', async () => {
    const s = seed();
    // Pakotetaan numero eroamaan tosite.id:stä, jotta ne ovat erotettavissa.
    await s.patchAsetukset({ LaskuNumerointialkaa: '5000' });
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    expect(lasku.numero).toBe('5000');
    const arLeg = lasku.viennit.find((v) => v.debet > 0);
    expect(arLeg?.era).toBe(lasku.id);
    expect(arLeg?.era).not.toBe(5000);
    // numero/viite eivät muutu korjauksen myötä
    expect(tarkistaViite(lasku.viite as string)).toBe(true);
  });

  it('LASKU: tallennettu tosite säilyttää era === id:n uudelleentallennuksen jälkeen (ei duplikaattia, tunniste säilyy)', async () => {
    const s = seed();
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    const haettu = await s.getTosite(lasku.id);
    const arLeg = haettu?.viennit.find((v) => v.debet > 0);
    expect(arLeg?.era).toBe(lasku.id);
    expect(haettu?.tunniste).toBe(lasku.tunniste);
    // täsmälleen kolme vientiä — uudelleentallennus päivittää paikallaan, ei lisää rivejä
    expect(haettu?.viennit).toHaveLength(3);
  });

  it('KATEINEN: käteismyynti ei avaa erää edelleenkään', async () => {
    const s = seed();
    const lasku = await tallennaMyyntilasku(
      s,
      { pvm: '2026-06-01', maksutapa: Maksutapa.KATEINEN, rivit: [yksiRivi] },
      env,
    );
    for (const v of lasku.viennit) expect(v.era).toBeUndefined();
  });

  it('suoritus nettoaa laskun avoimen 0:aan (era toimii arvoriippumattomasti)', async () => {
    const s = seed();
    const lasku = await tallennaMyyntilasku(s, { pvm: '2026-06-01', rivit: [yksiRivi] }, env);
    await s.patchAsetukset({ LaskuMaksutili: '1910' });
    await tallennaSuoritus(
      s,
      { tosite: lasku.id, pvm: '2026-06-05', summa: Euro.fromCents(12550) },
      env,
    );
    const lista = await listaaMyyntilaskut(s, {});
    expect(lista.find((r) => r.tosite === lasku.id)?.avoin).toBe(0);
  });
});
