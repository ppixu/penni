import type {
  Asetukset,
  AuditCtx,
  AuditEntry,
  SaldoQuery,
  Storage,
  StoredTosite,
  TiliData,
  Tilikausi,
  TositeFilter,
} from '@penni/engine';
import { ResourceError, lataaKartta, tasoTyypista } from '@penni/engine';
import type {
  BudjettiRivi,
  Kohdennus,
  Kumppani,
  Liite,
  LiiteMeta,
  TositeVienti,
  UusiKohdennus,
  UusiKumppani,
  UusiLiite,
} from '@penni/engine';
import type { Cents } from '@penni/euro';

/** Deep clone of plain JSON-serializable data (vouchers/tilit/audit snapshots are all plain). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Metadata copy of a liite: strips the blob, deep-clones the rest. */
function metaKopio(l: Liite): LiiteMeta {
  const { data: _data, ...meta } = l;
  return clone(meta);
}

/** Chart rows are keyed by (numero, taso); see Storage.putTili. */
function karttaAvain(numero: number, taso: number): string {
  return `${numero}:${taso}`;
}

export interface MemorySeed {
  tilit?: TiliData[];
  tilikaudet?: Tilikausi[];
  asetukset?: Asetukset;
}

const KIRJANPIDOSSA = 100;

function bucketPredicate(bucket: TositeFilter['bucket']): (tila: number) => boolean {
  switch (bucket ?? 'kirjanpidossa') {
    case 'kirjanpidossa':
      return (t) => t >= KIRJANPIDOSSA;
    case 'luonnos':
      return (t) => t >= 50 && t < KIRJANPIDOSSA;
    case 'saapuneet':
      return (t) => t > 5 && t < 50;
    case 'malli':
      return (t) => t === 5;
    case 'poistetut':
      return (t) => t === 0;
  }
}

export function createMemoryStorage(seed: MemorySeed = {}): Storage {
  const vouchers = new Map<number, StoredTosite>();
  const loki: AuditEntry[] = [];
  let nextId = 1;

  const kumppanit = new Map<number, Kumppani>();
  let nextKumppaniId = 1;

  const liitteet = new Map<number, Liite>();
  let nextLiiteId = 1;

  const kohdennukset = new Map<number, Kohdennus>();
  // Kuten SQL:n AUTOINCREMENT: poistettua id:tä ei anneta uudelleen, ja eksplisiittinen id siirtää
  // laskurin ohitseen.
  let nextKohdennusId = 1;
  // Budjetti tilikausittain (avain = tilikauden alkaa).
  const budjetit = new Map<string, BudjettiRivi[]>();

  // Master-data stores, seeded from `seed`. Keyed by (numero, taso): Kitsas lets a heading and
  // an account, or two headings at different levels, share a numero.
  const chart = new Map<string, { data: TiliData; muokattu: boolean }>();
  for (const t of seed.tilit ?? []) {
    const taso = tasoTyypista(typeof t.tyyppi === 'string' ? t.tyyppi : '');
    chart.set(karttaAvain(Number(t.numero), taso), { data: t, muokattu: false });
  }
  const tilikaudet: Tilikausi[] = [...(seed.tilikaudet ?? [])];
  const asetukset = new Map<string, { arvo: string; muokattu: boolean }>();
  for (const [k, v] of Object.entries(seed.asetukset ?? {}))
    asetukset.set(k, { arvo: v, muokattu: false });

  function entry(tosite: number, tila: number, audit: AuditCtx, data: unknown | null): AuditEntry {
    const e: AuditEntry = { tosite, tila, aika: audit.aika, data };
    if (audit.userId !== undefined) e.userId = audit.userId;
    if (audit.lahde !== undefined) e.lahde = audit.lahde;
    return e;
  }

  const storage: Storage = {
    async getTosite(id) {
      const v = vouchers.get(id);
      return v ? clone(v) : null;
    },

    async listTositteet(filter) {
      const inBucket = bucketPredicate(filter.bucket);
      let rows = [...vouchers.values()].filter((v) => inBucket(v.tila));
      const alku = filter.alkupvm;
      if (alku !== undefined) rows = rows.filter((v) => v.pvm >= alku);
      const loppu = filter.loppupvm;
      if (loppu !== undefined) rows = rows.filter((v) => v.pvm <= loppu);
      if (filter.pvm !== undefined) rows = rows.filter((v) => v.pvm === filter.pvm);
      if (filter.tyyppi !== undefined) rows = rows.filter((v) => v.tyyppi === filter.tyyppi);
      if (filter.kumppani !== undefined) rows = rows.filter((v) => v.kumppani === filter.kumppani);
      if (filter.viite !== undefined) rows = rows.filter((v) => v.viite === filter.viite);
      rows.sort((a, b) => (a.pvm < b.pvm ? -1 : a.pvm > b.pvm ? 1 : a.id - b.id));
      return rows.map((v) => clone(v));
    },

    async listViennit(filter) {
      const out: TositeVienti[] = [];
      for (const v of vouchers.values()) {
        if (v.tila < KIRJANPIDOSSA) continue;
        for (const vienti of v.viennit) {
          if (filter.alkupvm !== undefined && vienti.pvm < filter.alkupvm) continue;
          if (filter.loppupvm !== undefined && vienti.pvm > filter.loppupvm) continue;
          if (filter.tili !== undefined && vienti.tili !== filter.tili) continue;
          out.push(clone(vienti));
        }
      }
      return out;
    },

    async saveTosite(t, audit) {
      const id = t.id ?? nextId++;
      const { id: _omit, ...rest } = t;
      const stored: StoredTosite = { ...clone(rest), id };
      vouchers.set(id, stored);
      loki.push(entry(id, stored.tila, audit, clone(stored)));
      return clone(stored);
    },

    async patchTositeTila(id, tila, tunniste, audit, data) {
      const v = vouchers.get(id);
      if (!v) throw new ResourceError('EITOSITETTA', `Tositetta ${id} ei ole`);
      const updated: StoredTosite = { ...v, tila, tunniste };
      vouchers.set(id, updated);
      loki.push(entry(id, tila, audit, data === undefined ? null : clone(data)));
      return clone(updated);
    },

    async softDeleteTosite(id, audit) {
      const v = vouchers.get(id);
      if (!v) throw new ResourceError('EITOSITETTA', `Tositetta ${id} ei ole`);
      vouchers.set(id, { ...v, tila: 0 });
      loki.push(entry(id, 0, audit, null));
    },

    async maxTunniste(alkaa, loppuu, sarja) {
      let max = 0;
      for (const v of vouchers.values()) {
        if (v.tila < KIRJANPIDOSSA) continue;
        if (v.pvm < alkaa || v.pvm > loppuu) continue;
        const sameBucket = sarja === null ? v.sarja === '' || v.sarja == null : v.sarja === sarja;
        if (sameBucket && v.tunniste > max) max = v.tunniste;
      }
      return max;
    },

    async querySaldot(q: SaldoQuery) {
      const out = new Map<number, Cents>();
      for (const voucher of vouchers.values()) {
        if (voucher.tila < KIRJANPIDOSSA) continue;
        for (const vienti of voucher.viennit) {
          if (q.alkupvm !== undefined && vienti.pvm < q.alkupvm) continue;
          if (q.loppupvmExclusive ? !(vienti.pvm < q.loppupvm) : !(vienti.pvm <= q.loppupvm))
            continue;
          if (q.tili !== undefined && vienti.tili !== q.tili) continue;
          const ts = String(vienti.tili);
          if (q.tiliAlkaen !== undefined && !(ts >= q.tiliAlkaen)) continue;
          if (q.tiliAsti !== undefined && !(ts < q.tiliAsti)) continue;
          if (q.kohdennus !== undefined && q.kohdennus !== 0 && vienti.kohdennus !== q.kohdennus)
            continue;
          if (q.kohdennukset !== undefined && !q.kohdennukset.includes(vienti.kohdennus ?? 0))
            continue;
          // Merkkaukset luetaan suoraan tallennetusta tosite-JSONista (lähde, ei erillistä taulua).
          if (q.merkkaus !== undefined && !(vienti.merkkaukset ?? []).includes(q.merkkaus))
            continue;
          const prev = out.get(vienti.tili) ?? 0;
          out.set(vienti.tili, (prev + vienti.debet - vienti.kredit) as Cents);
        }
      }
      return out;
    },

    async queryErat(q) {
      const out = new Map<number, Cents>();
      for (const voucher of vouchers.values()) {
        if (voucher.tila < KIRJANPIDOSSA) continue;
        for (const vienti of voucher.viennit) {
          if (vienti.era == null) continue;
          if (q.saldopvm !== undefined && !(vienti.pvm <= q.saldopvm)) continue;
          const prev = out.get(vienti.era) ?? 0;
          out.set(vienti.era, (prev + vienti.debet - vienti.kredit) as Cents);
        }
      }
      return out;
    },

    async getLoki(tositeId) {
      return loki.filter((e) => e.tosite === tositeId).map((e) => clone(e));
    },

    async tuoLoki(merkinnat) {
      for (const m of merkinnat) loki.push(clone(m));
    },

    // --- master data ---
    async getChart() {
      return lataaKartta([...chart.values()].map((c) => clone(c.data)));
    },
    async getTilikaudet() {
      return tilikaudet.map((k) => clone(k)).sort((a, b) => (a.alkaa < b.alkaa ? -1 : 1));
    },
    async getAsetukset() {
      const out: Asetukset = {};
      for (const [k, v] of asetukset) out[k] = v.arvo;
      return out;
    },
    async getInit() {
      const sarjat = new Set<string>();
      for (const v of vouchers.values()) if (v.tila > 0 && v.sarja) sarjat.add(v.sarja);
      return {
        asetukset: await storage.getAsetukset(),
        tilit: [...chart.values()].map((c) => clone(c.data)),
        tilikaudet: await storage.getTilikaudet(),
        tositesarjat: [...sarjat].sort(),
        kohdennukset: await storage.getKohdennukset(),
      };
    },
    async putTili(numero, data) {
      const taso = tasoTyypista(typeof data.tyyppi === 'string' ? data.tyyppi : '');
      chart.set(karttaAvain(numero, taso), { data: clone(data), muokattu: true });
    },
    async deleteTili(numero, taso = 0) {
      chart.delete(karttaAvain(numero, taso));
    },
    async putTilikausi(alkaa, kausi) {
      const i = tilikaudet.findIndex((k) => k.alkaa === alkaa);
      if (i >= 0) tilikaudet[i] = clone(kausi);
      else tilikaudet.push(clone(kausi));
    },
    async deleteTilikausi(alkaa) {
      const i = tilikaudet.findIndex((k) => k.alkaa === alkaa);
      if (i >= 0) tilikaudet.splice(i, 1);
    },
    async patchAsetukset(patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) asetukset.delete(k);
        else asetukset.set(k, { arvo: v, muokattu: true });
      }
    },
    async patchInit(patch) {
      for (const [k, v] of Object.entries(patch.asetukset ?? {})) {
        const cur = asetukset.get(k);
        if (cur?.muokattu) continue; // user edit wins
        asetukset.set(k, { arvo: v, muokattu: false });
      }
      for (const t of patch.tilit ?? []) {
        const numero = Number(t.numero);
        const taso = tasoTyypista(typeof t.tyyppi === 'string' ? t.tyyppi : '');
        const avain = karttaAvain(numero, taso);
        if (chart.get(avain)?.muokattu) continue; // user edit wins
        chart.set(avain, { data: clone(t), muokattu: false });
      }
    },

    // --- kumppanit ---
    async getKumppanit() {
      return [...kumppanit.values()]
        .sort((a, b) => (a.nimi < b.nimi ? -1 : a.nimi > b.nimi ? 1 : a.id - b.id))
        .map((k) => clone(k));
    },
    async saveKumppani(k: UusiKumppani) {
      const id = k.id ?? nextKumppaniId++;
      const { id: _omit, ...rest } = k;
      const stored: Kumppani = { ...clone(rest), id };
      kumppanit.set(id, stored);
      return clone(stored);
    },
    async deleteKumppani(id: number) {
      kumppanit.delete(id);
    },

    // --- kohdennukset ja budjetti ---
    async getKohdennukset() {
      return [...kohdennukset.values()].sort((a, b) => a.id - b.id).map((k) => clone(k));
    },
    async saveKohdennus(k: UusiKohdennus) {
      const id = k.id ?? nextKohdennusId;
      nextKohdennusId = Math.max(nextKohdennusId, id + 1);
      const { id: _omit, ...rest } = k;
      const stored: Kohdennus = { ...clone(rest), id };
      kohdennukset.set(id, stored);
      return clone(stored);
    },
    async deleteKohdennus(id: number) {
      kohdennukset.delete(id);
      for (const [kausi, rivit] of budjetit)
        budjetit.set(
          kausi,
          rivit.filter((r) => r.kohdennus !== id),
        );
    },
    async laskeKohdennustenKaytto() {
      const maarat = new Map<number, number>();
      const lisaa = (id: number) => maarat.set(id, (maarat.get(id) ?? 0) + 1);
      for (const v of vouchers.values()) {
        if (v.tila === 0) continue;
        for (const vienti of v.viennit) {
          if (vienti.kohdennus !== undefined && vienti.kohdennus > 0) lisaa(vienti.kohdennus);
          for (const m of new Set(vienti.merkkaukset)) lisaa(m); // kuten SQL:n (tosite, rivi, kohdennus)-avain
        }
      }
      return maarat;
    },
    async getBudjetti(tilikausi: string) {
      return (budjetit.get(tilikausi) ?? [])
        .map((r) => clone(r))
        .sort((a, b) => a.kohdennus - b.kohdennus || a.tili - b.tili);
    },
    async putBudjetti(tilikausi: string, rivit: BudjettiRivi[]) {
      budjetit.set(
        tilikausi,
        rivit
          .filter((r) => r.sentit !== 0)
          .map(({ kohdennus, tili, sentit }) => ({ kohdennus, tili, sentit })),
      );
    },

    // --- liitteet ---
    async laskeLiitteet() {
      const maarat = new Map<number, number>();
      for (const l of liitteet.values()) maarat.set(l.tosite, (maarat.get(l.tosite) ?? 0) + 1);
      return maarat;
    },
    async getLiitteet(tosite: number) {
      return [...liitteet.values()]
        .filter((l) => l.tosite === tosite)
        .sort((a, b) => a.id - b.id)
        .map(metaKopio);
    },
    async getLiite(id: number) {
      const l = liitteet.get(id);
      if (!l) return null;
      return { ...metaKopio(l), data: new Uint8Array(l.data) };
    },
    async saveLiite(l: UusiLiite) {
      if (l.id !== undefined) {
        // Selkeä id: PÄIVITETÄÄN olemassa oleva rivi paikallaan — ei koskaan poisteta tai
        // korvata toista riviä, eikä sallita kahta riviä samalla (tosite, roolinimi)-slotilla.
        const nykyinen = liitteet.get(l.id);
        if (!nykyinen) throw new ResourceError('LIITE_EI_LOYDY', `Liitettä ${l.id} ei ole`);
        if (l.roolinimi != null && l.roolinimi !== '') {
          const toinen = [...liitteet.values()].find(
            (x) => x.id !== l.id && x.tosite === l.tosite && x.roolinimi === l.roolinimi,
          );
          if (toinen)
            throw new ResourceError(
              'LIITE_ROOLI_VARATTU',
              `Rooli "${l.roolinimi}" on jo varattu toiselle liitteelle tositteella ${l.tosite}`,
            );
        }
        const { id: _drop, ...rest } = l;
        const stored: Liite = {
          ...clone({ ...rest, data: undefined }),
          data: new Uint8Array(l.data),
          id: l.id,
        };
        liitteet.set(l.id, stored);
        return metaKopio(stored);
      }

      let id: number | undefined;
      if (l.roolinimi != null && l.roolinimi !== '') {
        const osuma = [...liitteet.values()].find(
          (x) => x.tosite === l.tosite && x.roolinimi === l.roolinimi,
        );
        if (osuma) id = osuma.id;
      }
      if (id === undefined) id = nextLiiteId++;
      const { id: _drop, ...rest } = l;
      const stored: Liite = {
        ...clone({ ...rest, data: undefined }),
        data: new Uint8Array(l.data),
        id,
      };
      liitteet.set(id, stored);
      return metaKopio(stored);
    },
    async deleteLiite(id: number) {
      liitteet.delete(id);
    },
  };

  return storage;
}
