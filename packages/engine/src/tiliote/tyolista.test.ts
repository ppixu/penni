import type { Cents } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import type { Tilitapahtuma } from './poimiTiliote.js';
import type { Kuittilahde, TasmaysRaportti } from './tasmaytaTiliote.js';
import {
  type KirjattuRivi,
  type TyolistaRivi,
  asetaTiliSamannimisille,
  irrotaKuitti,
  kuittiEhdokkaat,
  liitaKuitti,
  poimiKirjatut,
  rakennaTyolista,
  samannimiset,
  siirraPaivia,
} from './tyolista.js';

// Cents on brändätty tyyppi (@penni/euro); testien literaalit tarvitsevat pienen castin.
const c = (n: number): Cents => n as Cents;

const tapahtuma = (pvm: string, nimi: string, maara: number): Tilitapahtuma =>
  ({ pvm, nimi, maara }) as Tilitapahtuma;

const raportti = (tapahtumat: Tilitapahtuma[]): TasmaysRaportti => ({
  tapahtumat: tapahtumat.map((t) => ({ tapahtuma: t, luokka: 'kuittiPuuttuu' as const })),
  kuititIlmanTapahtumaa: [],
});

describe('rakennaTyolista — jo kirjatut', () => {
  it('merkitsee kirjatuksi rivin joka löytyy kirjasta samalla päivällä ja summalla', () => {
    const kirjatut: KirjattuRivi[] = [{ pvm: '2026-04-04', maara: c(-2000), tunniste: '2026-12' }];
    const rivit = rakennaTyolista(
      raportti([tapahtuma('2026-04-04', 'PILVIPALVELU', -2000)]),
      kirjatut,
    );
    expect(rivit[0]?.tila).toBe('joKirjattu');
    expect(rivit[0]?.valittu).toBe(false);
  });

  it('kuluttaa jokaisen kirjatun tositteen vain kerran: kaksi samanlaista, yksi kirjattu', () => {
    const kirjatut: KirjattuRivi[] = [{ pvm: '2026-04-04', maara: c(-2000), tunniste: '2026-12' }];
    const rivit = rakennaTyolista(
      raportti([
        tapahtuma('2026-04-04', 'PILVIPALVELU', -2000),
        tapahtuma('2026-04-04', 'PILVIPALVELU', -2000),
      ]),
      kirjatut,
    );
    expect(rivit.map((r) => r.tila)).toEqual(['joKirjattu', 'kuittiPuuttuu']);
  });

  it('sallii kahden päivän eron kirjaus- ja tositepäivässä, ei enempää', () => {
    const kirjatut: KirjattuRivi[] = [
      { pvm: '2026-04-06', maara: c(-2000), tunniste: '2026-12' },
      { pvm: '2026-04-20', maara: c(-500), tunniste: '2026-13' },
    ];
    const rivit = rakennaTyolista(
      raportti([
        tapahtuma('2026-04-04', 'PILVIPALVELU', -2000),
        tapahtuma('2026-04-17', 'KAHVILA', -500),
      ]),
      kirjatut,
    );
    expect(rivit.map((r) => r.tila)).toEqual(['joKirjattu', 'kuittiPuuttuu']);
  });

  it('paritaa lähimmän päiväyksen ensin, ettei viereinen rivi vie tarkkaa osumaa', () => {
    const kirjatut: KirjattuRivi[] = [{ pvm: '2026-04-05', maara: c(-2000), tunniste: '2026-12' }];
    const rivit = rakennaTyolista(
      raportti([
        tapahtuma('2026-04-04', 'PILVIPALVELU', -2000),
        tapahtuma('2026-04-05', 'PILVIPALVELU', -2000),
      ]),
      kirjatut,
    );
    expect(rivit.map((r) => r.tila)).toEqual(['kuittiPuuttuu', 'joKirjattu']);
  });

  it('ei merkitse kirjatuksi kun summa eroaa', () => {
    const kirjatut: KirjattuRivi[] = [{ pvm: '2026-04-04', maara: c(-2001), tunniste: '2026-12' }];
    const rivit = rakennaTyolista(
      raportti([tapahtuma('2026-04-04', 'PILVIPALVELU', -2000)]),
      kirjatut,
    );
    expect(rivit[0]?.tila).toBe('kuittiPuuttuu');
  });
});

describe('rakennaTyolista — oma pääoma ei valikoidu automaattisesti', () => {
  it('omaPaaoma-rivi tulee valitsematta vaikka rinnakkainen kuittiPuuttuu-rivi tulee valittuna', () => {
    // Yksi "Kirjaa valitut" -klikkaus ei saa kirjata omistajan yksityisottoa/-sijoitusta
    // tavallisena menona/tulona piilossa olevasta ryhmästä — ks. task-7 katselmoinnin ruling.
    const raporttiOmaPaaoma: TasmaysRaportti = {
      tapahtumat: [
        { tapahtuma: tapahtuma('2026-04-04', 'OMISTAJA OTTO', -50000), luokka: 'omaPaaoma' },
        { tapahtuma: tapahtuma('2026-04-05', 'TUNTEMATON KAUPPA', -1500), luokka: 'kuittiPuuttuu' },
      ],
      kuititIlmanTapahtumaa: [],
    };
    const rivit = rakennaTyolista(raporttiOmaPaaoma, []);
    expect(rivit[0]?.tila).toBe('omaPaaoma');
    expect(rivit[0]?.valittu).toBe(false);
    expect(rivit[1]?.tila).toBe('kuittiPuuttuu');
    expect(rivit[1]?.valittu).toBe(true);
  });
});

describe('poimiKirjatut', () => {
  it('poimii vain pankkitilin viennit ja laskee etumerkillisen määrän', () => {
    const tositteet = [
      {
        id: 1,
        tunniste: 12,
        sarja: '',
        pvm: '2026-04-04',
        viennit: [
          { tili: 7690, debet: 1594, kredit: 0, pvm: '2026-04-04', alvKoodi: 0, alvProsentti: 0 },
          { tili: 1910, debet: 0, kredit: 2000, pvm: '2026-04-04', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
    ] as unknown as Parameters<typeof poimiKirjatut>[0];
    expect(poimiKirjatut(tositteet, 1910)).toEqual([
      { pvm: '2026-04-04', maara: -2000, tunniste: '2026-12' },
    ]);
  });

  it('ohittaa pankkitilin viennin jonka nettomäärä on nolla', () => {
    const tositteet = [
      {
        id: 1,
        tunniste: 12,
        sarja: '',
        pvm: '2026-04-04',
        viennit: [
          { tili: 1910, debet: 500, kredit: 500, pvm: '2026-04-04', alvKoodi: 0, alvProsentti: 0 },
        ],
      },
    ] as unknown as Parameters<typeof poimiKirjatut>[0];
    expect(poimiKirjatut(tositteet, 1910)).toEqual([]);
  });
});

describe('rakennaTyolista — kirjaushistorian ehdotus', () => {
  it('esitäyttää tilin ehdotuksesta, mutta ei jo kirjatulle riville', () => {
    const kirjatut: KirjattuRivi[] = [{ pvm: '2026-04-04', maara: c(-2000), tunniste: '2026-1' }];
    const ehdotus = { tili: 6800, alvKoodi: 25, alvProsentti: 25.5, peruste: 'nimi' as const };
    const rivit = rakennaTyolista(
      raportti([tapahtuma('2026-04-04', 'PILVI', -2000), tapahtuma('2026-05-04', 'PILVI', -2100)]),
      kirjatut,
      { ehdota: () => ehdotus },
    );
    expect(rivit[0]?.tili).toBeUndefined();
    expect(rivit[0]?.ehdotus).toBeUndefined();
    expect(rivit[1]?.tili).toBe(6800);
    expect(rivit[1]?.ehdotus).toEqual(ehdotus);
  });
});

describe('samannimiset ja asetaTiliSamannimisille', () => {
  const rivit = rakennaTyolista(
    raportti([
      tapahtuma('2026-04-01', 'PILVI OY', -1000),
      tapahtuma('2026-05-01', 'Pilvi Oy', -1000),
      tapahtuma('2026-06-01', 'PILVI OY', -1000),
      tapahtuma('2026-06-02', 'MUU', -1000),
    ]),
    [{ pvm: '2026-06-01', maara: c(-1000), tunniste: '2026-9' }],
  ).map((r, i) => (i === 0 ? { ...r, tili: 6800, valittu: false } : { ...r, valittu: false }));

  it('löytää kirjaamattomat samannimiset rivit eri tilillä', () => {
    const avain = rivit[0]?.avain ?? '';
    expect(samannimiset(rivit, avain).map((r) => r.tapahtuma.pvm)).toEqual(['2026-05-01']);
  });

  it('kopioi tilin samannimisille ja valitsee ne', () => {
    const uudet = asetaTiliSamannimisille(rivit, rivit[0]?.avain ?? '');
    expect(uudet.map((r) => [r.tili, r.valittu])).toEqual([
      [6800, false],
      [6800, true],
      [undefined, false],
      [undefined, false],
    ]);
  });
});

describe('siirraPaivia', () => {
  it('siirtää päiväystä kuukauden ja vuoden rajan yli', () => {
    expect(siirraPaivia('2026-03-01', -2)).toBe('2026-02-27');
    expect(siirraPaivia('2026-12-31', 1)).toBe('2027-01-01');
  });
});

const kuitti = (tiedosto: string, bruttoSumma?: number, pvm?: string): Kuittilahde => ({
  tiedosto,
  kuitti: {
    valuutta: 'EUR',
    alv: [],
    myyja: tiedosto,
    ...(bruttoSumma !== undefined ? { bruttoSumma: c(bruttoSumma) } : {}),
    ...(pvm !== undefined ? { pvm } : {}),
  },
});

const kuititon = (avain: string, pvm: string, maara: number): TyolistaRivi => ({
  avain,
  tapahtuma: tapahtuma(pvm, 'CURSOR', maara),
  tila: 'kuittiPuuttuu',
  valittu: false,
});

describe('kuittiEhdokkaat', () => {
  it('järjestää kuitit summan ja sitten päiväyksen läheisyyden mukaan, summattomat viimeiseksi', () => {
    const rivi = kuititon('a', '2026-07-29', -1743);
    const ehdokkaat = kuittiEhdokkaat(rivi, [
      kuitti('ei-summaa.pdf'),
      kuitti('kaukana.pdf', 5000, '2026-07-29'),
      kuitti('tarkka-myohassa.pdf', 1743, '2026-07-10'),
      kuitti('tarkka.pdf', 1743, '2026-07-28'),
      kuitti('lahella.pdf', 1800, '2026-07-29'),
    ]);
    expect(ehdokkaat.map((k) => k.tiedosto)).toEqual([
      'tarkka.pdf',
      'tarkka-myohassa.pdf',
      'lahella.pdf',
      'kaukana.pdf',
      'ei-summaa.pdf',
    ]);
  });
});

describe('liitaKuitti ja irrotaKuitti', () => {
  it('liittää kuitin riville, merkitsee sen valmiiksi ja valituksi ja poistaa kuitin poolista', () => {
    const pooli = [kuitti('a.pdf', 1743), kuitti('b.pdf', 500)];
    const tulos = liitaKuitti([kuititon('r1', '2026-07-29', -1743)], pooli, 'r1', 'a.pdf');
    expect(tulos.rivit[0]).toMatchObject({ tila: 'valmis', valittu: true, kuitti: pooli[0] });
    expect(tulos.kuitit.map((k) => k.tiedosto)).toEqual(['b.pdf']);
  });

  it('vaihtaa kuitin: rivin vanha kuitti palaa pooliin', () => {
    const vanha = kuitti('vanha.pdf', 1700);
    const rivi: TyolistaRivi = { ...kuititon('r1', '2026-07-29', -1743), kuitti: vanha };
    const tulos = liitaKuitti([rivi], [kuitti('uusi.pdf', 1743)], 'r1', 'uusi.pdf');
    expect(tulos.rivit[0]?.kuitti?.tiedosto).toBe('uusi.pdf');
    expect(tulos.kuitit.map((k) => k.tiedosto)).toEqual(['vanha.pdf']);
  });

  it('ei muuta mitään, jos kuittia tai riviä ei löydy', () => {
    const rivit = [kuititon('r1', '2026-07-29', -1743)];
    const pooli = [kuitti('a.pdf', 1743)];
    expect(liitaKuitti(rivit, pooli, 'r1', 'puuttuu.pdf')).toEqual({ rivit, kuitit: pooli });
    expect(liitaKuitti(rivit, pooli, 'puuttuu', 'a.pdf')).toEqual({ rivit, kuitit: pooli });
  });

  it('irrottaa kuitin: rivi palaa kuitti puuttuu -tilaan ja kuitti pooliin', () => {
    const k = kuitti('a.pdf', 1743);
    const rivi: TyolistaRivi = {
      ...kuititon('r1', '2026-07-29', -1743),
      kuitti: k,
      tila: 'nimitasmays',
      valittu: true,
    };
    const tulos = irrotaKuitti([rivi], [], 'r1');
    expect(tulos.rivit[0]?.kuitti).toBeUndefined();
    expect(tulos.rivit[0]?.tila).toBe('kuittiPuuttuu');
    expect(tulos.kuitit).toEqual([k]);
  });
});
