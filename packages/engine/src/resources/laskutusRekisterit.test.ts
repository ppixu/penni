import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../storage-memory/src/memory.js';
import {
  haeToistot,
  haeTuotteet,
  haeVakioviitteet,
  poistaToisto,
  poistaTuote,
  poistaVakioviite,
  tallennaToisto,
  tallennaTuote,
  tallennaVakioviite,
} from './laskutusRekisterit.js';

const seed = {
  tilit: [{ numero: 3000, tyyppi: 'CC', nimi: { fi: 'Myynti' } }],
  tilikaudet: [{ alkaa: '2026-01-01', loppuu: '2026-12-31' }],
  asetukset: { Nimi: 'Oy' },
};
const tuore = () => createMemoryStorage(seed);

describe('tuoterekisteri', () => {
  it('lisää, päivittää ja poistaa tuotteen; hinta säilyy euroina', async () => {
    const s = tuore();
    const t = await tallennaTuote(s, {
      nimike: 'Työ',
      aNetto: 80.5,
      alvKoodi: 1,
      alvProsentti: 25.5,
    });
    expect(t.aNetto).toBe(80.5);
    expect(await haeTuotteet(s)).toHaveLength(1);
    const p = await tallennaTuote(s, { ...t, nimike: 'Asiantuntijatyö' });
    expect(p.id).toBe(t.id);
    expect((await haeTuotteet(s))[0]?.nimike).toBe('Asiantuntijatyö');
    await poistaTuote(s, t.id);
    expect(await haeTuotteet(s)).toEqual([]);
  });
});

describe('vakioviitteet', () => {
  it('automaattinen numerointi antaa 1009, 1012, 1025', async () => {
    const s = tuore();
    const a = await tallennaVakioviite(s, { tili: 3000, otsikko: 'Jäsenmaksu' });
    const b = await tallennaVakioviite(s, { tili: 3000, otsikko: 'Lahjoitus' });
    const c = await tallennaVakioviite(s, { tili: 3000, otsikko: 'Muu' });
    expect([a.viite, b.viite, c.viite]).toEqual(['1009', '1012', '1025']);
    expect((await haeVakioviitteet(s)).map((v) => v.viite)).toEqual(['1009', '1012', '1025']);
  });

  it('käsin annettu viite hyväksytään ja seuraava automaattinen jatkaa siitä', async () => {
    const s = tuore();
    const a = await tallennaVakioviite(s, { viite: '1025', tili: 3000, otsikko: 'Oma' });
    expect(a.viite).toBe('1025');
    const b = await tallennaVakioviite(s, { tili: 3000, otsikko: 'Auto' });
    expect(b.viite).toBe('1038');
  });

  it('käytössä oleva viite hylätään (VIITEKAYTOSSA)', async () => {
    const s = tuore();
    await tallennaVakioviite(s, { tili: 3000, otsikko: 'Ensimmäinen' });
    await expect(
      tallennaVakioviite(s, { viite: '1009', tili: 3000, otsikko: 'Kaksoiskappale' }),
    ).rejects.toMatchObject({ code: 'VIITEKAYTOSSA' });
  });

  it('virheellinen viite hylätään (EIVIITE)', async () => {
    const s = tuore();
    for (const viite of ['1234', '0123', '12345672', 'abcd', '']) {
      await expect(
        tallennaVakioviite(s, { viite, tili: 3000, otsikko: 'X' }),
      ).rejects.toMatchObject({ code: 'EIVIITE' });
    }
  });

  it('tili ja otsikko ovat pakollisia', async () => {
    const s = tuore();
    await expect(
      tallennaVakioviite(s, { otsikko: 'Ei tiliä' } as unknown as Parameters<
        typeof tallennaVakioviite
      >[1]),
    ).rejects.toMatchObject({ code: 'EITILIA' });
    await expect(tallennaVakioviite(s, { tili: 3000, otsikko: '  ' })).rejects.toMatchObject({
      code: 'EIOTSIKKOA',
    });
  });

  it('muokkaus samalla viitteellä (vanhaViite) ei ole VIITEKAYTOSSA', async () => {
    const s = tuore();
    const a = await tallennaVakioviite(s, { tili: 3000, otsikko: 'Vanha' });
    const p = await tallennaVakioviite(s, {
      viite: a.viite,
      vanhaViite: a.viite,
      tili: 3000,
      kohdennus: 2,
      otsikko: 'Uusi',
    });
    expect(p).toMatchObject({ viite: '1009', kohdennus: 2, otsikko: 'Uusi' });
    expect(await haeVakioviitteet(s)).toHaveLength(1);
  });

  it('viitteen vaihto poistaa vanhan avaimen', async () => {
    const s = tuore();
    const a = await tallennaVakioviite(s, { tili: 3000, otsikko: 'Vanha' });
    await tallennaVakioviite(s, { tili: 3000, otsikko: 'Toinen' });
    const siirretty = await tallennaVakioviite(s, {
      viite: '2008',
      vanhaViite: a.viite,
      tili: 3000,
      otsikko: 'Vanha',
    });
    expect(siirretty.viite).toBe('2008');
    expect((await haeVakioviitteet(s)).map((v) => v.viite)).toEqual(['1012', '2008']);
    // toisen käyttämään viitteeseen ei voi siirtyä
    await expect(
      tallennaVakioviite(s, { viite: '1012', vanhaViite: '2008', tili: 3000, otsikko: 'X' }),
    ).rejects.toMatchObject({ code: 'VIITEKAYTOSSA' });
  });

  it('poistaa viitteen', async () => {
    const s = tuore();
    const a = await tallennaVakioviite(s, { tili: 3000, otsikko: 'A' });
    await poistaVakioviite(s, a.viite);
    expect(await haeVakioviitteet(s)).toEqual([]);
  });
});

describe('toistot', () => {
  it('lisää, päivittää ja poistaa toiston', async () => {
    const s = tuore();
    const t = await tallennaToisto(s, {
      kuukausia: 1,
      seuraava: '2026-07-01',
      aktiivinen: true,
      pohja: {
        maksutapa: 1,
        maksuaikaPaivia: 14,
        rivit: [{ myyntiKpl: 1, aNetto: 10, alvKoodi: 1, alvProsentti: 25.5 }],
      },
    });
    expect(t.id).toBeGreaterThan(0);
    const p = await tallennaToisto(s, { ...t, aktiivinen: false });
    expect(p.id).toBe(t.id);
    expect(await haeToistot(s)).toHaveLength(1);
    expect((await haeToistot(s))[0]?.aktiivinen).toBe(false);
    await poistaToisto(s, t.id);
    expect(await haeToistot(s)).toEqual([]);
  });
});
