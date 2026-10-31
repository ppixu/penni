import { Euro } from '@penni/euro';
import { describe, expect, it } from 'vitest';
import { jasennaKuitti } from './jasennaKuitti.js';
import { tasmaa } from './tasmays.js';

describe('jasennaKuitti', () => {
  it('jäsentää siistin JSONin ja muuntaa rahat senteiksi', () => {
    const t = jasennaKuitti(
      '{"myyja":"K-Market","ytunnus":"1234567-8","pvm":"2026-07-15","valuutta":"eur",' +
        '"bruttoSumma":24.90,"alv":[{"kanta":25.5,"netto":19.84,"vero":5.06,"brutto":24.90}]}',
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBe('K-Market');
    expect(t.kuitti.ytunnus).toBe('1234567-8');
    expect(t.kuitti.pvm).toBe('2026-07-15');
    expect(t.kuitti.valuutta).toBe('EUR');
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('24.90'));
    expect(t.kuitti.alv).toHaveLength(1);
    expect(t.kuitti.alv[0]?.kanta).toBe(25.5);
    expect(t.kuitti.alv[0]?.vero).toBe(Euro.fromString('5.06'));
  });

  it('poistaa koodiaidat ja ympäröivän tekstin', () => {
    const t = jasennaKuitti('Tässä tulos:\n```json\n{"valuutta":"EUR","alv":[]}\n```\nvalmis');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.valuutta).toBe('EUR');
  });

  it('hyväksyy rahat myös merkkijonoina (pilkkudesimaali)', () => {
    const t = jasennaKuitti('{"bruttoSumma":"12,50","alv":[]}');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('12.50'));
  });

  it('jättää pois kelvottoman päivän ja tyhjät kentät', () => {
    const t = jasennaKuitti('{"myyja":"  ","pvm":"2026-13-40","alv":[]}');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBeUndefined();
    expect(t.kuitti.pvm).toBeUndefined();
    expect(t.kuitti.valuutta).toBe('EUR');
  });

  it('palauttaa virheen kun JSONia ei löydy', () => {
    expect(jasennaKuitti('en osaa lukea tätä kuittia').ok).toBe(false);
  });

  it('palauttaa virheen muodottomalle JSONille', () => {
    expect(jasennaKuitti('{ tämä ei ole json ').ok).toBe(false);
  });

  it('korjaa lainausmerkittömät pilkkudesimaalit (malli tulostaa 6,40 numerona)', () => {
    const t = jasennaKuitti(
      '{"bruttoSumma": 6,40,"alv":[{"kanta":14,"netto":5,61,"vero":0,79,"brutto":6,40}]}',
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('6.40'));
    expect(t.kuitti.alv[0]?.netto).toBe(Euro.fromString('5.61'));
    expect(t.kuitti.alv[0]?.vero).toBe(Euro.fromString('0.79'));
    expect(t.kuitti.alv[0]?.brutto).toBe(Euro.fromString('6.40'));
  });

  it('korjaa pilkkudesimaalin myös kannassa (25,5 → 25.5)', () => {
    const t = jasennaKuitti('{"valuutta":"EUR","alv":[{"kanta":25,5,"netto":10,00}]}');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.alv[0]?.kanta).toBe(25.5);
  });

  it('säilyttää lainausmerkeissä olevat pilkkudesimaalit ennallaan', () => {
    const t = jasennaKuitti('{"bruttoSumma":"12,50","alv":[]}');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('12.50'));
  });

  it('hyväksyy alv-erittelyn oliona eikä taulukkona', () => {
    const t = jasennaKuitti('{"valuutta":"EUR","alv":{"kanta":14,"netto":5.61,"vero":0.79}}');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.alv).toHaveLength(1);
    expect(t.kuitti.alv[0]?.kanta).toBe(14);
  });

  it('normalisoi suomalaisen päivämäärän ISO-muotoon (nollatäyttö mukaan lukien)', () => {
    expect(jasennaKuitti('{"pvm":"15.07.2026","valuutta":"EUR","alv":[]}')).toMatchObject({
      ok: true,
      kuitti: { pvm: '2026-07-15' },
    });
    expect(jasennaKuitti('{"pvm":"5.7.2026","valuutta":"EUR","alv":[]}')).toMatchObject({
      ok: true,
      kuitti: { pvm: '2026-07-05' },
    });
  });

  it('jäsentää näkömallin realistisen tulosteen (aidat, taulukkokääre, pilkut, olio-alv, suomalainen pvm)', () => {
    const raaka =
      '```json\n[\n  {\n    "myyja": "Kahvila Aamu Oy",\n    "ytunnus": "2345678-1",\n' +
      '    "pvm": "15.07.2026",\n    "valuutta": "EUR",\n    "bruttoSumma": 6,40,\n' +
      '    "alv": {"kanta": 14, "netto": 5,61, "vero": 0,79, "brutto": 6,40}\n  }\n]\n```';
    const t = jasennaKuitti(raaka);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.kuitti.myyja).toBe('Kahvila Aamu Oy');
    expect(t.kuitti.pvm).toBe('2026-07-15');
    expect(t.kuitti.bruttoSumma).toBe(Euro.fromString('6.40'));
    expect(t.kuitti.alv).toHaveLength(1);
    expect(tasmaa(t.kuitti).tasmaa).toBe(true);
  });
});
