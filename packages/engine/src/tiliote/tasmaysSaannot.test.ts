import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { Tilitapahtuma } from './poimiTiliote.js';
import {
  lisaaMenotiliSaanto,
  lueTasmaysSaannot,
  tasmaysSaannotAsetuksiksi,
} from './tasmaysSaannot.js';
import { tasmaytaTiliote } from './tasmaytaTiliote.js';

/** Luokittelee yhden pankkitapahtuman kirjan asetuksilla — sama polku kuin näkymässä. */
function luokka(kirjanNimi: string, tapahtumanNimi: string): string | undefined {
  const saannot = lueTasmaysSaannot({ Nimi: kirjanNimi });
  const tapahtumat: Tilitapahtuma[] = [
    { pvm: '2026-06-02', nimi: tapahtumanNimi, maara: Euro.fromString('-25.00') },
  ];
  return tasmaytaTiliote(tapahtumat, [], { omistajanNimet: saannot.omistajanNimet }).tapahtumat[0]
    ?.luokka;
}

describe('säännöt', () => {
  it('palauttaa tyhjät säännöt kun asetuksia ei ole', () => {
    expect(lueTasmaysSaannot({})).toEqual({
      menotiliSaannot: [],
      vendorAliakset: [],
      omistajanNimet: [],
      omistajanNimetTallennettu: false,
    });
  });

  it('lukee tallennetut säännöt', () => {
    const saannot = lueTasmaysSaannot({
      TasmaysMenotiliSaannot: '[{"hae":"cursor","tili":7690}]',
      TasmaysOmistajanNimet: '["Aino Salo"]',
    });
    expect(saannot.menotiliSaannot).toEqual([{ hae: 'cursor', tili: 7690 }]);
    expect(saannot.omistajanNimet).toEqual(['Aino Salo']);
    expect(saannot.omistajanNimetTallennettu).toBe(true);
  });

  it('sietää rikkinäisen JSONin tyhjänä eikä kaada näkymää', () => {
    expect(lueTasmaysSaannot({ TasmaysMenotiliSaannot: '{rikki' }).menotiliSaannot).toEqual([]);
  });

  it('siementää omistajanNimet kirjan omasta nimestä kun TasmaysOmistajanNimet puuttuu', () => {
    // Yhtenä nimenä, ei sanaa per alkio: erillisinä kumpikin sana riittäisi yksin.
    expect(lueTasmaysSaannot({ Nimi: 'Aino Salo' }).omistajanNimet).toEqual(['aino salo']);
  });

  it('ei siemennä yritysmuotoja eikä lyhyitä sanoja', () => {
    expect(lueTasmaysSaannot({ Nimi: 'Pilvipalvelu Oy' }).omistajanNimet).toEqual(['pilvipalvelu']);
    expect(lueTasmaysSaannot({ Nimi: 'Oy Ab' }).omistajanNimet).toEqual([]);
  });

  it('siemennetty toiminimi ei tunnista etunimen jakavaa sivullista omistajaksi', () => {
    // Sauma: siemen yhtenä nimenä + moottorin kaikki-sanat-sääntö. Erillisinä sanoina
    // 'aino' yksin riittäisi, ja sivullisen tapahtuma katoaisi kasassa olevaan
    // omaPaaoma-ryhmään esivalitsematta.
    expect(luokka('Aino Salo', 'AINO VIRTANEN')).toBe('kuittiPuuttuu');
    expect(luokka('Aino Salo', 'SALO REMONTIT')).toBe('kuittiPuuttuu');
    expect(luokka('Aino Salo', 'SALO AINO')).toBe('omaPaaoma');
  });

  it('tallennettu TasmaysOmistajanNimet voittaa siemennetyn oletuksen', () => {
    const saannot = lueTasmaysSaannot({
      Nimi: 'Aino Salo',
      TasmaysOmistajanNimet: '["muu nimi"]',
    });
    expect(saannot.omistajanNimet).toEqual(['muu nimi']);
  });

  it('palauttaa tyhjän omistajanNimet-listan eikä kaadu kun myös Nimi puuttuu', () => {
    expect(lueTasmaysSaannot({}).omistajanNimet).toEqual([]);
  });

  // Siemennyksen ja moottorin luokittelun sauma: yhtiömuotoinen kirjan nimi ei saa
  // luokitella toisia osakeyhtiöitä omistajan liikkeiksi (ne katoaisivat kasassa olevaan
  // omaPaaoma-ryhmään, jonka rivejä ei koskaan esivalita).
  it('ei luokittele toista osakeyhtiötä omaksi pääomaksi', () => {
    expect(luokka('Pilvipalvelu Oy', 'ELISA OYJ')).toBe('kuittiPuuttuu');
    expect(luokka('Pilvipalvelu Oy', 'VERKKOKAUPPA.COM OYJ')).toBe('kuittiPuuttuu');
  });

  it('tunnistaa toiminimen omistajan vain kokonaisista sanoista', () => {
    expect(luokka('Aino Salo', 'SALOMON SPORTS')).toBe('kuittiPuuttuu');
    expect(luokka('Aino Salo', 'AINO SALO')).toBe('omaPaaoma');
  });

  it('normalisoi hakusanan pienaakkosiksi ja korvaa saman säännön', () => {
    const yksi = lisaaMenotiliSaanto(lueTasmaysSaannot({}), 'CURSOR', 7690);
    const kaksi = lisaaMenotiliSaanto(yksi, 'cursor', 7660);
    expect(kaksi.menotiliSaannot).toEqual([{ hae: 'cursor', tili: 7660 }]);
  });

  it('sarjallistaa asetuksiksi', () => {
    const saannot = lisaaMenotiliSaanto(lueTasmaysSaannot({}), 'Cursor', 7690);
    expect(tasmaysSaannotAsetuksiksi(saannot).TasmaysMenotiliSaannot).toBe(
      '[{"hae":"cursor","tili":7690}]',
    );
  });

  it('ei kirjoita siemennettyä omistajanimeä kirjaan', () => {
    const saannot = lisaaMenotiliSaanto(
      lueTasmaysSaannot({ Nimi: 'Pilvipalvelu Oy' }),
      'Cursor',
      7690,
    );
    expect(saannot.omistajanNimet).toEqual(['pilvipalvelu']);
    expect(tasmaysSaannotAsetuksiksi(saannot)).not.toHaveProperty('TasmaysOmistajanNimet');
  });

  it('kirjoittaa omistajanimet kun ne on käyttäjän omana arvona tallennettu', () => {
    const saannot = lisaaMenotiliSaanto(
      lueTasmaysSaannot({ Nimi: 'Pilvipalvelu Oy', TasmaysOmistajanNimet: '["salo"]' }),
      'Cursor',
      7690,
    );
    expect(tasmaysSaannotAsetuksiksi(saannot).TasmaysOmistajanNimet).toBe('["salo"]');
  });
});
