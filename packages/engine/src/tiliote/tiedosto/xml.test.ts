import { describe, expect, it } from 'vitest';
import { lapset, lapsi, lueXml, teksti } from './xml.js';
import { TiliotetiedostoVirhe } from './yhteiset.js';

describe('lueXml', () => {
  it('purkaa viisi esimääriteltyä entiteettiä ja numeeriset merkkiviittaukset', () => {
    const juuri = lueXml('<a>&amp;&lt;&gt;&quot;&apos;&#228;&#xE4;</a>');
    expect(juuri.teksti).toBe('&<>"\'ää');
  });

  it('purkaa entiteetit myös attribuuteissa', () => {
    expect(lueXml('<a x="1 &amp; 2" y=\'&#65;\'/>').attr).toEqual({ x: '1 & 2', y: 'A' });
  });

  it('säilyttää CDATAn sellaisenaan', () => {
    expect(lueXml('<a><![CDATA[<b> & &amp; x]]></a>').teksti).toBe('<b> & &amp; x');
  });

  it('yhdistää tekstin ja CDATAn ja trimmaa reunat', () => {
    expect(lueXml('<a>\n  alku <![CDATA[keski]]> loppu\n</a>').teksti).toBe('alku keski loppu');
  });

  it('ohittaa kommentit, käsittelyohjeet ja DOCTYPEn', () => {
    const juuri = lueXml(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE a [<!ENTITY x "y">]>\n<!-- kommentti -->\n<a><!-- sisällä --><b>1</b><?ohje ?></a>\n<!-- lopussa -->',
    );
    expect(juuri.nimi).toBe('a');
    expect(juuri.lapset.map((l) => l.nimi)).toEqual(['b']);
  });

  it('riisuu nimiavaruuden etuliitteen elementeiltä', () => {
    const juuri = lueXml('<a:B x="1"/>');
    expect(juuri.nimi).toBe('B');
    expect(juuri.attr.x).toBe('1');
    expect(juuri.lapset).toEqual([]);
  });

  it('lukee BOM:n jälkeisen XML:n', () => {
    expect(lueXml('﻿<a>1</a>').teksti).toBe('1');
  });

  it('rakentaa sisäkkäiset elementit ja oman tekstin', () => {
    const juuri = lueXml('<a><b>1</b><c><d>2</d></c><b>3</b></a>');
    expect(lapset(juuri, 'b').map((b) => b.teksti)).toEqual(['1', '3']);
    expect(teksti(juuri, 'c', 'd')).toBe('2');
    expect(lapsi(juuri, 'c', 'x')).toBeUndefined();
    expect(teksti(undefined, 'c')).toBeUndefined();
    expect(lapset(undefined, 'b')).toEqual([]);
  });

  it('syvä sisäkkäisyys ei kaada pinoa', () => {
    const syvyys = 20000;
    const xml = `${'<a>'.repeat(syvyys)}x${'</a>'.repeat(syvyys)}`;
    expect(lueXml(xml).nimi).toBe('a');
  });

  it.each([
    ['sulkematon tagi', '<a><b></a>'],
    ['sulkematon juuri', '<a>'],
    ['väärä päättötagi', '<a></b>'],
    ['ylimääräinen päättötagi', '<a/></a>'],
    ['tyhjä teksti', ''],
    ['pelkkä teksti', 'ei xml:ää'],
    ['useampi juuri', '<a/><b/>'],
    ['tuntematon entiteetti', '<a>&nbsp;</a>'],
    ['sulkematon kommentti', '<a><!-- </a>'],
    ['sulkematon attribuutti', '<a x="1></a>'],
  ])('virheellinen XML (%s) → VAARA_MUOTO', (_nimi, xml) => {
    expect(() => lueXml(xml)).toThrow(TiliotetiedostoVirhe);
    try {
      lueXml(xml);
    } catch (e) {
      expect((e as TiliotetiedostoVirhe).koodi).toBe('VAARA_MUOTO');
    }
  });

  it('virheessä kerrotaan rivi', () => {
    try {
      lueXml('<a>\n<b>\n</a>');
      expect.unreachable();
    } catch (e) {
      expect((e as TiliotetiedostoVirhe).rivi).toBe(3);
    }
  });
});
