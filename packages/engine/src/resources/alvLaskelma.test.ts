import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { TILITYS } from '../alv/koodit.js';
import { TositeTila, TositeTyyppi, VientiTyyppi } from '../vouchers/enums.js';
import { haeAlvLaskelma, laskeBruttoOikaisut, tallennaAlvTilitys } from './alvLaskelma.js';
import { muutaTositteenTila, tallennaTosite } from './tositeResource.js';

const c = (n: number): Cents => n as Cents;
const env = { aika: '2026-06-01T00:00:00.000Z' };

const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Arvonlisäverosaatava' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
      { numero: 2940, tyyppi: 'BV', nimi: { fi: 'Verovelka' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: { AlvVelvollinen: 'true' },
  });

/** Kotimaan nettomyynti: pankki debet brutto, myynti kredit netto (11), alv-velka kredit vero (111). */
const myynti = (pvm: string, netto: number, vero: number) => ({
  pvm,
  tyyppi: 0,
  sarja: '',
  viennit: [
    { tili: 1900, debet: c(netto + vero), kredit: c(0), pvm, alvKoodi: 0, alvProsentti: 0 },
    { tili: 3000, debet: c(0), kredit: c(netto), pvm, alvKoodi: 11, alvProsentti: 25.5 },
    { tili: 2939, debet: c(0), kredit: c(vero), pvm, alvKoodi: 111, alvProsentti: 25.5 },
  ],
});

/** Palveluiden yhteisöhankinta (käännetty verovelvollisuus): peruste 25, vero 125, vähennys 225. */
const euOsto = (pvm: string, netto: number, vero: number) => ({
  pvm,
  tyyppi: 0,
  sarja: '',
  viennit: [
    { tili: 4000, debet: c(netto), kredit: c(0), pvm, alvKoodi: 25, alvProsentti: 25.5 },
    { tili: 2939, debet: c(0), kredit: c(vero), pvm, alvKoodi: 125, alvProsentti: 25.5 },
    { tili: 1763, debet: c(vero), kredit: c(0), pvm, alvKoodi: 225, alvProsentti: 25.5 },
    { tili: 1900, debet: c(0), kredit: c(netto), pvm, alvKoodi: 0, alvProsentti: 0 },
  ],
});

/** Palveluosto EU:n ulkopuolelta (käänteinen alv): peruste 29, vero 129, vähennys 229. */
const euUlkoOsto = (pvm: string, netto: number, vero: number) => ({
  pvm,
  tyyppi: 0,
  sarja: '',
  viennit: [
    { tili: 4000, debet: c(netto), kredit: c(0), pvm, alvKoodi: 29, alvProsentti: 25.5 },
    { tili: 2939, debet: c(0), kredit: c(vero), pvm, alvKoodi: 129, alvProsentti: 25.5 },
    { tili: 1763, debet: c(vero), kredit: c(0), pvm, alvKoodi: 229, alvProsentti: 25.5 },
    { tili: 1900, debet: c(0), kredit: c(netto), pvm, alvKoodi: 0, alvProsentti: 0 },
  ],
});

const KAUSI = { alkupvm: '2026-06-01', loppupvm: '2026-06-30' };

describe('haeAlvLaskelma', () => {
  it('summaa kauden koodit ja laskee maksettavan (308)', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaTosite(s, euOsto('2026-06-10', 10000, 2550), env);
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(301)).toBe(2550);
    expect(t.koodit.get(306)).toBe(2550);
    expect(t.koodit.get(307)).toBe(2550);
    expect(t.koodit.get(314)).toBe(10000);
    expect(t.koodit.get(308)).toBe(2550);
    expect(t.maksettava).toBe(2550);
    expect(t.koodit.has(11)).toBe(false); // kuvaamaton peruste ei ilmoitu
  });

  it('käännetty verovelvollisuus nettoutuu maksettavassa nollaan', async () => {
    const s = seed();
    await tallennaTosite(s, euOsto('2026-06-10', 10000, 2550), env);
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(306)).toBe(2550);
    expect(t.koodit.get(307)).toBe(2550);
    expect(t.maksettava).toBe(0);
    expect(t.koodit.has(308)).toBe(false); // nolla-arvot pudotetaan
  });

  it('kirjaa EU:n ulkopuolisen palveluoston veron kotimaan myyntiin (301), ei EU-laatikoihin', async () => {
    const s = seed();
    await tallennaTosite(s, euUlkoOsto('2026-06-10', 10000, 2550), env);
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(301)).toBe(2550); // suoritettava vero kotimaan myyntinä
    expect(t.koodit.get(307)).toBe(2550); // vähennettävä vero
    expect(t.koodit.has(306)).toBe(false); // ei EU-palveluoston vero
    expect(t.koodit.has(314)).toBe(false); // ei EU-palveluoston peruste
    expect(t.maksettava).toBe(0); // nettoutuu nollaan
  });

  it('ei laske vähennyskelvotonta (932) vähennykseksi', async () => {
    const s = seed();
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: c(1000),
            kredit: c(0),
            pvm: '2026-06-10',
            alvKoodi: 932,
            alvProsentti: 25.5,
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(1000),
            pvm: '2026-06-10',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.has(307)).toBe(false);
    expect(t.maksettava).toBe(0);
  });

  it('rajaa kauden päivämäärillä ja ohittaa luonnokset', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-05-31', 10000, 2550), env); // ennen kautta
    await tallennaTosite(
      s,
      { ...myynti('2026-06-05', 10000, 2550), tila: TositeTila.LUONNOS },
      env,
    );
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.size).toBe(0);
    expect(t.maksettava).toBe(0);
  });
});

describe('tallennaAlvTilitys', () => {
  it('kirjaa kolmijalkaisen ALVLASKELMA-tositteen ja siirtää AlvIlmoitettu-rajan', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaTosite(s, euOsto('2026-06-10', 10000, 2550), env);
    const tosite = await tallennaAlvTilitys(s, KAUSI, env);

    expect(tosite.tyyppi).toBe(TositeTyyppi.ALVLASKELMA);
    expect(tosite.tila).toBe(100);
    expect(tosite.pvm).toBe('2026-06-30');
    expect(tosite.viennit).toHaveLength(3);
    expect(tosite.viennit.find((v) => v.tili === 2939)?.debet).toBe(5100); // vero pois alv-velalta
    expect(tosite.viennit.find((v) => v.tili === 1763)?.kredit).toBe(2550); // vähennys pois saatavalta
    expect(tosite.viennit.find((v) => v.tili === 2940)?.kredit).toBe(2550); // netto verovelalle
    expect(tosite.viennit.every((v) => v.alvKoodi === TILITYS)).toBe(true);
    const d = tosite.viennit.reduce((sum, v) => sum + v.debet, 0);
    const k = tosite.viennit.reduce((sum, v) => sum + v.kredit, 0);
    expect(d).toBe(k);

    expect((await s.getAsetukset()).AlvIlmoitettu).toBe('2026-06-30');
  });

  it('kirjaa kaksijalkaisen tositteen kun vähennyksiä ei ole', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    expect(tosite.viennit).toHaveLength(2);
    expect(tosite.viennit.find((v) => v.tili === 2939)?.debet).toBe(2550);
    expect(tosite.viennit.find((v) => v.tili === 2940)?.kredit).toBe(2550);
  });

  it('kirjaa palautuksen verovelan debetiin kun vähennys ylittää veron', async () => {
    const s = seed();
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: c(10000),
            kredit: c(0),
            pvm: '2026-06-10',
            alvKoodi: 21,
            alvProsentti: 25.5,
          },
          {
            tili: 1763,
            debet: c(2550),
            kredit: c(0),
            pvm: '2026-06-10',
            alvKoodi: 221,
            alvProsentti: 25.5,
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(12550),
            pvm: '2026-06-10',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    expect(tosite.viennit).toHaveLength(2);
    expect(tosite.viennit.find((v) => v.tili === 1763)?.kredit).toBe(2550);
    expect(tosite.viennit.find((v) => v.tili === 2940)?.debet).toBe(2550); // palautus = debet verovelalla
  });

  it('kirjaa negatiivisen veron alv-velan kreditiin (myynnin hyvityslasku)', async () => {
    const s = seed();
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 3000,
            debet: c(1000),
            kredit: c(0),
            pvm: '2026-06-10',
            alvKoodi: 11,
            alvProsentti: 25.5,
          },
          {
            tili: 2939,
            debet: c(255),
            kredit: c(0),
            pvm: '2026-06-10',
            alvKoodi: 111,
            alvProsentti: 25.5,
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(1255),
            pvm: '2026-06-10',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    // vero = kredit - debet = -255, vahennys = 0
    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    expect(tosite.viennit).toHaveLength(2);
    expect(tosite.viennit.find((v) => v.tili === 2939)?.kredit).toBe(255); // negatiivinen vero takaisin velalle
    expect(tosite.viennit.find((v) => v.tili === 2939)?.debet).toBe(0);
    expect(tosite.viennit.find((v) => v.tili === 2940)?.debet).toBe(255); // palautus = debet verovelalla
    expect(tosite.viennit.find((v) => v.tili === 2940)?.kredit).toBe(0);
  });

  it('kirjaa negatiivisen vähennyksen alv-saatavan debetiin (oston hyvityslasku)', async () => {
    const s = seed();
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-10',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 1900,
            debet: c(1255),
            kredit: c(0),
            pvm: '2026-06-10',
            alvKoodi: 0,
            alvProsentti: 0,
          },
          {
            tili: 4000,
            debet: c(0),
            kredit: c(1000),
            pvm: '2026-06-10',
            alvKoodi: 21,
            alvProsentti: 25.5,
          },
          {
            tili: 1763,
            debet: c(0),
            kredit: c(255),
            pvm: '2026-06-10',
            alvKoodi: 221,
            alvProsentti: 25.5,
          },
        ],
      },
      env,
    );
    // vahennys = debet - kredit = -255, vero = 0
    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    expect(tosite.viennit).toHaveLength(2);
    expect(tosite.viennit.find((v) => v.tili === 1763)?.debet).toBe(255); // negatiivinen vähennys takaisin saatavalle
    expect(tosite.viennit.find((v) => v.tili === 1763)?.kredit).toBe(0);
    expect(tosite.viennit.find((v) => v.tili === 2940)?.kredit).toBe(255); // maksettava = kredit verovelalla
    expect(tosite.viennit.find((v) => v.tili === 2940)?.debet).toBe(0);
  });

  it('hylkää tyhjän kauden (EITILITYSTA)', async () => {
    const s = seed();
    await expect(tallennaAlvTilitys(s, KAUSI, env)).rejects.toMatchObject({ code: 'EITILITYSTA' });
  });

  it('hylkää jo ilmoitetun kauden (JOILMOITETTU) eikä tuplakirjaa', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaAlvTilitys(s, KAUSI, env);
    await expect(tallennaAlvTilitys(s, KAUSI, env)).rejects.toMatchObject({ code: 'JOILMOITETTU' });
  });

  it('hylkää rajan yli menevän (päällekkäisen) kauden vaikka loppupvm on rajan jälkeen', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaAlvTilitys(s, KAUSI, env); // AlvIlmoitettu = 2026-06-30
    await expect(
      tallennaAlvTilitys(s, { alkupvm: '2026-06-01', loppupvm: '2026-07-31' }, env),
    ).rejects.toMatchObject({ code: 'JOILMOITETTU' });
  });

  it('sallii peräkkäisen kauden ilmoittamisen rajan jälkeen', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaAlvTilitys(s, KAUSI, env); // AlvIlmoitettu = 2026-06-30
    await tallennaTosite(s, myynti('2026-07-10', 10000, 2550), env);
    const tosite = await tallennaAlvTilitys(
      s,
      { alkupvm: '2026-07-01', loppupvm: '2026-07-31' },
      env,
    );
    expect(tosite.tyyppi).toBe(TositeTyyppi.ALVLASKELMA);
    expect((await s.getAsetukset()).AlvIlmoitettu).toBe('2026-07-31');
  });

  it('torjuu uusintayrityksen, kun raja jäi siirtämättä (patch ei tallentunut)', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaAlvTilitys(s, KAUSI, env);
    // Simuloidaan tallennaTosite+patchAsetukset-parin epäatomisuus: raja "katosi"
    // (esim. patch epäonnistui tai kilpaileva pyyntö nollasi sen), mutta tilitys
    // on jo kirjattu kirjanpitoon. Rajavahti (joka tulkitsee '' ilmoittamattomaksi)
    // päästäisi uusintayrityksen läpi ilman listTositteet-varakeinoa.
    await s.patchAsetukset({ AlvIlmoitettu: '' });
    await expect(tallennaAlvTilitys(s, KAUSI, env)).rejects.toMatchObject({ code: 'JOILMOITETTU' });
  });

  it('vaatii puuttuvan ALV-tilin vain tarvittaessa (EIALVTILIA)', async () => {
    const s = createMemoryStorage({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
        { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { AlvVelvollinen: 'true' },
    });
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    // vero != vahennys ja Verovelka (BV) puuttuu -> EIALVTILIA
    await expect(tallennaAlvTilitys(s, KAUSI, env)).rejects.toMatchObject({ code: 'EIALVTILIA' });
  });

  it('tilityksen jälkeen alv-koodattu vienti kaudelle estyy (PVMALV -> EIVALMISTU), tavallinen ei', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaAlvTilitys(s, KAUSI, env);
    await expect(tallennaTosite(s, myynti('2026-06-20', 1000, 255), env)).rejects.toMatchObject({
      code: 'EIVALMISTU',
    });
    // alv-koodETON vienti samalle kaudelle kirjautuu yhä
    await expect(
      tallennaTosite(
        s,
        {
          pvm: '2026-06-20',
          tyyppi: 0,
          sarja: '',
          viennit: [
            {
              tili: 1900,
              debet: c(500),
              kredit: c(0),
              pvm: '2026-06-20',
              alvKoodi: 0,
              alvProsentti: 0,
            },
            {
              tili: 3000,
              debet: c(0),
              kredit: c(500),
              pvm: '2026-06-20',
              alvKoodi: 0,
              alvProsentti: 0,
            },
          ],
        },
        env,
      ),
    ).resolves.toMatchObject({ tila: 100 });
  });

  it('tilityksen jälkeen luonnoksen valmistuminen kaudelle estyy (PVMALV -> EIVALMISTU)', async () => {
    const s = seed();
    const draft = await tallennaTosite(
      s,
      { ...myynti('2026-06-15', 1000, 255), tila: TositeTila.LUONNOS },
      env,
    );
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env);
    await tallennaAlvTilitys(s, KAUSI, env);
    await expect(muutaTositteenTila(s, draft.id, 100, env)).rejects.toMatchObject({
      code: 'EIVALMISTU',
    });
  });
});

/**
 * Bruttokirjaus (12/22): koko verollinen summa tulo-/menotilille ilman alv-vientiä
 * (generoiVeroviennit ohittaa vero-osuuden). Vero erotetaan kaudelta alv-laskelmassa.
 * Positiivinen `summa` = normaali myynti/osto, negatiivinen = hyvitys.
 */
const brutto = (
  pvm: string,
  summa: number,
  prosentti: number,
  opts: { koodi?: 12 | 22; tili?: number } = {},
) => {
  const koodi = opts.koodi ?? 12;
  const myynti = koodi === 12;
  const tili = opts.tili ?? (myynti ? 3000 : 4000);
  // Tulo-/menotilin puoli: myynti kredit, osto debet; hyvitys kääntää.
  const tiliKreditiin = myynti === summa > 0;
  const m = Math.abs(summa);
  return {
    pvm,
    tyyppi: myynti ? TositeTyyppi.TULO : TositeTyyppi.MENO,
    sarja: '',
    viennit: [
      {
        tili: 1900,
        debet: c(tiliKreditiin ? m : 0),
        kredit: c(tiliKreditiin ? 0 : m),
        pvm,
        alvKoodi: 0,
        alvProsentti: 0,
      },
      {
        tili,
        debet: c(tiliKreditiin ? 0 : m),
        kredit: c(tiliKreditiin ? m : 0),
        pvm,
        alvKoodi: koodi,
        alvProsentti: prosentti,
      },
    ],
  };
};

/** Debet-positiivinen raakasaldo tileittäin koko vuodelta. */
const saldot = (s: ReturnType<typeof seed>) => s.querySaldot({ loppupvm: '2026-12-31' });

const tasapainossa = (viennit: readonly { debet: number; kredit: number }[]) => {
  const d = viennit.reduce((sum, v) => sum + v.debet, 0);
  const k = viennit.reduce((sum, v) => sum + v.kredit, 0);
  expect(d).toBe(k);
};

describe('bruttokirjaukset alv-laskelmassa (koodit 12/22)', () => {
  // Golden: kitsas-source/unittest/AlvLaskelmaTesti/tst_alvlaskelma.cpp:89-132 (bruttoMyynti)
  it('bruttomyynti 124,00 @ 24 %: 301 = 24,00, maksettava 24,00; tilityksen jälkeen myynti 100,00', async () => {
    const s = seed();
    await tallennaTosite(s, brutto('2026-06-10', 12400, 24), env);
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(301)).toBe(2400);
    expect(t.koodit.get(308)).toBe(2400);
    expect(t.maksettava).toBe(2400);

    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    tasapainossa(tosite.viennit);
    const sa = await saldot(s);
    expect(sa.get(3000)).toBe(-10000); // myynti 100,00 (kredit)
    expect(sa.get(2939) ?? 0).toBe(0); // alv-velka nollautuu
    expect(sa.get(2940)).toBe(-2400); // verovelka 24,00
  });

  // Golden: tst_alvlaskelma.cpp:134-174 (bruttoOsto)
  it('brutto-osto 124,00 @ 24 %: 307 = 24,00, maksettava −24,00; tilityksen jälkeen osto 100,00', async () => {
    const s = seed();
    await tallennaTosite(s, brutto('2026-06-10', 12400, 24, { koodi: 22 }), env);
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(307)).toBe(2400);
    expect(t.koodit.get(308)).toBe(-2400);
    expect(t.maksettava).toBe(-2400);

    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    tasapainossa(tosite.viennit);
    const sa = await saldot(s);
    expect(sa.get(4000)).toBe(10000);
    expect(sa.get(1763) ?? 0).toBe(0);
    expect(sa.get(2940)).toBe(2400); // palautettava = debet verovelalla
  });

  // Golden: tst_alvlaskelma.cpp:285-317 (alijaamahyvitys) — vain 301-osuus; alarajahuojennus
  // (315-317) päättyi 1.1.2025 eikä Penni laske sitä.
  it('bruttomyynti 18 600,00 @ 24 %: 301 = 3 600,00', async () => {
    const s = seed();
    await tallennaTosite(s, brutto('2026-06-10', 1860000, 24), env);
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(301)).toBe(360000);
  });

  it('todellinen tapaus: 9 755,43 @ 25,5 % -> vero 1 982,18 (netto 7 773,25)', async () => {
    const s = seed();
    await tallennaTosite(s, brutto('2026-06-10', 975543, 25.5), env);
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(301)).toBe(198218);
    expect(t.maksettava).toBe(198218);

    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    const pois = tosite.viennit.find((v) => v.tili === 3000);
    expect(pois).toMatchObject({ debet: 198218, kredit: 0, alvKoodi: 12, alvProsentti: 25.5 });
    expect(pois?.tyyppi).toBe(VientiTyyppi.BRUTTOOIKAISU);
    expect(pois?.selite).toContain('Bruttomyyntien oikaisu 3000 Myynti');
    expect(tosite.viennit.find((v) => v.alvKoodi === 112)).toMatchObject({
      tili: 2939,
      debet: 0,
      kredit: 198218,
      alvProsentti: 25.5,
      tyyppi: VientiTyyppi.BRUTTOOIKAISU,
    });
    expect((await saldot(s)).get(3000)).toBe(-777325);
  });

  it('pyöristää tilin ja kannan summasta, ei tositteittain (alvlaskelma.cpp:1023-1029)', async () => {
    const s = seed();
    // 2 × 1,00 € brutto @ 25,5 %: tositteittain 0,20 + 0,20 = 0,40; summasta 2,00 -> 0,41.
    await tallennaTosite(s, brutto('2026-06-05', 100, 25.5), env);
    await tallennaTosite(s, brutto('2026-06-06', 100, 25.5), env);
    expect((await haeAlvLaskelma(s, KAUSI)).koodit.get(301)).toBe(41);
  });

  it('eri tilit ja kannat pyöristetään erikseen; kanta ohjaa 301/302-koodiin', async () => {
    const s = seed();
    await s.putTili(3010, { numero: 3010, tyyppi: 'CL', nimi: { fi: 'Myynti 2' } });
    await tallennaTosite(s, brutto('2026-06-05', 100, 25.5), env);
    await tallennaTosite(s, brutto('2026-06-06', 100, 25.5, { tili: 3010 }), env);
    await tallennaTosite(s, brutto('2026-06-07', 11400, 14), env);
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(301)).toBe(40); // 20 + 20 (tileittäin)
    expect(t.koodit.get(302)).toBe(1400);
    expect(t.maksettava).toBe(1440);
  });

  it('hyvitys (negatiivinen bruttomyynti) pienentää veroa', async () => {
    const s = seed();
    await tallennaTosite(s, brutto('2026-06-05', 25100, 25.5), env); // 251,00
    await tallennaTosite(s, brutto('2026-06-06', -12550, 25.5), env); // hyvitys 125,50
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(301)).toBe(2550); // summasta 125,50 -> 25,50
    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    tasapainossa(tosite.viennit);
    expect((await saldot(s)).get(3000)).toBe(-10000);
  });

  it('netto- ja bruttokirjaukset samalla kaudella (myynti ja osto)', async () => {
    const s = seed();
    await tallennaTosite(s, myynti('2026-06-05', 10000, 2550), env); // netto 100,00 + 25,50
    await tallennaTosite(s, brutto('2026-06-06', 12550, 25.5), env); // brutto 125,50
    await tallennaTosite(s, brutto('2026-06-07', 1255, 25.5, { koodi: 22 }), env); // brutto 12,55
    await tallennaTosite(
      s,
      {
        pvm: '2026-06-08',
        tyyppi: 0,
        sarja: '',
        viennit: [
          {
            tili: 4000,
            debet: c(2000),
            kredit: c(0),
            pvm: '2026-06-08',
            alvKoodi: 21,
            alvProsentti: 25.5,
          },
          {
            tili: 1763,
            debet: c(510),
            kredit: c(0),
            pvm: '2026-06-08',
            alvKoodi: 221,
            alvProsentti: 25.5,
          },
          {
            tili: 1900,
            debet: c(0),
            kredit: c(2510),
            pvm: '2026-06-08',
            alvKoodi: 0,
            alvProsentti: 0,
          },
        ],
      },
      env,
    );
    const t = await haeAlvLaskelma(s, KAUSI);
    expect(t.koodit.get(301)).toBe(5100); // 25,50 netosta + 25,50 brutosta
    expect(t.koodit.get(307)).toBe(765); // 5,10 netosta + 2,55 brutosta
    expect(t.maksettava).toBe(4335);

    const tosite = await tallennaAlvTilitys(s, KAUSI, env);
    tasapainossa(tosite.viennit);
    // 2 oikaisuparia + 3 tilitysvientiä
    expect(tosite.viennit).toHaveLength(7);
    expect(tosite.viennit.filter((v) => v.tyyppi === VientiTyyppi.BRUTTOOIKAISU)).toHaveLength(4);
    expect(tosite.viennit.find((v) => v.alvKoodi === 22)).toMatchObject({
      tili: 4000,
      debet: 0,
      kredit: 255,
    });
    expect(tosite.viennit.find((v) => v.alvKoodi === 222)).toMatchObject({
      tili: 1763,
      debet: 255,
      kredit: 0,
    });
    const sa = await saldot(s);
    expect(sa.get(3000)).toBe(-20000); // molemmat myynnit nettona
    expect(sa.get(4000)).toBe(3000); // 20,00 + 10,00 nettona
    expect(sa.get(2939) ?? 0).toBe(0);
    expect(sa.get(1763) ?? 0).toBe(0);
    expect(sa.get(2940)).toBe(-4335);

    // Tilitetyn kauden uudelleenlaskenta ei tuplaa bruttoveroa (BRUTTOOIKAISU ohitetaan).
    const uudelleen = await haeAlvLaskelma(s, KAUSI);
    expect(uudelleen.koodit).toEqual(t.koodit);
    expect(uudelleen.maksettava).toBe(4335);
  });

  it('vaatii alv-saatavatilin brutto-ostojen oikaisuun (EIALVTILIA)', async () => {
    const s = createMemoryStorage({
      tilit: [
        { numero: 1900, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
        { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
        { numero: 2940, tyyppi: 'BV', nimi: { fi: 'Verovelka' } },
        { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
      ],
      tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
      asetukset: { AlvVelvollinen: 'true' },
    });
    await tallennaTosite(s, brutto('2026-06-10', 12400, 24, { koodi: 22 }), env);
    await expect(tallennaAlvTilitys(s, KAUSI, env)).rejects.toMatchObject({ code: 'EIALVTILIA' });
  });
});

describe('laskeBruttoOikaisut', () => {
  it('ryhmittelee koodin, kannan ja tilin mukaan, myynnit ennen ostoja', () => {
    const v = (tili: number, debet: number, kredit: number, alvKoodi: number, p: number) => ({
      tili,
      debet: c(debet),
      kredit: c(kredit),
      pvm: '2026-06-01',
      alvKoodi,
      alvProsentti: p,
    });
    const o = laskeBruttoOikaisut([
      v(4000, 1255, 0, 22, 25.5),
      v(3010, 0, 100, 12, 25.5),
      v(3000, 0, 100, 12, 25.5),
      v(3000, 0, 100, 12, 25.5),
      v(3000, 0, 11400, 12, 14),
      v(3000, 999, 0, 12, 25.5),
      { ...v(3000, 50, 0, 12, 25.5), tyyppi: VientiTyyppi.BRUTTOOIKAISU }, // ohitetaan
      v(3000, 0, 100, 11, 25.5), // nettokoodi ohitetaan
    ]);
    expect(o.map((r) => [r.alvKoodi, r.kanta, r.tili, r.brutto, r.vero])).toEqual([
      [12, 1400, 3000, 11400, 1400],
      [12, 2550, 3000, -799, -162], // netto = qRound64(−636,65) = −637
      [12, 2550, 3010, 100, 20],
      [22, 2550, 4000, 1255, 255],
    ]);
  });
});
