import { poimiKuittiTekstista } from '@penni/engine';
import { pdfTeksti } from '@penni/luku';
import { describe, expect, it } from 'vitest';
import { esimerkkikuitti, luoDemokirja } from './demoKirja.js';

describe('demokirja', () => {
  it('rakentuu moottorin kautta: tasapainoiset, aukottomasti numeroidut tositteet', async () => {
    const { client } = await luoDemokirja();
    const kirjatut = await client.listaaTositteet({ bucket: 'kirjanpidossa' });
    expect(kirjatut.length).toBeGreaterThan(100);

    const tunnisteet = kirjatut.map((t) => t.tunniste).sort((a, b) => a - b);
    expect(tunnisteet).toEqual(tunnisteet.map((_, i) => i + 1));

    for (const l of kirjatut) {
      const t = await client.haeTosite(l.id);
      if (!t || t.tyyppi === 9010) continue; // tilinavaus saa olla epätasapainossa (EITASMAA-vapaa)
      const debet = t.viennit.reduce((a, v) => a + v.debet, 0);
      const kredit = t.viennit.reduce((a, v) => a + v.kredit, 0);
      expect(debet, `tosite ${t.tunniste} ${t.otsikko}`).toBe(kredit);
      for (const v of t.viennit) {
        expect(Number.isInteger(v.debet) && Number.isInteger(v.kredit)).toBe(true);
      }
    }
  });

  it('jättää kuittilaatikkoon kolme luettua luonnosta liitteineen', async () => {
    const { client } = await luoDemokirja();
    const luonnokset = await client.listaaTositteet({ bucket: 'luonnos' });
    expect(luonnokset).toHaveLength(3);
    expect(luonnokset.every((t) => t.liitteita === 1)).toBe(true);
  });

  it('pitää pankkitilin plussalla ja Q3:n alv:n ilmoittamatta', async () => {
    const { client } = await luoDemokirja();
    const asetukset = await client.haeAsetukset();
    expect(asetukset.AlvIlmoitettu).toBe('2026-06-30');
    const myyntilaskut = await client.listaaMyyntilaskut({});
    expect(myyntilaskut.filter((r) => r.avoin > 0)).toHaveLength(3);
    const viennit = await client.listaaViennit({ tili: 1910 });
    let saldo = 0;
    for (const v of [...viennit].sort((a, b) => (a.pvm < b.pvm ? -1 : 1))) {
      saldo += v.debet - v.kredit;
      expect(saldo, v.pvm).toBeGreaterThan(0);
    }
  });

  it('täsmäytysaineiston saldot ja kuitit ovat johdonmukaiset', async () => {
    const { aineisto } = await luoDemokirja();
    const { tiliote } = aineisto;
    const summa = tiliote.tapahtumat.reduce((a, t) => a + t.maara, 0);
    expect(tiliote.loppusaldo).toBe((tiliote.alkusaldo ?? 0) + summa);
    expect(aineisto.kuitit).toHaveLength(2);
    for (const k of aineisto.kuitit) {
      expect(k.kuitti.bruttoSumma).toBeGreaterThan(0);
      expect(aineisto.tiedostot.has(k.tiedosto)).toBe(true);
    }
    expect(aineisto.tiedostot.has(tiliote.tiedosto)).toBe(true);
  });

  it('esimerkkikuitin PDF luetaan tekstikerroksesta kuitiksi (sama polku kuin selaimessa)', async () => {
    const { data } = esimerkkikuitti();
    const t = poimiKuittiTekstista(await pdfTeksti(data));
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBe('TOIMISTOTUKKU PAPERI OY');
    expect(t.kuitti.ytunnus).toBe('2601987-7');
    expect(t.kuitti.pvm).toBe('2026-10-31');
    expect(t.kuitti.bruttoSumma).toBe(4680);
    expect(t.kuitti.alv).toEqual([{ kanta: 25.5, netto: 3729, vero: 951, brutto: 4680 }]);
  });

  it('kuittikansion PDF:t ja tapahtumaluettelo ovat luettavia', async () => {
    const { aineisto } = await luoDemokirja();
    for (const k of aineisto.kuitit) {
      const data = aineisto.tiedostot.get(k.tiedosto);
      if (!data) throw new Error(k.tiedosto);
      const t = poimiKuittiTekstista(await pdfTeksti(data));
      expect(t.ok && t.kuitti.bruttoSumma).toBe(k.kuitti.bruttoSumma);
    }
    const tiliote = aineisto.tiedostot.get(aineisto.tiliote.tiedosto);
    if (!tiliote) throw new Error('tiliote');
    expect((await pdfTeksti(tiliote)).replace(/\s+/g, ' ')).toContain('Kuvapankki Lumo Oy -29,00');
  });
});
