import { yritysTilit } from '@penni/charts';
import { type TiliData, lataaKartta, lataaTili, tilityypit } from '@penni/engine';
import { describe, expect, it } from 'vitest';
import { omaSelite, ryhmanVihje, tilinSelite, tyypinSelite } from './selitteet.js';

describe('selitteet', () => {
  const kartta = lataaKartta(yritysTilit as TiliData[]);

  it('jokaisella vakiotilikartan tilillä ja otsikolla on selite', () => {
    expect(kartta.filter((t) => omaSelite(t) === undefined).map((t) => t.numero)).toEqual([]);
  });

  it('uudelleennimetty tili saa lähimmän otsikon selitteen otsikon nimellä', () => {
    const ostot = lataaTili({ numero: 4010, tyyppi: 'D', nimi: { fi: 'Ostot 2' } });
    const ohjelmistot = lataaTili({ numero: 4010, tyyppi: 'D', nimi: { fi: 'Ohjelmistot' } });
    const otsikko = kartta.find((t) => t.numero === 40 && t.otsikkotaso === 5);
    expect(tilinSelite(ostot, otsikko)).toBe(omaSelite(ostot));
    expect(tilinSelite(ohjelmistot, otsikko)).toMatch(/^Aine-, tarvike- ja tavaraostot: /);
  });

  it('ryhmän vihje yhdistää selitteen ja sisällön', () => {
    const vastaavaa = kartta.find((t) => t.numero === 1 && t.otsikkotaso === 1);
    expect(ryhmanVihje(vastaavaa, ['Pysyvät vastaavat', 'Vaihtuvat vastaavat'])).toMatch(
      /varat.*\n\nSisältää: Pysyvät vastaavat · Vaihtuvat vastaavat$/s,
    );
  });

  it('jokaisella tilityypillä on selite', () => {
    expect(tilityypit().filter((t) => !tyypinSelite(t.koodi))).toEqual([]);
  });
});
