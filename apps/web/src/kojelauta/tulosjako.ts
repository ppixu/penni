import { tasonOtsikko } from '@/tilikartta/tilinakyma';
import { type Tili, nimi } from '@penni/engine';
import type { Cents } from '@penni/euro';

/** Yksi kaavion erä: ryhmä tai tili, summa aina positiivisena. */
export interface JakoEra {
  avain: string;
  nimi: string;
  summa: Cents;
}

export interface TulosJako {
  tulot: JakoEra[];
  kulut: JakoEra[];
  /** Σtulot − Σkulut; sama kuin kauden tulos, kun kaikki tuloslaskelman tilit ovat mukana. */
  tulos: Cents;
}

/** Ryhmien yhteinen avain, johon pienimmät erät kootaan. */
export const MUUT = 'muut';

/** Tuloslaskelman tili (ei 1 Vastaavaa eikä 2 Vastattavaa; sama jako kuin saldotaulussa). */
function onTulostili(numero: number): boolean {
  const eka = String(numero)[0];
  return eka !== '1' && eka !== '2';
}

/**
 * Kauden tuloslaskelma tuloiksi ja kuluiksi kaavioita varten. `saldot` on kredit-positiivinen
 * (tulot +, kulut −). Ryhmittely `'paaryhma'` kokoaa tilit H2-otsikoittain ("Henkilöstökulut");
 * jos jollekin puolelle jää vain yksi ryhmä, se puoli näytetään tileittäin, koska yksi palkki ei
 * kerro mitään. Ryhmän puoli ratkeaa sen nettosummasta, joten esim. saadut palkkakorvaukset
 * pienentävät henkilöstökuluja eivätkä näy tulona. Yli `enintaan` erää kootaan "Muut"-erään.
 */
export function tulosjako(
  kartta: readonly Tili[],
  saldot: ReadonlyMap<number, Cents>,
  ryhmittely: 'paaryhma' | 'tili',
  enintaan: number,
): TulosJako {
  const tilit = new Map(kartta.filter((t) => t.otsikkotaso === 0).map((t) => [t.numero, t]));
  const otsikko = tasonOtsikko(kartta, 2);
  const tilinEra = (numero: number) => ({
    avain: String(numero),
    nimi: tilit.has(numero) ? nimi(tilit.get(numero) as Tili) : String(numero),
  });

  const rivit = [...saldot].filter(([numero, s]) => s !== 0 && onTulostili(numero));
  const kokoa = (ryhma: (numero: number) => { avain: string; nimi: string }) => {
    const summat = new Map<string, { nimi: string; summa: number }>();
    for (const [numero, s] of rivit) {
      const r = ryhma(numero);
      const v = summat.get(r.avain);
      summat.set(r.avain, { nimi: r.nimi, summa: (v?.summa ?? 0) + s });
    }
    return [...summat].map(([avain, v]) => ({ avain, nimi: v.nimi, netto: v.summa }));
  };
  const puolet = (erat: { avain: string; nimi: string; netto: number }[]) => ({
    tulot: erat.filter((e) => e.netto > 0),
    kulut: erat.filter((e) => e.netto < 0),
  });

  let { tulot, kulut } = puolet(kokoa(tilinEra));
  if (ryhmittely === 'paaryhma') {
    const ryhmanEra = (numero: number) => {
      const o = otsikko(numero);
      return o ? { avain: `H${o.numero}`, nimi: nimi(o) } : tilinEra(numero);
    };
    const ryhmittain = puolet(kokoa(ryhmanEra));
    // Puolen ainoa ryhmä avataan tileiksi. Sen vastamerkkiset tilit siirtyvät toiselle puolelle,
    // joten molemmat puolet summautuvat yhä samaan tulokseen.
    const avattavat = new Set(
      [ryhmittain.tulot, ryhmittain.kulut].filter((l) => l.length === 1).map((l) => l[0]?.avain),
    );
    ({ tulot, kulut } = puolet(
      kokoa((numero) => {
        const r = ryhmanEra(numero);
        return avattavat.has(r.avain) ? tilinEra(numero) : r;
      }),
    ));
  }

  const erat = (lista: typeof tulot, muutNimi: string): JakoEra[] => {
    const jarjestetty = lista
      .map((e) => ({ avain: e.avain, nimi: e.nimi, summa: Math.abs(e.netto) as Cents }))
      .sort((a, b) => b.summa - a.summa);
    if (jarjestetty.length <= enintaan) return jarjestetty;
    const muut = jarjestetty.slice(enintaan - 1).reduce((s, e) => s + e.summa, 0) as Cents;
    return [...jarjestetty.slice(0, enintaan - 1), { avain: MUUT, nimi: muutNimi, summa: muut }];
  };

  const summa = (l: readonly JakoEra[]) => l.reduce((s, e) => s + e.summa, 0);
  const tulotErat = erat(tulot, 'Muut tulot');
  const kulutErat = erat(kulut, 'Muut kulut');
  return {
    tulot: tulotErat,
    kulut: kulutErat,
    tulos: (summa(tulotErat) - summa(kulutErat)) as Cents,
  };
}

/** Kaavioiden tasaeurot: "75 465 €" (pyöristys lähimpään euroon, puolikkaat nollasta poispäin). */
export function muotoileEuroPyorea(c: Cents): string {
  const eurot = Math.trunc((Math.abs(c) + 50) / 100);
  const ryhmitelty = String(eurot).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${c < 0 && eurot > 0 ? '−' : ''}${ryhmitelty}\u00a0€`;
}

/** Osuus kokonaisluvuksi pyöristettynä prosenttina; alle 1 % näytetään "<1 %". */
export function muotoileOsuus(osa: number, kokonais: number): string {
  if (kokonais <= 0) return '';
  const p = Math.round((osa / kokonais) * 100);
  return p === 0 && osa > 0 ? '<1\u00a0%' : `${p}\u00a0%`;
}
