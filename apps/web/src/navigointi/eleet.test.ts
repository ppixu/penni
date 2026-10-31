import { afterEach, describe, expect, it } from 'vitest';
import {
  KYNNYS,
  type RullausSyote,
  luoPyyhkaisy,
  nappainSuunta,
  voiVierittaaVaakaan,
} from './eleet.js';

/** Rullaustapahtumien sarja 16 ms välein (≈ trackpadin tahti). */
function sarja(dxt: number[], alku = 1000, dy = 0, vierittyy = false): RullausSyote[] {
  return dxt.map((dx, i) => ({ dx, dy, aika: alku + i * 16, vierittyy }));
}

describe('luoPyyhkaisy', () => {
  it('vaakaveto oikealle (dx < 0) laukaisee takaisin-siirtymän kynnyksen kohdalla', () => {
    const p = luoPyyhkaisy();
    const tulokset = sarja(Array(20).fill(-12)).map((e) => p.syota(e));
    const laukaisut = tulokset.filter((t) => t.tila === 'laukaisu');
    expect(laukaisut).toEqual([{ tila: 'laukaisu', suunta: 'takaisin' }]);
    // Ennen kynnystä veto raportoi edistymisen osoitinta varten.
    expect(tulokset[3]).toMatchObject({ tila: 'veto', suunta: 'takaisin' });
  });

  it('vaakaveto vasemmalle (dx > 0) on eteenpäin', () => {
    const p = luoPyyhkaisy();
    const tulokset = sarja(Array(20).fill(12)).map((e) => p.syota(e));
    expect(tulokset.find((t) => t.tila === 'laukaisu')).toEqual({
      tila: 'laukaisu',
      suunta: 'eteenpain',
    });
  });

  it('edistyminen kasvaa 0 → 1 kohti kynnystä', () => {
    const p = luoPyyhkaisy();
    const t = p.syota({ dx: -KYNNYS / 2, dy: 0, aika: 0, vierittyy: false });
    expect(t).toEqual({ tila: 'veto', suunta: 'takaisin', osuus: 0.5 });
  });

  it('yksi ele laukaisee vain kerran, vaikka hitausrullaus jatkuu', () => {
    const p = luoPyyhkaisy();
    const tulokset = sarja(Array(80).fill(-15)).map((e) => p.syota(e));
    expect(tulokset.filter((t) => t.tila === 'laukaisu')).toHaveLength(1);
  });

  it('tauon jälkeen uusi ele voi laukaista uudelleen', () => {
    const p = luoPyyhkaisy();
    const eka = sarja(Array(20).fill(-12), 0).map((e) => p.syota(e));
    const toka = sarja(Array(20).fill(-12), 2000).map((e) => p.syota(e));
    expect(eka.filter((t) => t.tila === 'laukaisu')).toHaveLength(1);
    expect(toka.filter((t) => t.tila === 'laukaisu')).toHaveLength(1);
  });

  it('pystyrullaus ei laukaise, vaikka siinä olisi vaakasivuliikettä', () => {
    const p = luoPyyhkaisy();
    const tulokset = sarja(Array(40).fill(-8), 0, 20).map((e) => p.syota(e));
    expect(tulokset.every((t) => t.tila === 'lepo')).toBe(true);
  });

  it('pystysuuntaiseksi luokiteltu ele ei muutu vaakavedoksi kesken kaiken', () => {
    const p = luoPyyhkaisy();
    const alku = sarja([0, 0, 0], 0, 15).map((e) => p.syota(e));
    const loppu = sarja(Array(30).fill(-20), 48).map((e) => p.syota(e));
    expect([...alku, ...loppu].every((t) => t.tila === 'lepo')).toBe(true);
  });

  it('jos osoittimen alla oleva taulukko voi vierittää, koko ele jätetään sille', () => {
    const p = luoPyyhkaisy();
    // Ensin taulukko vierittyy reunaan asti, sitten (samassa eleessä) reuna tulee vastaan.
    const vieritys = sarja(Array(10).fill(-12), 0, 0, true).map((e) => p.syota(e));
    const reunalla = sarja(Array(30).fill(-12), 160).map((e) => p.syota(e));
    expect([...vieritys, ...reunalla].every((t) => t.tila === 'lepo')).toBe(true);
  });

  it('suunnan kääntäminen ennen kynnystä perää vedon', () => {
    const p = luoPyyhkaisy();
    sarja(Array(5).fill(-12), 0).map((e) => p.syota(e));
    const t = sarja(Array(5).fill(12), 80).map((e) => p.syota(e));
    expect(t.at(-1)).toEqual({ tila: 'lepo' });
  });

  it('paattynyt kertoo, onko ele hiljentynyt tauon ajaksi', () => {
    const p = luoPyyhkaisy();
    p.syota({ dx: -20, dy: 0, aika: 1000, vierittyy: false });
    expect(p.paattynyt(1050)).toBe(false);
    expect(p.paattynyt(1500)).toBe(true);
  });
});

describe('nappainSuunta', () => {
  const pohja = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, code: '' };

  it('macOS: Cmd+[ / Cmd+] ja Cmd+← / Cmd+→', () => {
    expect(nappainSuunta({ ...pohja, metaKey: true, key: '[' }, true)).toBe('takaisin');
    expect(nappainSuunta({ ...pohja, metaKey: true, key: ']' }, true)).toBe('eteenpain');
    expect(nappainSuunta({ ...pohja, metaKey: true, key: 'ArrowLeft' }, true)).toBe('takaisin');
    expect(nappainSuunta({ ...pohja, metaKey: true, key: 'ArrowRight' }, true)).toBe('eteenpain');
  });

  it('macOS, suomalainen näppäimistö: Cmd+Å / Cmd+¨ (fyysiset hakasulkunäppäimet)', () => {
    expect(nappainSuunta({ ...pohja, metaKey: true, key: 'å', code: 'BracketLeft' }, true)).toBe(
      'takaisin',
    );
    expect(nappainSuunta({ ...pohja, metaKey: true, key: '¨', code: 'BracketRight' }, true)).toBe(
      'eteenpain',
    );
    // Cmd+Option+8 tuottaa suomalaisella asettelulla merkin "[".
    expect(nappainSuunta({ ...pohja, metaKey: true, altKey: true, key: '[' }, true)).toBe(
      'takaisin',
    );
  });

  it('muut alustat: Alt+← / Alt+→', () => {
    expect(nappainSuunta({ ...pohja, altKey: true, key: 'ArrowLeft' }, false)).toBe('takaisin');
    expect(nappainSuunta({ ...pohja, altKey: true, key: 'ArrowRight' }, false)).toBe('eteenpain');
  });

  it('väärät yhdistelmät eivät kelpaa', () => {
    expect(nappainSuunta({ ...pohja, key: '[' }, true)).toBeNull();
    expect(nappainSuunta({ ...pohja, altKey: true, key: 'ArrowLeft' }, true)).toBeNull();
    expect(nappainSuunta({ ...pohja, metaKey: true, key: '[' }, false)).toBeNull();
    expect(nappainSuunta({ ...pohja, metaKey: true, shiftKey: true, key: '[' }, true)).toBeNull();
    expect(nappainSuunta({ ...pohja, altKey: true, shiftKey: true, key: 'ArrowLeft' }, false)).toBe(
      null,
    );
  });
});

describe('voiVierittaaVaakaan', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** jsdom ei laske asettelua — mitat asetetaan käsin. */
  function vieritettava(scrollLeft: number, overflowX = 'auto') {
    const laatikko = document.createElement('div');
    laatikko.style.overflowX = overflowX;
    Object.defineProperty(laatikko, 'scrollWidth', { value: 1000 });
    Object.defineProperty(laatikko, 'clientWidth', { value: 400 });
    laatikko.scrollLeft = scrollLeft;
    const solu = document.createElement('span');
    laatikko.append(solu);
    document.body.append(laatikko);
    return solu;
  }

  it('vasempaan reunaan vieritetty taulukko ei voi vierittää vasemmalle mutta voi oikealle', () => {
    const solu = vieritettava(0);
    expect(voiVierittaaVaakaan(solu, -10)).toBe(false);
    expect(voiVierittaaVaakaan(solu, 10)).toBe(true);
  });

  it('keskelle vieritetty taulukko voi vierittää kumpaankin suuntaan', () => {
    const solu = vieritettava(200);
    expect(voiVierittaaVaakaan(solu, -10)).toBe(true);
    expect(voiVierittaaVaakaan(solu, 10)).toBe(true);
  });

  it('oikeaan reunaan vieritetty taulukko ei voi vierittää oikealle', () => {
    const solu = vieritettava(600);
    expect(voiVierittaaVaakaan(solu, 10)).toBe(false);
  });

  it('overflow-x: hidden ei ole käyttäjän vieritettävissä', () => {
    const solu = vieritettava(200, 'hidden');
    expect(voiVierittaaVaakaan(solu, -10)).toBe(false);
  });

  it('ilman vieritettävää esivanhempaa', () => {
    const p = document.createElement('p');
    document.body.append(p);
    expect(voiVierittaaVaakaan(p, -10)).toBe(false);
    expect(voiVierittaaVaakaan(null, -10)).toBe(false);
  });
});
