import { type Storage, haeAlvLaskelma } from '@penni/engine';
import type { AlvEro, KitsasKirja, TaysmaytysEro, TaysmaytysRaportti } from './tyypit.js';

/** Vouchers at or above this state count toward balances (mirrors TositeTila.KIRJANPIDOSSA). */
const KIRJANPIDOSSA = 100;

/** Sum the source book's finalized ledger rows per account, within one fiscal year. */
function kitsaksenSaldot(kirja: KitsasKirja, alkaa: string, loppuu: string): Map<number, number> {
  const saldot = new Map<number, number>();
  for (const tosite of kirja.tositteet) {
    if (tosite.tila < KIRJANPIDOSSA) continue;
    for (const vienti of tosite.viennit) {
      if (vienti.pvm < alkaa || vienti.pvm > loppuu) continue;
      saldot.set(vienti.tili, (saldot.get(vienti.tili) ?? 0) + vienti.debet - vienti.kredit);
    }
  }
  return saldot;
}

/**
 * Count finalized-voucher ledger rows whose date falls within no fiscal year. The per-year
 * loop in tarkistaTuonti only ever queries inside kirja.tilikaudet, so a row dated outside all
 * of them is queried by neither side and would otherwise never produce an `erot` entry.
 */
function laskeUlkopuoliset(kirja: KitsasKirja): number {
  let n = 0;
  for (const tosite of kirja.tositteet) {
    if (tosite.tila < KIRJANPIDOSSA) continue;
    for (const vienti of tosite.viennit) {
      const kuuluuKauteen = kirja.tilikaudet.some(
        (kausi) => vienti.pvm >= kausi.alkaa && vienti.pvm <= kausi.loppuu,
      );
      if (!kuuluuKauteen) n++;
    }
  }
  return n;
}

/** Return code 308: tax payable (Kitsas `maksettava`, Penni `AlvLaskelmaTulos.maksettava`). */
const MAKSETTAVA = 308;

/**
 * Recompute every VAT return filed in Kitsas with Penni's own VAT engine and list each figure
 * that comes out differently. This is the one check that does not just re-sum the same rows on
 * both sides: it proves Penni reads VAT codes, rates and cash-basis rules the way Kitsas did.
 */
async function vertaaAlvIlmoitukset(kirja: KitsasKirja, storage: Storage): Promise<AlvEro[]> {
  const erot: AlvEro[] = [];
  for (const ilmoitus of kirja.alvIlmoitukset) {
    const { alkupvm, loppupvm } = ilmoitus;
    const laskelma = await haeAlvLaskelma(storage, { alkupvm, loppupvm });
    if (laskelma.maksettava !== ilmoitus.maksettava) {
      erot.push({
        alkupvm,
        loppupvm,
        koodi: MAKSETTAVA,
        kitsas: ilmoitus.maksettava,
        penni: laskelma.maksettava,
      });
    }
    const koodit = new Set<number>([
      ...Object.keys(ilmoitus.koodit).map(Number),
      ...laskelma.koodit.keys(),
    ]);
    koodit.delete(MAKSETTAVA);
    for (const koodi of [...koodit].sort((a, b) => a - b)) {
      const kitsas = ilmoitus.koodit[koodi] ?? 0;
      const penni = laskelma.koodit.get(koodi) ?? 0;
      if (kitsas !== penni) erot.push({ alkupvm, loppupvm, koodi, kitsas, penni });
    }
  }
  return erot;
}

/**
 * Compare the source book against what actually landed in storage: per-account balances for
 * each fiscal year, row counts, and every filed VAT return recomputed. This is what turns
 * "it imported" into "the numbers match".
 */
export async function tarkistaTuonti(
  kirja: KitsasKirja,
  storage: Storage,
): Promise<TaysmaytysRaportti> {
  const erot: TaysmaytysEro[] = [];

  for (const kausi of kirja.tilikaudet) {
    const odotetut = kitsaksenSaldot(kirja, kausi.alkaa, kausi.loppuu);
    const saadut = await storage.querySaldot({ alkupvm: kausi.alkaa, loppupvm: kausi.loppuu });
    const tilit = new Set<number>([...odotetut.keys(), ...saadut.keys()]);
    for (const tili of [...tilit].sort((a, b) => a - b)) {
      const kitsas = odotetut.get(tili) ?? 0;
      const penni = saadut.get(tili) ?? 0;
      if (kitsas !== penni) erot.push({ tilikausi: kausi.alkaa, tili, kitsas, penni });
    }
  }

  const ulkopuoliset = laskeUlkopuoliset(kirja);

  const kumppanit = await storage.getKumppanit();
  const kartta = await storage.getChart();
  const kaudet = await storage.getTilikaudet();
  let liitteita = 0;
  for (const tosite of kirja.tositteet) {
    liitteita += (await storage.getLiitteet(tosite.id)).length;
  }

  // Finalized (tila >= 100) vouchers and their ledger rows, whole book, both sides.
  // The per-account balance check above is a NET aggregate, so two vouchers whose deltas
  // cancel within the same account and fiscal year (a duplicate-and-reversed pair, or a
  // drop-one-duplicate-another bug) would pass it unnoticed; comparing raw counts catches that.
  const finalisoidut = kirja.tositteet.filter((t) => t.tila >= KIRJANPIDOSSA);
  const kirjanpidossa = await storage.listTositteet({ bucket: 'kirjanpidossa' });

  const maarat: Record<string, [number, number]> = {
    tilit: [kirja.tilit.length, kartta.length],
    tilikaudet: [kirja.tilikaudet.length, kaudet.length],
    kumppanit: [kirja.kumppanit.length, kumppanit.length],
    liitteet: [kirja.liitteet.length, liitteita],
    tositteet: [finalisoidut.length, kirjanpidossa.length],
    viennit: [
      finalisoidut.reduce((n, t) => n + t.viennit.length, 0),
      kirjanpidossa.reduce((n, t) => n + t.viennit.length, 0),
    ],
  };

  const maaratTasmaavat = Object.values(maarat).every(([a, b]) => a === b);
  const alvErot = await vertaaAlvIlmoitukset(kirja, storage);
  return {
    tasmaa: erot.length === 0 && maaratTasmaavat && ulkopuoliset === 0 && alvErot.length === 0,
    erot,
    maarat,
    ulkopuoliset,
    alvErot,
    alvIlmoituksia: kirja.alvIlmoitukset.length,
    kattamattomat: kirja.kattamattomat,
  };
}
