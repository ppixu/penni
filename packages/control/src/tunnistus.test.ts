import { describe, expect, it } from 'vitest';
import { luoMuistiControlStore } from './muisti.js';
import {
  type TunnistusAsetukset,
  haeMinut,
  kirjaudu,
  kirjauduUlos,
  rekisteroi,
  vaihdaSalasana,
} from './tunnistus.js';
import { TunnistusVirhe } from './virheet.js';

const A: TunnistusAsetukset = { kello: () => '2026-06-01T00:00:00.000Z' };

describe('tunnistus', () => {
  it('rekisteröi + kirjaudu + haeMinut', async () => {
    const store = luoMuistiControlStore();
    const reg = await rekisteroi(store, { email: 'a@b.fi', salasana: 'salasana1', nimi: 'A' }, A);
    expect(reg.kayttaja.email).toBe('a@b.fi');
    expect(reg.token).toBeTruthy();
    const mina = await haeMinut(store, reg.token, A);
    expect(mina.id).toBe(reg.kayttaja.id);
    const log = await kirjaudu(store, { email: 'A@B.FI', salasana: 'salasana1' }, A);
    expect(log.kayttaja.id).toBe(reg.kayttaja.id);
  });

  it('kirjaudu siistii sähköpostin ympäriltä olevat välilyönnit', async () => {
    const store = luoMuistiControlStore();
    const reg = await rekisteroi(store, { email: 'a@b.fi', salasana: 'salasana1' }, A);
    const log = await kirjaudu(store, { email: ' a@b.fi ', salasana: 'salasana1' }, A);
    expect(log.kayttaja.id).toBe(reg.kayttaja.id);
  });

  it('hylkää heikon salasanan ja muodottoman sähköpostin', async () => {
    const store = luoMuistiControlStore();
    await expect(
      rekisteroi(store, { email: 'a@b.fi', salasana: 'lyhyt' }, A),
    ).rejects.toMatchObject({
      koodi: 'HEIKKO_SALASANA',
    });
    await expect(
      rekisteroi(store, { email: 'roska', salasana: 'salasana1' }, A),
    ).rejects.toMatchObject({
      koodi: 'EPAKELPO_EMAIL',
    });
  });

  it('kirjautuminen väärällä tunnuksella → VAARA_TUNNUS (sama tuntemattomalle ja väärälle salasanalle)', async () => {
    const store = luoMuistiControlStore();
    await rekisteroi(store, { email: 'a@b.fi', salasana: 'salasana1' }, A);
    await expect(kirjaudu(store, { email: 'a@b.fi', salasana: 'vaara' }, A)).rejects.toMatchObject({
      koodi: 'VAARA_TUNNUS',
    });
    await expect(
      kirjaudu(store, { email: 'ei@ole.fi', salasana: 'salasana1' }, A),
    ).rejects.toMatchObject({
      koodi: 'VAARA_TUNNUS',
    });
  });

  it('uloskirjautuminen mitätöi session', async () => {
    const store = luoMuistiControlStore();
    const reg = await rekisteroi(store, { email: 'a@b.fi', salasana: 'salasana1' }, A);
    await kirjauduUlos(store, reg.token);
    await expect(haeMinut(store, reg.token, A)).rejects.toMatchObject({ koodi: 'EI_SESSIOTA' });
  });

  it('vanhentunut sessio → EI_SESSIOTA', async () => {
    const store = luoMuistiControlStore();
    const reg = await rekisteroi(
      store,
      { email: 'a@b.fi', salasana: 'salasana1' },
      { kello: () => '2026-06-01T00:00:00.000Z', sessionKestoMs: 1000 },
    );
    const myohemmin: TunnistusAsetukset = { kello: () => '2026-06-01T00:00:02.000Z' };
    await expect(haeMinut(store, reg.token, myohemmin)).rejects.toMatchObject({
      koodi: 'EI_SESSIOTA',
    });
  });

  it('salasananvaihto: väärä vanha → VAARA_TUNNUS; onnistunut vaihto muuttaa kirjautumisen', async () => {
    const store = luoMuistiControlStore();
    const reg = await rekisteroi(store, { email: 'a@b.fi', salasana: 'salasana1' }, A);
    await expect(
      vaihdaSalasana(
        store,
        reg.kayttaja.id,
        { vanhaSalasana: 'vaara', uusiSalasana: 'uusisala1' },
        A,
      ),
    ).rejects.toMatchObject({ koodi: 'VAARA_TUNNUS' });
    await vaihdaSalasana(
      store,
      reg.kayttaja.id,
      { vanhaSalasana: 'salasana1', uusiSalasana: 'uusisala1' },
      A,
    );
    await expect(
      kirjaudu(store, { email: 'a@b.fi', salasana: 'salasana1' }, A),
    ).rejects.toMatchObject({
      koodi: 'VAARA_TUNNUS',
    });
    expect(
      (await kirjaudu(store, { email: 'a@b.fi', salasana: 'uusisala1' }, A)).token,
    ).toBeTruthy();
  });
});
