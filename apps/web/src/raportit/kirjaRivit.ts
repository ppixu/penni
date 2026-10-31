import type { IsoDate, ListattuTosite, SaldotTulos } from '@penni/engine';
import { onkoVastaavaa } from '@penni/engine';
import { Euro } from '@penni/euro';
import type { Cents } from '@penni/euro';

/** Yksi kirjanpidon vienti raporttiriviksi litistettynä tositteensa tiedoilla. */
export interface KirjaRivi {
  /** Vakaa avain: tositteen id + viennin järjestysnumero tositteella. */
  avain: string;
  pvm: IsoDate;
  tositeId: number;
  /** Tositetunniste kuten muualla sovelluksessa ("A 12"); tyhjä jos tunnistetta ei ole. */
  tosite: string;
  tili: number;
  /**
   * Viennin selite, muuten tositteen otsikko; tyhjä, jos kumpaakaan ei ole. Kitsaksesta tuoduilla
   * tositteilla otsikko on kopioitu jokaisen viennin selitteeksi, Pennin omilla (ruudukko,
   * täsmäytys) usein vain tositteelle — ilman varasijaa rivi jäisi kirjoissa tyhjäksi.
   */
  selite: string;
  /** Tositteen kumppanin id, jos on (selite puuttuessa näytetään kumppanin nimi). */
  kumppani: number | undefined;
  debet: Cents;
  kredit: Cents;
}

/** Tositteen tunniste näytettävässä muodossa, sama kuin tositelistassa (tositteet.index.tsx). */
export function tositeTunniste(t: Pick<ListattuTosite, 'sarja' | 'tunniste'>): string {
  return t.tunniste > 0 ? `${t.sarja} ${t.tunniste}`.trim() : '';
}

/**
 * Jakson viennit päiväjärjestyksessä: ensin viennin pvm, sitten tositteen pvm ja id (tallennusjärjestys),
 * sitten viennin paikka tositteella. Suodatus tehdään viennin pvm:llä (viennit-rajapinnan tapaan,
 * ks. laatijanpaivakirja.cpp:109-111), ei tositteen pvm:llä. Huom: haku listaa tositteet tositteen
 * pvm:n mukaan, joten vienti, jonka pvm on jaksossa mutta tositteen pvm sen ulkopuolella, ei tule mukaan.
 */
export function kirjaRivit(
  tositteet: readonly ListattuTosite[],
  alkupvm: IsoDate,
  loppupvm: IsoDate,
): KirjaRivi[] {
  const rivit: { rivi: KirjaRivi; tpvm: IsoDate; tid: number; i: number }[] = [];
  for (const t of tositteet) {
    t.viennit.forEach((v, i) => {
      if (v.pvm < alkupvm || v.pvm > loppupvm) return;
      rivit.push({
        tpvm: t.pvm,
        tid: t.id,
        i,
        rivi: {
          avain: `${t.id}-${i}`,
          pvm: v.pvm,
          tositeId: t.id,
          tosite: tositeTunniste(t),
          tili: v.tili,
          selite: v.selite || t.otsikko || '',
          kumppani: t.kumppani,
          debet: v.debet,
          kredit: v.kredit,
        },
      });
    });
  }
  rivit.sort(
    (a, b) =>
      a.rivi.pvm.localeCompare(b.rivi.pvm) ||
      a.tpvm.localeCompare(b.tpvm) ||
      a.tid - b.tid ||
      a.i - b.i,
  );
  return rivit.map((r) => r.rivi);
}

/** Selite riville: viennin oma (tai tositteen otsikko), muuten kumppanin nimi (laatijanpaivakirja.cpp:166-168). */
export function riviSelite(rivi: KirjaRivi, kumppaninNimi: (id: number) => string | undefined) {
  if (rivi.selite !== '') return rivi.selite;
  return rivi.kumppani !== undefined ? (kumppaninNimi(rivi.kumppani) ?? '') : '';
}

/** Debet- ja kreditsummat. */
export function summaa(rivit: readonly { debet: Cents; kredit: Cents }[]) {
  let debet = Euro.fromCents(0);
  let kredit = Euro.fromCents(0);
  for (const r of rivit) {
    debet = Euro.add(debet, r.debet);
    kredit = Euro.add(kredit, r.kredit);
  }
  return { debet, kredit };
}

/** Pääkirjan rivi: vienti + juokseva saldo sen jälkeen. */
export interface PaakirjaRivi extends KirjaRivi {
  saldo: Cents;
}

export interface PaakirjaTili {
  tili: number;
  /** Alkusaldo jakson alussa (vastaavaa debet-positiivinen, muut kredit-positiivinen). */
  alkusaldo: Cents;
  rivit: PaakirjaRivi[];
  debet: Cents;
  kredit: Cents;
  /** Jakson muutos tilin omaan suuntaan (laatijanpaakirja.cpp:222-224). */
  muutos: Cents;
  loppusaldo: Cents;
}

/**
 * Pääkirjan tilit numerojärjestyksessä. Mukaan tulee tili, jolla on vientejä jaksossa tai nollasta
 * poikkeava alkusaldo (laatijanpaakirja.cpp:154-155). Saldon etumerkki seuraa Kitsasta: vastaavaa-tilin
 * saldo on debet − kredit, kaikkien muiden kredit − debet (laatijanpaakirja.cpp:185-191), eli
 * luonteeltaan kredit-tilit näytetään positiivisina. "Vastaavaa" tunnistetaan tilinumeron
 * ensimmäisestä numerosta kuten saldot-resurssissa (onkoVastaavaa), jotta alkusaldo ja juokseva
 * saldo ovat samaa etumerkkiä.
 */
export function paakirjaTilit(
  rivit: readonly KirjaRivi[],
  alkusaldot: SaldotTulos | undefined,
): PaakirjaTili[] {
  const ryhmat = new Map<number, KirjaRivi[]>();
  for (const [tili, saldo] of alkusaldot ?? []) {
    if (saldo !== 0) ryhmat.set(tili, []);
  }
  for (const r of rivit) {
    const lista = ryhmat.get(r.tili);
    if (lista) lista.push(r);
    else ryhmat.set(r.tili, [r]);
  }
  return [...ryhmat.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tili, tilinRivit]) => {
      const alkusaldo = alkusaldot?.get(tili) ?? Euro.fromCents(0);
      const vastaavaa = onkoVastaavaa(tili);
      let saldo = alkusaldo;
      const saldollisetRivit = tilinRivit.map((r): PaakirjaRivi => {
        saldo = vastaavaa
          ? Euro.sub(Euro.add(saldo, r.debet), r.kredit)
          : Euro.sub(Euro.add(saldo, r.kredit), r.debet);
        return { ...r, saldo };
      });
      const { debet, kredit } = summaa(tilinRivit);
      const muutos = vastaavaa ? Euro.sub(debet, kredit) : Euro.sub(kredit, debet);
      return { tili, alkusaldo, rivit: saldollisetRivit, debet, kredit, muutos, loppusaldo: saldo };
    });
}
