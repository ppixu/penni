import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import { AlvKoodi } from '../alv/koodit.js';
import { TositeTila, TositeTyyppi } from '../vouchers/enums.js';
import { listaaOstolaskut, tallennaOstolasku } from './ostolaskuResource.js';
import { listaaMenot, listaaTulot } from './tulotResource.js';

// Chart mirrors the reference book: CL = income, BY = equity/liability (yksityissijoitus),
// BL = ALV payable, ARP = bank, D = expense, AL = ALV receivable.
const seed = () =>
  createMemoryStorage({
    tilit: [
      { numero: 1910, tyyppi: 'ARP', nimi: { fi: 'Pankkitili' } },
      { numero: 1763, tyyppi: 'AL', nimi: { fi: 'Alv-saatava' } },
      { numero: 2361, tyyppi: 'BY', nimi: { fi: 'Yksityissijoitukset rahana' } },
      { numero: 2939, tyyppi: 'BL', nimi: { fi: 'Arvonlisäverovelka' } },
      { numero: 3000, tyyppi: 'CL', nimi: { fi: 'Myynti' } },
      { numero: 4000, tyyppi: 'D', nimi: { fi: 'Ostot' } },
    ],
    tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
    asetukset: {},
  });

const env = { aika: '2026-06-01T00:00:00.000Z' };

/** Direct sale: 100,00 net + 25,50 alv straight into the bank. */
const myynti = {
  pvm: '2026-03-01',
  tyyppi: TositeTyyppi.TULO,
  tila: TositeTila.KIRJANPIDOSSA,
  tunniste: 0,
  sarja: '',
  otsikko: 'Revontuli',
  viennit: [
    { tili: 1910, debet: 12550, kredit: 0, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
    { tili: 3000, debet: 0, kredit: 10000, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
    { tili: 2939, debet: 0, kredit: 2550, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
  ],
};

/** Owner puts own money in: touches no income account. */
const yksityissijoitus = {
  pvm: '2026-03-02',
  tyyppi: TositeTyyppi.TULO,
  tila: TositeTila.KIRJANPIDOSSA,
  tunniste: 0,
  sarja: '',
  otsikko: 'Yksityissijoitus',
  viennit: [
    { tili: 1910, debet: 7000, kredit: 0, pvm: '2026-03-02', alvKoodi: 0, alvProsentti: 0 },
    { tili: 2361, debet: 0, kredit: 7000, pvm: '2026-03-02', alvKoodi: 0, alvProsentti: 0 },
  ],
};

describe('listaaTulot', () => {
  it('ottaa mukaan tulotilille kirjatun myynnin ja erittelee netto/alv/summa', async () => {
    const storage = seed();
    await storage.saveTosite(myynti, env);

    const rivit = await listaaTulot(storage, {});

    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.netto).toBe(Euro.fromCents(10000));
    expect(rivit[0]?.alv).toBe(Euro.fromCents(2550));
    expect(rivit[0]?.summa).toBe(Euro.fromCents(12550));
    expect(rivit[0]?.otsikko).toBe('Revontuli');
  });

  it('jättää yksityissijoituksen pois — se ei kosketa tulotiliä', async () => {
    const storage = seed();
    await storage.saveTosite(myynti, env);
    await storage.saveTosite(yksityissijoitus, env);

    const rivit = await listaaTulot(storage, {});

    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.otsikko).toBe('Revontuli');
  });

  it('antaa avoin = 0 kun tositteella ei ole erää', async () => {
    const storage = seed();
    await storage.saveTosite(myynti, env);

    const rivit = await listaaTulot(storage, {});

    expect(rivit[0]?.avoin).toBe(Euro.fromCents(0));
    expect(rivit[0]?.era).toBeUndefined();
  });

  it('suodattaa avoimet pois kun avoin-lippu on päällä', async () => {
    const storage = seed();
    await storage.saveTosite(myynti, env);

    expect(await listaaTulot(storage, { avoin: true })).toHaveLength(0);
  });

  it('rajaa päivämäärävälillä', async () => {
    const storage = seed();
    await storage.saveTosite(myynti, env);

    expect(await listaaTulot(storage, { alkupvm: '2026-04-01' })).toHaveLength(0);
    expect(await listaaTulot(storage, { loppupvm: '2026-03-01' })).toHaveLength(1);
  });
});

describe('listaaTulot / listaaMenot — luonnokset ja liitteet', () => {
  /** Täsmäytys kirjaa kuittitositteen luonnokseksi (kuittiTosite.ts); se näkyy Menoissa. */
  const menoLuonnos = {
    pvm: '2026-03-05',
    tyyppi: TositeTyyppi.MENO,
    tila: TositeTila.LUONNOS,
    tunniste: 0,
    sarja: '',
    otsikko: 'Kahvila',
    viennit: [
      { tili: 4000, debet: 800, kredit: 0, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
      { tili: 1763, debet: 200, kredit: 0, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
      { tili: 1910, debet: 0, kredit: 1000, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
    ],
  };

  it('näyttää luonnoksen tila-tiedon kanssa, kirjattujen joukossa päivän mukaan', async () => {
    const storage = seed();
    await storage.saveTosite(menoLuonnos, env);
    await storage.saveTosite(
      {
        ...menoLuonnos,
        pvm: '2026-03-01',
        tila: TositeTila.KIRJANPIDOSSA,
        otsikko: 'Kirjattu',
        viennit: menoLuonnos.viennit.map((v) => ({ ...v, pvm: '2026-03-01' })),
      },
      env,
    );

    const rivit = await listaaMenot(storage, {});

    expect(rivit.map((r) => [r.otsikko, r.tila])).toEqual([
      ['Kirjattu', TositeTila.KIRJANPIDOSSA],
      ['Kahvila', TositeTila.LUONNOS],
    ]);
    expect(rivit[1]?.summa).toBe(Euro.fromCents(1000));
    expect(rivit[1]?.avoin).toBe(Euro.fromCents(0));
  });

  it('ei näytä poistettuja, saapuneita eikä mallipohjia', async () => {
    const storage = seed();
    for (const tila of [TositeTila.POISTETTU, TositeTila.MALLIPOHJA, TositeTila.SAAPUNUT]) {
      await storage.saveTosite({ ...menoLuonnos, tila }, env);
    }

    expect(await listaaMenot(storage, {})).toEqual([]);
  });

  it('luonnos ei päädy avoimiin eikä erääntyneisiin', async () => {
    const storage = seed();
    await storage.saveTosite({ ...menoLuonnos, erapvm: '2026-03-10' }, env);

    expect(await listaaMenot(storage, { avoin: true })).toEqual([]);
    expect(await listaaMenot(storage, { eraantynyt: '2026-06-01' })).toEqual([]);
  });

  it('kertoo rivin liitemäärän (0 kun liitettä ei ole)', async () => {
    const storage = seed();
    const kuitillinen = await storage.saveTosite(menoLuonnos, env);
    await storage.saveTosite({ ...menoLuonnos, otsikko: 'Ilman kuittia' }, env);
    await storage.saveLiite({
      tosite: kuitillinen.id,
      nimi: 'kuitti.jpg',
      tyyppi: 'image/jpeg',
      luotu: '2026-03-05T00:00:00.000Z',
      data: new Uint8Array([1]),
    });

    const rivit = await listaaMenot(storage, {});

    expect(rivit.map((r) => [r.otsikko, r.liitteita])).toEqual([
      ['Kahvila', 1],
      ['Ilman kuittia', 0],
    ]);
  });
});

describe('listaaTulot — erikoistapaukset', () => {
  it('näyttää hyvityksen negatiivisena', async () => {
    const storage = seed();
    await storage.saveTosite(
      {
        pvm: '2026-03-10',
        tyyppi: TositeTyyppi.HYVITYSLASKU,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Hyvitys',
        viennit: [
          { tili: 3000, debet: 5000, kredit: 0, pvm: '2026-03-10', alvKoodi: 0, alvProsentti: 0 },
          { tili: 1910, debet: 0, kredit: 5000, pvm: '2026-03-10', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
      env,
    );

    const rivit = await listaaTulot(storage, {});

    expect(rivit[0]?.netto).toBe(Euro.fromCents(-5000));
  });

  it('hyvityslaskun rivi kantaa alkuperäisen tositteen id:n, muut rivit eivät', async () => {
    const storage = seed();
    const hyvitysViennit = [
      { tili: 3000, debet: 5000, kredit: 0, pvm: '2026-03-10', alvKoodi: 0, alvProsentti: 0 },
      { tili: 1910, debet: 0, kredit: 5000, pvm: '2026-03-10', alvKoodi: 0, alvProsentti: 0 },
    ];
    await storage.saveTosite(
      {
        pvm: '2026-03-10',
        tyyppi: TositeTyyppi.HYVITYSLASKU,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Hyvitys alkuperäisellä',
        alkuperainenTosite: 42,
        viennit: hyvitysViennit,
      },
      env,
    );
    await storage.saveTosite(
      {
        pvm: '2026-03-11',
        tyyppi: TositeTyyppi.HYVITYSLASKU,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Hyvitys ilman alkuperäistä',
        viennit: hyvitysViennit.map((v) => ({ ...v, pvm: '2026-03-11' })),
      },
      env,
    );

    const rivit = await listaaTulot(storage, {});

    expect(rivit.find((r) => r.otsikko === 'Hyvitys alkuperäisellä')?.alkuperainenTosite).toBe(42);
    expect(rivit.find((r) => r.otsikko === 'Hyvitys ilman alkuperäistä')).not.toHaveProperty(
      'alkuperainenTosite',
    );
  });

  it('näkyy molemmissa listoissa kun tosite koskettaa sekä tuloa että menoa', async () => {
    const storage = seed();
    await storage.saveTosite(
      {
        pvm: '2026-03-12',
        tyyppi: TositeTyyppi.MUISTIO,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Oikaisu',
        viennit: [
          { tili: 3000, debet: 0, kredit: 3000, pvm: '2026-03-12', alvKoodi: 0, alvProsentti: 0 },
          { tili: 4000, debet: 3000, kredit: 0, pvm: '2026-03-12', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
      env,
    );

    expect(await listaaTulot(storage, {})).toHaveLength(1);
    expect(await listaaMenot(storage, {})).toHaveLength(1);
  });

  it('suodattaa kumppanin mukaan', async () => {
    const storage = seed();
    const kumppani = await storage.saveKumppani({ nimi: 'Revontuli Oy' });
    await storage.saveTosite({ ...myynti, kumppani: kumppani.id }, env);

    expect(await listaaTulot(storage, { kumppani: kumppani.id })).toHaveLength(1);
    expect(await listaaTulot(storage, { kumppani: kumppani.id + 1 })).toHaveLength(0);
    expect((await listaaTulot(storage, {}))[0]?.kumppaniNimi).toBe('Revontuli Oy');
  });

  it('eraantynyt-suodatin ei palauta mitään kun eriä ei ole', async () => {
    const storage = seed();
    await storage.saveTosite(myynti, env);

    expect(await listaaTulot(storage, { eraantynyt: '2099-01-01' })).toHaveLength(0);
  });
});

describe('listaaMenot', () => {
  it('poimii menotilin veloituksen debet-positiivisena', async () => {
    const storage = seed();
    await storage.saveTosite(
      {
        pvm: '2026-03-05',
        tyyppi: TositeTyyppi.MENO,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Ostot',
        viennit: [
          { tili: 4000, debet: 8000, kredit: 0, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
          { tili: 1763, debet: 2040, kredit: 0, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
          { tili: 1910, debet: 0, kredit: 10040, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
      env,
    );

    const rivit = await listaaMenot(storage, {});

    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.netto).toBe(Euro.fromCents(8000));
    expect(rivit[0]?.alv).toBe(Euro.fromCents(2040));
    expect(rivit[0]?.summa).toBe(Euro.fromCents(10040));
  });

  it('ei näy Tuloissa', async () => {
    const storage = seed();
    await storage.saveTosite(myynti, env);

    expect(await listaaMenot(storage, {})).toHaveLength(0);
  });

  it('avoin ostovelka näkyy positiivisena velkatilillä, joka ei ala numerolla 1 (2870, BO)', async () => {
    const storage = seed();
    // 2870 Ostovelat: chart tyyppi BO -> Luonne.OSTOVELKA. Numero ei ala '1':lla, joten
    // normalisoiSaldo joutuu kääntämään merkin — ilman sitä avoin näkyisi negatiivisena.
    await storage.putTili(2870, { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } });

    const posted = await storage.saveTosite(
      {
        pvm: '2026-03-05',
        tyyppi: TositeTyyppi.MENO,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Ostolasku',
        viennit: [
          { tili: 4000, debet: 10040, kredit: 0, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
          { tili: 2870, debet: 0, kredit: 10040, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
      env,
    );
    // Kaksivaiheinen tallennus: velkarivin era = tosite.id, kuten tallennaOstolasku tekee
    // (ostolaskuResource.ts:99-103).
    const viennitEralla = posted.viennit.map((v) =>
      v.tili === 2870 ? { ...v, era: posted.id } : v,
    );
    await storage.saveTosite({ ...posted, viennit: viennitEralla }, env);

    const rivit = await listaaMenot(storage, {});

    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.avoin).toBe(Euro.fromCents(10040));
  });
});

describe('listaaMenot — käänteinen alv (reverse charge)', () => {
  it('vähennysoikeudellinen: ALVSAATAVA ja ALVVELKA kumoavat, summa täsmää listaaOstolaskutin kanssa', async () => {
    const storage = seed();
    await storage.putTili(2870, { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } });

    // Palveluiden yhteisöhankinta, netto 10,00 €, 25,5 % — kaanteinen: generoiVeroviennit
    // kirjaa sekä ALVSAATAVA-debetin (vähennettävä) että ALVVELKA-kreditin (itseverotettu
    // myynti) samalle 2,55 €:lle. Ostajan todellinen velka toimittajalle on silti vain netto
    // (tallennaOstolasku:n velkaMaara = Σ(debet−kredit) yli näiden kahden vero-viennin = 0).
    await tallennaOstolasku(
      storage,
      {
        pvm: '2026-03-05',
        rivit: [
          {
            myyntiKpl: 1,
            aNetto: 10,
            alvKoodi: AlvKoodi.YHTEISOHANKINNAT_PALVELUT,
            alvProsentti: 25.5,
            tili: 4000,
          },
        ],
      },
      env,
    );

    // Ankkuri: listaaOstolaskut on jo tunnetusti oikein (velka.kredit = pelkkä netto).
    const ostolaskut = await listaaOstolaskut(storage, {});
    expect(ostolaskut).toHaveLength(1);
    expect(ostolaskut[0]?.summa).toBe(Euro.fromCents(1000));

    const rivit = await listaaMenot(storage, {});
    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.netto).toBe(Euro.fromCents(1000));
    expect(rivit[0]?.alv).toBe(Euro.fromCents(0)); // 255 (ALVSAATAVA) − 255 (ALVVELKA)
    expect(rivit[0]?.summa).toBe(Euro.fromCents(1000)); // sama kuin listaaOstolaskut, ei 1255
  });

  it('ilman vähennysoikeutta: vero on kapitalisoitu nettoon, summa on silti todellinen loppusumma', async () => {
    const storage = seed();
    await storage.putTili(2870, { numero: 2870, tyyppi: 'BO', nimi: { fi: 'Ostovelat' } });
    // OstolaskuSyote ei altista alvVahennys-lippua, joten tämä tosite rakennetaan käsin —
    // sama muoto kuin generoiVeroviennit tuottaisi alvVahennys: false:lla (ks.
    // generoiVeroviennit.ts:187-201): vero menee kanta-tilille (debet, sama puoli kuin
    // netto), ei ALVSAATAVA-tilille; ALVVELKA saa silti kredit-vastakirjauksen.
    const posted = await storage.saveTosite(
      {
        pvm: '2026-03-06',
        tyyppi: TositeTyyppi.MENO,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Käänteinen osto ilman vähennysoikeutta',
        viennit: [
          { tili: 4000, debet: 1255, kredit: 0, pvm: '2026-03-06', alvKoodi: 0, alvProsentti: 0 },
          { tili: 2939, debet: 0, kredit: 255, pvm: '2026-03-06', alvKoodi: 0, alvProsentti: 0 },
          { tili: 2870, debet: 0, kredit: 1000, pvm: '2026-03-06', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
      env,
    );
    const viennitEralla = posted.viennit.map((v) =>
      v.tili === 2870 ? { ...v, era: posted.id } : v,
    );
    await storage.saveTosite({ ...posted, viennit: viennitEralla }, env);

    const rivit = await listaaMenot(storage, {});
    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.netto).toBe(Euro.fromCents(1255)); // vero kapitalisoitu kanta-tilille
    expect(rivit[0]?.alv).toBe(Euro.fromCents(-255)); // 0 (ALVSAATAVA) − 255 (ALVVELKA)
    expect(rivit[0]?.summa).toBe(Euro.fromCents(1000)); // netto + alv = todellinen velka
  });
});

describe('avoin — merkin normalisointi ja eräsuodattimet', () => {
  it('avoin myyntisaatava näkyy positiivisena saatavatilillä (1700, AO)', async () => {
    const storage = seed();
    // 1700 Myyntisaamiset: chart tyyppi AO -> Luonne.MYYNTISAATAVA. Numero alkaa '1':lla, joten
    // tämä olisi näyttänyt oikein jo ilman normalisointia — testi vartioi ettei korjaus riko sitä.
    await storage.putTili(1700, { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' } });

    const posted = await storage.saveTosite(
      {
        pvm: '2026-03-01',
        tyyppi: TositeTyyppi.MYYNTILASKU,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Lasku',
        viennit: [
          { tili: 1700, debet: 12550, kredit: 0, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
          { tili: 3000, debet: 0, kredit: 10000, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
          { tili: 2939, debet: 0, kredit: 2550, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
      env,
    );
    // Kaksivaiheinen tallennus: saatavarivin era = tosite.id, kuten tallennaMyyntilasku tekee
    // (myyntilaskuResource.ts:153-157).
    const viennitEralla = posted.viennit.map((v) =>
      v.tili === 1700 ? { ...v, era: posted.id } : v,
    );
    await storage.saveTosite({ ...posted, viennit: viennitEralla }, env);

    const rivit = await listaaTulot(storage, {});

    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.avoin).toBe(Euro.fromCents(12550));
  });

  it('saldopvm rajaa erän saldon annettuun päivään asti', async () => {
    const storage = seed();
    await storage.putTili(1700, { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' } });

    const posted = await storage.saveTosite(
      {
        pvm: '2026-03-01',
        tyyppi: TositeTyyppi.MYYNTILASKU,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Lasku',
        viennit: [
          { tili: 1700, debet: 10000, kredit: 0, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
          { tili: 3000, debet: 0, kredit: 10000, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
      env,
    );
    const viennitEralla = posted.viennit.map((v) =>
      v.tili === 1700 ? { ...v, era: posted.id } : v,
    );
    await storage.saveTosite({ ...posted, viennit: viennitEralla }, env);

    // Suoritus 2026-04-01 sulkee eran; queryErat näkee tämän vientirivin vain jos
    // saldopvm >= sen pvm.
    await storage.saveTosite(
      {
        pvm: '2026-04-01',
        tyyppi: TositeTyyppi.SIIRTO,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Suoritus',
        viennit: [
          { tili: 1910, debet: 10000, kredit: 0, pvm: '2026-04-01', alvKoodi: 0, alvProsentti: 0 },
          {
            tili: 1700,
            debet: 0,
            kredit: 10000,
            pvm: '2026-04-01',
            alvKoodi: 0,
            alvProsentti: 0,
            era: posted.id,
          },
        ],
      },
      env,
    );

    const ennenSuoritusta = await listaaTulot(storage, { saldopvm: '2026-03-15' });
    expect(ennenSuoritusta[0]?.avoin).toBe(Euro.fromCents(10000));

    const nyt = await listaaTulot(storage, {});
    expect(nyt[0]?.avoin).toBe(Euro.fromCents(0));
  });

  it('eraantynyt-suodatin löytää laskun, joka on sekä erääntynyt että avoin', async () => {
    const storage = seed();
    await storage.putTili(1700, { numero: 1700, tyyppi: 'AO', nimi: { fi: 'Myyntisaamiset' } });

    const posted = await storage.saveTosite(
      {
        pvm: '2026-03-01',
        tyyppi: TositeTyyppi.MYYNTILASKU,
        tila: TositeTila.KIRJANPIDOSSA,
        tunniste: 0,
        sarja: '',
        otsikko: 'Lasku',
        erapvm: '2026-03-15',
        viennit: [
          { tili: 1700, debet: 10000, kredit: 0, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
          { tili: 3000, debet: 0, kredit: 10000, pvm: '2026-03-01', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
      env,
    );
    const viennitEralla = posted.viennit.map((v) =>
      v.tili === 1700 ? { ...v, era: posted.id } : v,
    );
    await storage.saveTosite({ ...posted, viennit: viennitEralla }, env);

    const rivit = await listaaTulot(storage, { eraantynyt: '2026-04-01' });

    expect(rivit).toHaveLength(1);
    expect(rivit[0]?.avoin).toBe(Euro.fromCents(10000));
  });
});

describe('listaaTulot / listaaMenot — bucket ja alkupera', () => {
  const meno = (tila: number, alvKoodi: number, otsikko: string) => ({
    pvm: '2026-03-05',
    tyyppi: TositeTyyppi.MENO,
    tila,
    tunniste: 0,
    sarja: '',
    otsikko,
    viennit: [
      { tili: 4000, debet: 1000, kredit: 0, pvm: '2026-03-05', alvKoodi, alvProsentti: 0 },
      { tili: 1910, debet: 0, kredit: 1000, pvm: '2026-03-05', alvKoodi: 0, alvProsentti: 0 },
    ],
  });

  it('bucket rajaa yhteen tilaryhmään; oletus on kirjatut + luonnokset', async () => {
    const storage = seed();
    await storage.saveTosite(meno(TositeTila.KIRJANPIDOSSA, 0, 'Kirjattu'), env);
    await storage.saveTosite(meno(TositeTila.LUONNOS, 0, 'Luonnos'), env);
    await storage.saveTosite(meno(TositeTila.POISTETTU, 0, 'Poistettu'), env);

    const otsikot = async (bucket?: 'kirjanpidossa' | 'luonnos' | 'poistetut') =>
      (await listaaMenot(storage, bucket ? { bucket } : {})).map((r) => r.otsikko);
    expect(await otsikot()).toEqual(['Kirjattu', 'Luonnos']);
    expect(await otsikot('kirjanpidossa')).toEqual(['Kirjattu']);
    expect(await otsikot('luonnos')).toEqual(['Luonnos']);
    expect(await otsikot('poistetut')).toEqual(['Poistettu']);
  });

  it('kertoo rivin alueen alv-koodista tai kumppanin maasta', async () => {
    const storage = seed();
    const ulkomaa = await storage.saveKumppani({ nimi: 'Cloud Inc', maa: 'us' });
    await storage.saveTosite(meno(TositeTila.KIRJANPIDOSSA, AlvKoodi.OSTOT_NETTO, 'Kotimaa'), env);
    await storage.saveTosite(
      meno(TositeTila.KIRJANPIDOSSA, AlvKoodi.YHTEISOHANKINNAT_PALVELUT, 'EU'),
      env,
    );
    await storage.saveTosite(
      { ...meno(TositeTila.KIRJANPIDOSSA, 0, 'Kumppanin maa'), kumppani: ulkomaa.id },
      env,
    );
    await storage.saveTosite(meno(TositeTila.KIRJANPIDOSSA, 0, 'Ei tietoa'), env);

    const rivit = await listaaMenot(storage, {});
    expect(rivit.map((r) => [r.otsikko, r.alkupera])).toEqual([
      ['Kotimaa', 'kotimaa'],
      ['EU', 'eu'],
      ['Kumppanin maa', 'muu'],
      ['Ei tietoa', undefined],
    ]);
    expect('alkupera' in (rivit[3] as object)).toBe(false); // ei avainta, kun aluetta ei tiedetä
  });
});
