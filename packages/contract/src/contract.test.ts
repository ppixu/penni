import { describe, expect, it } from 'vitest';
import { contract } from './contract.js';

describe('ts-rest contract', () => {
  it('declares the init routes', () => {
    expect(contract.haeInit.method).toBe('GET');
    expect(contract.haeInit.path).toBe('/init');
    expect(contract.paivitaInit.method).toBe('PATCH');
  });

  it('declares the tositteet CRUD + state-change routes with exact paths', () => {
    expect(contract.listaaTositteet.path).toBe('/tositteet');
    expect(contract.haeTosite.path).toBe('/tositteet/:id');
    expect(contract.luoTosite.method).toBe('POST');
    expect(contract.paivitaTosite.method).toBe('PUT');
    expect(contract.muutaTila.method).toBe('PATCH');
    expect(contract.poistaTosite.method).toBe('DELETE');
  });

  it('declares viennit / saldot / tilikaudet / tilit / asetukset', () => {
    expect(contract.listaaViennit.path).toBe('/viennit');
    expect(contract.haeSaldot.path).toBe('/saldot');
    expect(contract.haeTilikaudet.path).toBe('/tilikaudet');
    expect(contract.tallennaTilikausi.path).toBe('/tilikaudet/:alkaa');
    expect(contract.tallennaTili.path).toBe('/tilit/:numero');
    expect(contract.tallennaOtsikko.path).toBe('/tilit/:numero/:taso');
    expect(contract.haeAsetukset.path).toBe('/asetukset');
    expect(contract.paivitaAsetukset.method).toBe('PATCH');
  });

  it('declares the alv-erittely route', () => {
    expect(contract.haeAlvErittely.method).toBe('GET');
    expect(contract.haeAlvErittely.path).toBe('/alv/erittely');
  });

  it('declares the kohdennukset / budjetti routes and the two kohdennus reports', () => {
    expect(contract.haeKohdennukset.path).toBe('/kohdennukset');
    expect(contract.tallennaKohdennus.method).toBe('POST');
    expect(contract.poistaKohdennus.path).toBe('/kohdennukset/:id');
    expect(contract.haeBudjetti.path).toBe('/budjetti/:tilikausi');
    expect(contract.tallennaBudjetti.method).toBe('PUT');
    expect(contract.laadiKohdennusRaportti.path).toBe('/raportti/kohdennukset');
    expect(contract.laadiBudjettivertailu.path).toBe('/raportti/budjettivertailu');
  });
});
