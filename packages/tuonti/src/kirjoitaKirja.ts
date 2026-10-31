import type { AuditCtx, Storage } from '@penni/engine';
import type { KitsasKirja, TuontiEdistyminen, TuontiRaportti } from './tyypit.js';

/** The Kitsas schema version this importer was written against. */
const TUETTU_KPVERSIO = '24';

/** Default reason for a skipped Kitsas table: the feature has no Tier-0 counterpart. */
const OLETUS_OHITUKSEN_SYY = 'Penni ei mallinna sitä.';

/**
 * Per-table reason, where the default would be wrong. Tositeloki is the case that matters:
 * Penni DOES model an append-only audit log (it is a core invariant) — the importer simply
 * refuses to inherit another book's history, and writes its own entries instead. Saying
 * "Penni ei mallinna sitä" about it would be plainly false to the reader.
 */
const OHITUKSEN_SYY: Record<string, string> = {
  Tositeloki: 'Penni ei peri toisen kirjanpidon lokia, vaan kirjaa tuonnista omat lokimerkintänsä.',
};

export interface KirjoitusValinnat {
  /** ISO timestamp stamped on every audit entry. */
  aika: string;
  /** Optional progress callback; called at least once per phase. */
  edistyminen?: (e: TuontiEdistyminen) => void;
}

/**
 * Write a read Kitsas book into any Penni Storage backend.
 *
 * Order matters and is enforced here: viennit reference tilit, tositteet reference kumppanit,
 * and liitteet reference tositteet. `tila` and `tunniste` are written verbatim, so finalized
 * vouchers keep the numbers they had in Kitsas.
 *
 * Kitsas's own Tositeloki is NOT carried over. Each saveTosite appends a fresh audit entry
 * stamped with `aika` — the honest record that these vouchers entered THIS book by import.
 * The whole import shares one `aika`, so "what arrived in this import" is one timestamp query.
 * AuditCtx carries no provenance field by design; see the spec's audit-log section.
 */
export async function kirjoitaKirja(
  kirja: KitsasKirja,
  storage: Storage,
  valinnat: KirjoitusValinnat,
): Promise<TuontiRaportti> {
  const audit: AuditCtx = { aika: valinnat.aika };
  const ilmoita = (vaihe: TuontiEdistyminen['vaihe'], tehty: number, kaikkiaan: number): void =>
    valinnat.edistyminen?.({ vaihe, tehty, kaikkiaan });

  const varoitukset: string[] = [];
  if (kirja.kpVersio && kirja.kpVersio !== TUETTU_KPVERSIO) {
    varoitukset.push(
      `Kirjanpidon versio on ${kirja.kpVersio}, tuonti on tehty versiolle ${TUETTU_KPVERSIO}. Tarkista tulos huolellisesti.`,
    );
  }

  // 1. tilit + otsikot
  ilmoita('tilit', 0, kirja.tilit.length);
  let n = 0;
  for (const tili of kirja.tilit) {
    await storage.putTili(Number(tili.numero), tili);
    ilmoita('tilit', ++n, kirja.tilit.length);
  }

  // 2. tilikaudet
  ilmoita('tilikaudet', 0, kirja.tilikaudet.length);
  n = 0;
  for (const kausi of kirja.tilikaudet) {
    await storage.putTilikausi(kausi.alkaa, kausi);
    ilmoita('tilikaudet', ++n, kirja.tilikaudet.length);
  }

  // 3. asetukset
  const avaimet = Object.keys(kirja.asetukset);
  ilmoita('asetukset', 0, avaimet.length);
  await storage.patchAsetukset(kirja.asetukset);
  ilmoita('asetukset', avaimet.length, avaimet.length);

  // 4. kumppanit (ennen tositteita: tosite.kumppani viittaa näihin)
  ilmoita('kumppanit', 0, kirja.kumppanit.length);
  n = 0;
  for (const kumppani of kirja.kumppanit) {
    await storage.saveKumppani(kumppani);
    ilmoita('kumppanit', ++n, kirja.kumppanit.length);
  }

  // 5. tositteet + viennit
  ilmoita('tositteet', 0, kirja.tositteet.length);
  n = 0;
  let viennit = 0;
  for (const tosite of kirja.tositteet) {
    await storage.saveTosite(tosite, audit);
    viennit += tosite.viennit.length;
    ilmoita('tositteet', ++n, kirja.tositteet.length);
  }

  // 6. liitteet (viimeisenä: viittaavat tositteisiin)
  ilmoita('liitteet', 0, kirja.liitteet.length);
  n = 0;
  for (const liite of kirja.liitteet) {
    await storage.saveLiite(liite);
    ilmoita('liitteet', ++n, kirja.liitteet.length);
  }

  // tyyppi 0 (MUU) is a real, named Kitsas voucher type — not a missing value. The
  // static type says `tyyppi: number`, but Kitsas's Tosite.tyyppi column is nullable
  // with no default, and muunnaTosite passes it through unguarded, so a genuinely
  // typeless row arrives as `tyyppi: null` at runtime. Detect that at runtime instead
  // of trusting the type.
  const tuntemattomat = kirja.tositteet.filter((t) => typeof t.tyyppi !== 'number').length;
  if (tuntemattomat > 0) {
    varoitukset.push(`${tuntemattomat} tositetta ilman tyyppiä tuotiin sellaisenaan.`);
  }
  for (const [taulu, maara] of Object.entries(kirja.ohitetut)) {
    const syy = OHITUKSEN_SYY[taulu] ?? OLETUS_OHITUKSEN_SYY;
    varoitukset.push(`Taulua ${taulu} (${maara} riviä) ei tuotu — ${syy}`);
  }

  return {
    tilit: kirja.tilit.length,
    tilikaudet: kirja.tilikaudet.length,
    asetukset: avaimet.length,
    kumppanit: kirja.kumppanit.length,
    tositteet: kirja.tositteet.length,
    viennit,
    liitteet: kirja.liitteet.length,
    ohitetut: kirja.ohitetut,
    varoitukset,
  };
}
