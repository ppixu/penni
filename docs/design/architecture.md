# Penni — Modern Rewrite Design

**Status:** Draft for review · **Date:** 2026-06-26 · **Scope:** System architecture + deep specification of the Tier‑0 core.

**Penni** is modern Finnish small-business bookkeeping software, inspired by and partly derived from **Kitsas** (formerly Kitupiikki; see `NOTICE.md`), the Finnish open-source bookkeeping software for small organisations. The goal is **not** to redesign accounting: the Finnish bookkeeping/tax business logic and the existing REST contract are excellent and are preserved almost verbatim. The goal is to shed the Qt machinery and rebuild on a modern, typed, web-first stack with a simple, beautiful UI — capable of toiminimi/yhdistys/asunto-osakeyhtiö/osakeyhtiö books alike.

This document grounds itself in a reverse-engineering pass over the current C++/Qt codebase, **then an adversarial re-verification of every claim against that source**. File:line citations are **relative to the `kitsas-source/kitsas/` app directory** (e.g. `model/tosite.cpp` = `kitsas-source/kitsas/model/tosite.cpp`) unless noted.

A handful of places where the legacy code is *wrong* and the rewrite should deliberately **fix** rather than preserve it are called out explicitly (the saldot float arithmetic, §5.7/§9; ambiguous type-mask resolution, §5.2).

---

## 1. Goals & non-goals

**Goals**
- Reimplement the proven Finnish accounting engine in **typed TypeScript**, exposing the same REST contract the current app already uses.
- A **simple, beautiful, modern web app** approachable for a small-business owner, with a power-user keyboard layer for accountants.
- **Hybrid local + cloud**: own your book offline (local-first), or run it in the cloud — same app, same engine.
- Preserve every **legal invariant** of Finnish bookkeeping (immutability of the *record*, gapless numbering, audit trail, retention) by construction.
- Make the dual backend (local vs cloud) **impossible to drift** — the single worst failure mode of the current architecture.

**Non-goals (for this spec)**
- Pixel-level visual/UX design — deserves its own brainstorm with mockups (§13).
- Tiers 1–5 detail (VAT engine, invoicing, year-end, authority filing, SaaS) — sketched in the roadmap (§12); each gets its own spec.
- Migrating or replacing Kitsas' hosted cloud service itself.

## 2. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Deployment & data ownership | **Hybrid (local-first + cloud sync)** | Preserves Kitsas' idea of owning your file while offering modern cloud. |
| Engine strategy | **New TypeScript engine implementing the proven REST contract** | Reuse the excellent contract; shed Qt; one engine for both transports. |
| Spec scope | **Architecture blueprint + deep Tier‑0 core** | Enough to start building the irreducible legal core. |
| Frontend | **React + Vite + shadcn/Tailwind** | Richest ecosystem for a polished, modern UI; fast to a beautiful result. |
| Contract tooling | **ts-rest + zod** | One schema set → typed client + server router + runtime validation; cannot drift. |
| Server runtime / cloud DB | **Node 22 LTS / PostgreSQL** | Boring, ubiquitous, reversible (engine is runtime-agnostic). |
| Local persistence | **SQLite-WASM (wa-sqlite + OPFS)** | Engine runs in the browser; fully offline; schema mirrors the legacy `.kitsas`. |
| Local packaging | **Installable PWA first, Tauri wrapper later** | No bundled Node needed (engine runs in the webview); Tauri only for OS niceties. |
| Sync model | **Book-level single source of truth + ownership-transfer push/pull; server-authoritative cloud** | CRDT merge is legally unsound under gapless numbering + period locks (§4). |

## 3. System architecture — *one engine, two transports*

The central principle:

> The accounting engine is **pure, storage-agnostic TypeScript** exposing the REST contract. The React app never knows whether that contract is satisfied **in-process** (local-first) or **over HTTP** (cloud). Same engine code, same contract, two transports.

This is the single-language version of what Kitsas already does — `SQLiteModel` and `PilviModel` both answering one `KpKysely` (`db/kpkysely.h`, `sqlite/routes/*`, `pilvi/pilvimodel.*`). Now the "SQLite route" and the "cloud route" are *the same TypeScript functions*, so they cannot drift.

The **full contract is ~22 resources** spanning all tiers; it grows tier by tier. **Tier‑0 implements exactly 7** (§6).

```
                         ┌───────────────────────────────────────┐
                         │   React app (Vite + shadcn/Tailwind)    │
                         │   TanStack Query · typed contract client│
                         └───────────────┬─────────────────────────┘
                                         │  KpClient (typed contract)
                  ┌──────────────────────┴───────────────────────┐
                  │                                               │
        LOCAL-FIRST transport                          CLOUD transport
        (in-process call)                              (HTTP fetch)
                  │                                               │
                  ▼                                               ▼
        ┌───────────────────┐                          ┌───────────────────┐
        │  @penni/engine   │  ◄── same package ──►     │  @penni/engine   │
        │  (domain core +   │                          │  (in a Node HTTP   │
        │   Tier-0 resources)│                         │   server)          │
        └─────────┬─────────┘                          └─────────┬─────────┘
                  │ Storage port                                 │ Storage port
                  ▼                                               ▼
        SQLite-WASM / OPFS                              PostgreSQL
        (offline, in the browser)                       (multi-tenant cloud)
```

The engine runs **in the browser itself** for local-first and **on a server** for cloud — there is no second implementation to keep in sync.

### 3.1 Monorepo layout (pnpm workspace + Turborepo)

```
penni/
├─ packages/
│  ├─ euro/              integer-cents money + rounding (everything depends on it)
│  ├─ contract/          typed REST contract (zod schemas + ts-rest) — the seam
│  ├─ engine/            pure domain core + the Tier-0 resource handlers (no I/O)
│  ├─ storage-sqlite/    SQLite-WASM adapter (local) — code-split, see §3.3
│  ├─ storage-postgres/  Postgres adapter (cloud)
│  └─ ui/                shared shadcn-based component kit
├─ apps/
│  ├─ web/               React + Vite SPA (local-first PWA AND cloud client)
│  └─ server/            Node HTTP host wrapping engine + Postgres
└─ charts/               three seed charts as JSON (yritys / yhdistys / asoy)
```

### 3.2 Layered responsibility

```
pure core (no I/O, synchronous)         resource layer (async, uses Storage port)
─────────────────────────────          ──────────────────────────────────────────
euro · accounts · vouchers      ◄──used──   /init /tositteet /viennit /saldot
validation · report-dsl                      /tilikaudet /tilit /asetukset
                                                │ enforces numbering, locks,
                                                │ soft-delete, audit log
                                                ▼  Storage port (repository iface)
                                       storage-sqlite  |  storage-postgres
```

The pure core is synchronous and trivially testable. The only async lives in storage. Everything needing persistence (sequential numbering, audit logging, lock enforcement, saldo queries) lives in the resource layer, never in the UI.

### 3.3 Browser / WASM runtime constraints (must design in)

The "same engine in the browser" claim has hard constraints that shape deployment:

- **Cross-origin isolation:** synchronous OPFS access (wa-sqlite's fast path) requires the app be served with `COOP: same-origin` + `COEP: require-corp`. This is a hosting requirement for the local-first PWA, not optional.
- **Bundle size:** the SQLite-WASM adapter is several hundred KB. It is **code-split / lazy-loaded** so cloud-only clients (which use `HttpClient`) never download it.
- **Multi-tab concurrency:** several tabs can open one OPFS database and would race the numbering transaction. Tier‑0 serializes book access with the **Web Locks API** (single active writer per book) and uses `BroadcastChannel` to notify other tabs to refetch. Gapless numbering depends on this being correct.

## 4. Sync & multi-user model

Real-time multi-writer CRDT merge is **legally unsound** here: gapless sequential numbering (§5.6) and period locks (`TilitPaatetty`, §5.6) cannot tolerate naive merges. Therefore:

- **Book-level single source of truth.** A book is authoritative in exactly one place at a time — local OPFS *or* a cloud tenant.
- **Ownership-transfer push/pull.** Push/pull moves the *authoritative copy* of a whole book between local and cloud as a full, deterministic snapshot. **Voucher numbers are preserved, never renumbered** (they are a legal property of the record, §11.2). Only the location currently holding the book may finalize new vouchers; the other side holds a read-only copy until ownership transfers back. A simple **book lease** records who owns it.
- **Only the authoritative writer assigns `tunniste`.** Offline finalize against a cloud-owned book is not allowed; an offline draft stays `tila<100`/`tunniste=0` in the outbox and is finalized (numbered) on reconnect/replay by the authoritative side.
- **Cloud is server-authoritative** for its books, with the server as the single writer-of-record (as today).

**Tier‑0 builds neither sync nor the snapshot machinery.** "Designed in now" means only that the Tier‑0 schema must not *preclude* a later deterministic, hashable snapshot: stable row ordering, no derived-only state stored as truth, and the append-only log present from day one. Sync is Tier‑5; the hashable e-archive snapshot is Tier‑3; both reuse these properties.

## 5. The Tier‑0 domain core (deep specification)

Tier‑0 is the irreducible core that lets a small business keep **legal Finnish books**: money, chart of accounts, vouchers with validation, fiscal year, numbering/audit, balances, and the income statement + balance sheet.

### 5.1 `@penni/euro` — integer cents, the bedrock

All money is **integer cents**, end to end — never a float (from `model/euro.{h,cpp}`). Cents are stored as a plain `number` (safe to ±90 trillion €; the wire format is the `"N.NN"` string anyway). A branded type stops raw numbers leaking in; arithmetic is a pure function module — zero object allocation when summing thousands of saldo rows.

```ts
export type Cents = number & { readonly __euro: unique symbol };
export const Euro = {
  fromCents: (n: number): Cents => Math.trunc(n) as Cents,
  fromString, toString, add, sub, neg, abs, compare, equals,
  // round-half-away-from-zero — the ONE rounding rule, used by VAT + invoice rows
  mulRate: (c: Cents, rate: number): Cents => roundHalfAway(c * rate) as Cents,
};
```

The wire-format rules below are **normative** (the code above is illustrative):

- **`toString(c)`** → `"N.NN"`: integer-euro part, `.`, exactly two cent digits (zero-padded for <10 cents); explicit leading `-` for negatives; `"0.00"` for zero.
- **`fromString(s)`**: strip **all** whitespace (so space-grouped thousands like `1 234,56` parse — matching the legacy `euro.cpp` behaviour) and a single leading `+`/`-`; treat `,` as the decimal point; accept 0–2 decimal places; **on more than 2 decimals, round half away from zero** (decide once, here — not truncate); empty/blank → `0`; non-numeric → throw a typed parse error. (Note: only a *leading* sign is accepted; the legacy app also accepted a *trailing* sign — that is intentionally dropped and left to import normalisation if ever needed.)
- **Rounding (preserved from `qRound64`):** half away from zero. VAT helpers derive from one rule: `vero = round(brutto·pct/(100+pct))`, `brutto = round((100+pct)·netto/100)`, gross-correction `netto = round(brutto·10000/(10000+pct100))`.

### 5.2 `accounts` — the `TiliLuonne` lattice, and how singletons are resolved

The account type system is a bitmask lattice (`db/tilityyppimodel.h:23-66`). There are **two distinct operations the rewrite must keep separate** — the original misdescription here was the single biggest review finding:

1. **`onko(luonne, mask)` — subset test** `(luonne & mask) === mask`, used for *categorisation / report placement*. Because the bits nest, `VASTAAVAA` implies `TASE` etc. Real bit layout (transcribe exactly; do **not** use the wrong `TASE=1<<0` from an earlier draft — bit 0 is `OTSIKKO`):

```ts
export const Luonne = {
  OTSIKKO: 1<<0, TASE: 1<<1, TULOS: 1<<2, VASTAAVAA: (1<<1)|(1<<3), VASTATTAVAA: ...,
  SAATAVA: ..., ALVSAATAVA: ..., VELKATILI: ..., SIIRTOVELKA: ...,
  /* full registry A/APM/APT/AS/AO/AJ/AL/ALM/AV/ARK/ARP · B/BE/T/BS/BSP/BO/BJ/BL/BLM/BV/BY ·
     C/CL/CZ/CLZ · D/DP/DZ/DH/DPZ/DVE · headers H1..Hn; `uniikki` marks singleton system accounts */
} as const;
export const onko = (luonne: number, mask: number) => (luonne & mask) === mask;
```

2. **Resolving a *singleton system account* by type** — `TiliModel::tiliTyypilla(luonne)` uses **EXACT mask equality** (`tili.tyyppi().luonne() === mask`), **not** `onko`/subset (`db/tilimodel.cpp:301-308`, `db/tili.cpp:124-127`). And **masks collide**: `VELKATILI` and `SIIRTOVELKA` share `0b0001011010010`, so exact-equality alone is ambiguous. The rewrite therefore resolves singletons via a **named setting first, exact-mask fallback**:

```ts
// EXACT equality, never subset. For colliding masks, prefer the account named in settings.
export function tiliTyypilla(chart: Tili[], mask: number, settings: Settings): Tili | undefined
```

`EDELLISTENTULOS`, `KAUDENTULOS`, `ALVVELKA`/`ALVSAATAVA`, `VEROVELKA`/`VEROSAATAVA`, `KOHDENTAMATONALV*`, `SIIRTOVELKA`/`SIIRTOSAATAVA` are resolved this way. Default-account **settings** that genuinely exist are `OletusMenotili` and `OletusMyyntitili` (`db/asetusmodel.h:105,107`) plus invoicing settings (`LaskuKorttitili` etc.); there is **no `AlvVelkatili` setting** — the VAT accounts are type-resolved.

- **First-digit class** (`sqlite/routes/tilikaudetroute.cpp:55-74`): account number first char `<'2'` assets, `<'3'` balance-sheet, `>='3'` P&L. Finnish numbering: 1=assets, 2=equity/liabilities, 3=income, 4–8=expenses, 9=appropriations/tax.
- **Three seed charts as data:** `charts/{yritys,yhdistys,asoy}/` each with `tilit.json`, `asetukset.json`, `raportit.json`, `tilinpaatos.txt`, `muunto.txt` (old→new number migration).

### 5.3 `vouchers` — Tosite / Vienti / Rivi

A **Tosite** (voucher) is the atomic accounting record (`model/tosite.cpp`). Wire shape preserved: `{pvm,tyyppi,tila,tunniste,sarja,otsikko,kumppani,viite,laskupvm,erapvm,viennit:[],rivit:[],lasku:{},liitteet,loki}`.

```ts
export interface Tosite {
  pvm: IsoDate; tyyppi: TositeTyyppi; tila: TositeTila;   // tila = numeric state, NOT a total order
  tunniste: number; sarja: string;                         // tunniste=0 until finalized
  otsikko?: string; kumppani?: number; viite?: string; erapvm?: IsoDate;
  viennit: TositeVienti[]; rivit?: TositeRivi[]; liitteet?: Liite[];
}
export interface TositeVienti {            // model/tositevienti.h
  tili: string; debet: Cents; kredit: Cents;   // mutually exclusive (one is 0)
  pvm: IsoDate; alvKoodi: AlvKoodi; alvProsentti: number;
  kohdennus?: number; era?: EraRef; selite?: string; tyyppi: VientiTyyppi;
}
```

- **Voucher types (`TositeTyyppi`)**, exact codes (`db/tositetyyppimodel.h:23-49`): `MUU=0, TUONTI=90, MENO=100, SAAPUNUTVERKKOLASKU=110, KULULASKU=120, TULO=200, MYYNTILASKU=210, HYVITYSLASKU=214, MAKSUMUISTUTUS=216, SIIRTO=300, TILIOTE=400, PALKKA=500, MUISTIO=700, LIITETIETO=800, JARJESTELMATOSITE=1000, TILINAVAUS=9010, YKSITYISTILIEN_PAATTAMINEN=9040, ALVLASKELMA=9100, YHTEENVETOILMOITUS=9110, POISTOLASKELMA=9910, JAKSOTUS=9920, TULOVERO=9930`. `kumppani` is retained only for types **100–299** (`model/tosite.cpp:629-632`).
- **Entry types (`VientiTyyppi`)** (`model/tositevienti.h:56-72`): `KIRJAUS=1, VASTAKIRJAUS=2, ALVKIRJAUS=3, MAAHANTUONTIVASTAKIRJAUS=31, VAHENNYSKELVOTON=32, OSTO=100, MYYNTI=200, SUORITUS=300, SIIRTO=400, BRUTTOOIKAISU=91091, POISTO=99100, JAKSOTUS_TP=99210, JAKSOTUS_TA=99220`.
- **State machine (`TositeTila`)** — reproduce the **full enum verbatim**; it is **not a total order** (send states 101/102 are declared adjacent to 100, and `VALMISLASKU=80` is a finalized-invoice state below 100) (`model/tosite.h:79-95`):
  `POISTETTU=0, MALLIPOHJA=5, HYLATTY=10, SAAPUNUT=20, TARKASTETTU=30, HYVAKSYTTY=40, LUONNOS=50, VALMISLASKU=80, KIRJANPIDOSSA=100, LAHETETAAN=101, LAHETYSVIRHE=102, LAHETETTYLASKU=110, TOIMITETTULASKU=113, AVATTULASKU=114, MUISTUTETTU=120`.
  The load-bearing predicate is **`tila >= 100` ("in the books") → triggers numbering and lock checks** (§5.6).
- **`TositeRivi`** invoice-row math (`model/tositerivi.cpp:113-168`): gross from net via `alvProsentti` unless `alvkoodi ≥ KAYTETYT` (margin/special schemes carry no added VAT); percentage/euro discounts; UN/ECE unit code default `C62`; negative computed unit price flips sign of quantity. Feeds `Euro.mulRate`.

### 5.4 The validation engine — one pure function, three severities

`tarkasta` is a single pure function returning structured violations. It mirrors the **bitmask flag-set built in `tarkasta()` (`model/tosite.cpp:~448-515`)**; the *interactive* checks come from the QMessageBox confirm/abort guards in `tallenna()` (`model/tosite.cpp:398-420`). Those two were merged in the original draft — they are different mechanisms, hence **three** severities:

```ts
export type Severity = 'block' | 'warn' | 'confirm';
export function tarkasta(t: Tosite, ctx: ValidationContext): Violation[];
// ctx = { kausiAlkaa, kausiLoppuu, tilitPaatetty, onkoAlvIlmoitettu(pvm),
//         onkoAlvVelvollinen(pvm), chart }
// Violation = { code, severity }
```

**Finalize rule (preserved from `kirjaus/kirjauswg.cpp:523`):** a voucher may move to `tila≥100` iff **no violation other than `EITASMAAPVM` is present** — i.e. `EITASMAAPVM` is the only `warn`; everything else is `block` or a resolved `confirm`. The resource layer surfaces `confirm` violations to the UI, which must obtain user confirmation before finalizing (these are not silently downgradable).

Encoded verbatim:
- **`EITASMAA` (block):** overall `Σdebet === Σkredit` in cents. The exemption for `tyyppi===TILINAVAUS` lives **only in the save guard** (`model/tosite.cpp:424`); `tarkasta()` itself (503-504) sets the flag unconditionally when `debet≠kredit`. So the unified pure `tarkasta` **must special-case TILINAVAUS explicitly** to reproduce save-time behaviour. (`model/tositeviennit.cpp:824-834` is the pure balance check.)
- **`EITASMAAPVM` (warn):** debits and credits must also net to zero **per posting date** within the voucher (`model/tosite.cpp:476-515`).
- **`EIAVOINTAKUTTA` (block):** `pvm` ∈ `[kausiAlkaa, kausiLoppuu]` (`tosite.cpp:467-469,492-494`).
- **`PVMLUKITTU` (block):** `pvm ≤ tilitPaatetty` rejected (`tosite.cpp:470-471,495-496`).
- **`PVMALV`:** detection — an entry with nonzero `alvKoodi` whose VAT period is already reported (`onkoAlvIlmoitettu(pvm)`); **the flag is suppressed at detection when the voucher is an `ALVLASKELMA`** (`tosite.cpp:482-488`). At finalize, the block is additionally overridden by the `OhitaAlvLukko` setting or when already in the books.
- **Era→account restriction (`confirm`):** an `era` may only sit on accounts with tase-erittely enabled or `KOHDENTAMATONALV*`; the customer/apartment-era → `MYYNTISAATAVA` rule is **partly deferred** (those eras arrive with invoicing, Tier‑2). (`tosite.cpp:405-420`)
- **VAT-exempt guard (`confirm`):** `!onkoAlvVelvollinen(pvm)` but an entry carries a VAT code/percentage (`tosite.cpp:398-403`).

**Tier‑0 self-containment:** VAT is Tier‑1, so in Tier‑0 the `ValidationContext` predicates degrade safely — `onkoAlvIlmoitettu(pvm)` always returns `false` and `onkoAlvVelvollinen(pvm)` is a static settings flag. Real period-reporting data is wired in at Tier‑1; Tier‑0 builds and is correct without the VAT engine.

**`kohdennus` in Tier‑0:** entries carry a raw `kohdennus` id, stored and round-tripped, but Tier‑0 ships **no kohdennus lookup/validation model** and the seed charts need no kohdennukset. The `/kohdennukset` resource and referential validation arrive in a later tier.

### 5.5 `fiscalyear` + computed result-to-equity

`Tilikausi` (`db/tilikausi.cpp`) carries `alkaa`/`paattyy`. The **PMA size class** is computed by `pienuus()` from **this period's** stored tase/liikevaihto/henkilöstö (`tilikausi.cpp:107-133`): *micro* if **at most one** of {tase > 350 k€, liikevaihto > 700 k€, staff > 10} is exceeded; *small* if at most one of {6 M€, 12 M€, 50}; otherwise *large*. (The cross-period "larger of this and previous *size class*" rule is in `tilinpaatoseditori/tpaloitus.cpp:172-174`, compares classes not figures, and belongs to **Tier‑3** statutory output along with the rest of size-class consumption — there is no current/previous logic in `pienuus()` itself.)

**Result-to-equity is computed on read, never posted** (`sqlite/routes/saldotroute.cpp:90-108`): `KAUDENTULOS` = Σ class≥3 entries within the period; `EDELLISTENTULOS` = own posted balance + Σ class≥3 entries before period start. This is the entire opening-balance carry-forward mechanism — implemented in the `/saldot` resource handler.

### 5.6 Numbering & locking (resource-layer, legal properties)

- **Sequential, gapless numbering per `(fiscal-year, series)`** (`sqlite/routes/tositeroute.cpp:126-149,221-234`): at finalize (`tila → ≥100`), `tunniste = MAX(tunniste)+1` over finalized vouchers in the same fiscal year and `sarja`. **A null/empty series forms its own bucket (`sarja IS NULL`)**, distinct from any named series. Drafts (`tila<100`) carry `tunniste=0`. Re-dating across a year boundary or changing series clears `tunniste` for renumber. Numbering restarts each fiscal year. Series selection (`db/tositetyyppimodel.cpp:99-113`): single running series, per-type (`TOSITELAJIT`), or cash series `K`; system vouchers (type ≥1000) use `*`/`JT`. Numbering is a **legal property of the stored record**, assigned inside the `saveTosite` transaction (§5.8), and **preserved across push/pull** (§4).
- **Period lock = single date setting `TilitPaatetty`** (`db/kirjanpito.h:113`): any voucher/line with `pvm ≤ TilitPaatetty` rejected. Opening a book sets it to `start−1`. Reported VAT periods independently block ALV-bearing edits (`PVMALV`, §5.4).

### 5.7 `balances` + `report-dsl`

- **`/saldot`** returns point-in-time / period-bounded balances (flags `pvm`, `alkupvm`, `alkusaldot` strict-`<`, `tase`, `tuloslaskelma`, `tili`, `kohdennus`), injecting the two computed equity rows (§5.5). **The rewrite computes saldot in integer cents throughout — deliberately fixing the legacy path, which round-trips through `double` (`/100.0`, `qRound64(toDouble()*100)`, `saldotroute.cpp:84-110`).** This is a correctness improvement, not a behaviour to preserve (see §9 on how golden tests handle it).
- **Report-row DSL** (`raportti/laatijat/laatijantasetulos.cpp`, data-driven `raportit.json`). Two separate things, kept distinct (the original draft conflated them):
  - **Characters inside the `L` range formula** (`laatijantasetulos.cpp:243-249`): `h`/`H` = this row is a **header**; `S` or `H` present = render the row **even when empty/zero** (`naytaTyhjarivi`); `==` = **do not** accumulate into the running subtotal; `=` = **emit** a running subtotal; `*` = per-account detail; `+`/`-` = tulot/menot-only. The formula body is account ranges `'a..b'`, comma-separated lists.
  - **Sibling JSON keys** on the row object: `"S"` = indent level (int, `:223`); `"V"` = number of blank lines (int, `:228`); `"M"` = a **format string** whose value is tested, e.g. `contains("bold")` (`:226,232`).
  - **Account matching is `QString` lexicographic prefix** — `tili.left(n) >= start` (`saldotroute.cpp:71,77,90`), **never numeric `parseInt`**. This is length-sensitive (`'1' < '10' < '100' < '2'`). The TS port uses JS string comparison; §9 mandates a golden test with mixed-length numbers to lock the ordering.
  - Bundled layouts: tulos/{yleinen,pienbrutto,mikrobrutto}, tase/{yleinen,PMA} (fi/sv/en).

### 5.8 Integrity (cross-cutting, enforced in the resource layer)

The legal guarantee is **immutability of the *record*, realised through the append-only log — not row-level immutability of the child tables.** Precisely (from `sqlite/routes/tositeroute.cpp`):

- **The `Tositeloki` audit log is the source of truth for immutability:** every create/update/delete writes an entry `{tosite, tila, aika, userid, full JSON snapshot}`. The full prior state is always recoverable from the log.
- **Voucher header delete is soft** (`UPDATE … tila=0`, never a physical row delete; `tositeroute.cpp:175`).
- **Child rows are *replaced* on update:** `saveTosite` physically `DELETE`s then re-inserts the voucher's `Vienti`/`Rivi`/`Merkkaus` rows (`tositeroute.cpp:385,402,421`). This is fine *because* the log holds the snapshot — but it means the snapshot/hashing design (§4, §11.9) must derive immutability from the log, not from assuming child rows never change.
- **`saveTosite` is one transaction:** (1) compute `tunniste` if finalizing, (2) write the `Tositeloki` snapshot, (3) upsert header / soft-delete on delete, (4) replace child rows. Atomic, in both adapters.
- **Write-guard:** rejects any voucher/line with `pvm ≤ TilitPaatetty`, centrally — the UI cannot bypass it.

### 5.9 The Storage port

```ts
export interface Storage {
  getTosite(id: number): Promise<Tosite | null>;
  listTositteet(filter: TositeFilter): Promise<Tosite[]>;
  saveTosite(t: Tosite, audit: AuditCtx): Promise<{ id: number; tunniste: number }>; // §5.8 transaction
  nextTunniste(kausi: Tilikausi, sarja: string | null): Promise<number>;              // null = own bucket
  querySaldot(q: SaldoQuery): Promise<SaldoRow[]>;   // integer-cents result (§5.7)
  getChart(): Promise<Tili[]>;
  getAsetukset(): Promise<Settings>;
  getTilikaudet(): Promise<Tilikausi[]>;
}
```

## 6. The contract layer (`@penni/contract`)

`ts-rest` + `zod` define each resource once → typed client + server router + runtime validation, in a shared package so frontend and engine cannot drift. The engine speaks rich internal types (`Cents` as number, real dates); the contract layer serializes to the **legacy wire shape at the boundary** so existing `.kitsas` data imports ~1:1 and the shapes stay close to Kitsas' hosted-service REST API:

- `*snt` cents → `"N.NN"` Euro strings · `alvprosentti` → 2 decimals · `X_Y` columns → nested `{X:{Y}}` · zero/empty scalars omitted.
- **Routing:** endpoints are declared as **ts-rest path patterns** matched by exact path + params. The legacy "first `startsWith`-prefix wins" dispatch (`sqlite/sqlitemodel.cpp:65-86,374-384`) is a SQLite-dispatcher artifact and is **dropped** — it would be a footgun in a real router (e.g. `/tilit` vs `/tilikaudet`). If a compat shim ever needs it for raw `.kitsas` import, it is scoped to the import tool and matches longest-prefix-first.

**The 7 Tier‑0 endpoints** (the full contract is ~22 across all tiers):
- `/init` — GET/PATCH bootstrap bundle (asetukset+tilit+otsikot+tilikaudet+tositesarjat); PATCH merges chart/settings **skipping `muokattu` rows**.
- `/tositteet` — GET/POST/PUT/PATCH/DELETE. PATCH = state change → numbering; DELETE = soft. Filters: alkupvm/loppupvm/pvm/kumppani/tyyppi/viite/luonnos/poistetut (default `tila≥100`).
- `/viennit` — GET.
- `/saldot` — GET.
- `/tilikaudet` — GET/PUT/DELETE + numerointi.
- `/tilit` — PUT/DELETE.
- `/asetukset` — GET/PATCH.

The `kp()` singleton's role becomes a small **DI service** owning loaded models and exposing date-aware predicates: `paivamaara`, `onkoAlvVelvollinen(date)`, `onkoMaksuperusteinenAlv(date)`, `tilitpaatetty()`, voucher-id formatting.

### Penni-laajennukset (ei Kitsas-vastinetta)

These endpoints have no counterpart in the Kitsas REST surface — they are **Penni-only
extensions** to the ~22-endpoint contract. That is a statement about the contract's scope,
not about test coverage: this repo's two conformance suites (`runResourceConformance`,
storage-adapter parity across SQLite/Postgres/memory; `runClientConformance`, transport
parity between the in-process and HTTP clients) measure internal consistency, not fidelity
against Kitsas, so neither excludes an endpoint for being a Penni extension. `/tulot` and
`/menot` are covered by `runClientConformance`; they add no storage-port method, so there is
nothing for `runResourceConformance` to cover.

| Endpoint | Purpose |
|---|---|
| `GET /tulot` | All income, selected by account luonne (`Luonne.TULO`) — invoices and direct income in one list, with the open receivable per row. |
| `GET /menot` | The same for expense (`Luonne.MENO`). |

Rationale: Kitsas lists sales invoices only, so income booked straight to the bank is
invisible in navigation.

## 7. Storage & persistence

Both adapters implement the `Storage` port and share a schema *shape* lifted from today's `sqlite/luo.sql` — the proven **"JSON blob + indexed scalar-column overlay"** pattern:

- `tosite`(id, **json blob**, scalar columns pvm/tyyppi/tila/tunniste/sarja/kumppani/viite). **Indexes in the legacy schema cover only `pvm`, `tyyppi`, `tila`** (`sqlite/luo.sql:107-109`); the rewrite **adds** indexes on `tunniste`, `sarja`, `kumppani`, `viite` as a deliberate improvement for the new filter set (called out so it isn't mistaken for legacy behaviour).
- `vienti`(denormalized: tili, debet, kredit, pvm, alvkoodi, kohdennus, era — indexed for saldo sums) · `tili` · `tilikausi` · `asetus` · `loki` (append-only audit).

`saldot` = indexed `SUM(debet − kredit)` over `vienti`, **in integer cents** (§5.7) — Postgres in SQL, SQLite-WASM the same. Numbering + audit-log writes + child-row replacement occur in one `saveTosite` transaction (§5.8). Each adapter has an ordered migration runner. Because the schema mirrors the legacy one, `.kitsas` import is a near-direct table copy.

## 8. Frontend (`apps/web`)

One React app for both modes. A `KpClient` interface has two implementations the app picks at runtime: `InProcessClient` (engine module directly → local-first/offline) and `HttpClient` (ts-rest client → cloud). The SQLite-WASM adapter behind `InProcessClient` is lazy-loaded (§3.3). Everything above the client is identical. Data layer: TanStack Query over the typed client; TanStack Router; TanStack Table for ledgers.

**Tier‑0 screens:** new-book wizard (pick seed chart) · dashboard · **keyboard-first voucher entry** · voucher/ledger browser · chart of accounts · reports (tuloslaskelma + tase) · fiscal-year/settings.

**Design direction:** approachable by default for a small-business owner, with a power-user keyboard layer underneath; progressive disclosure (hide VAT/allocation complexity until needed); calm neutral palette; data-dense but uncluttered; instant and offline. (Detailed visual design → §13.)

## 9. Testing strategy — *proving the logic survived*

- **Port existing QtTest fixtures as golden tests:** `AlvLaskelmaTesti`, `eurotest`, `tositerivitesti`, `viitetesti`, `ValidatorTest` (`unittest/`). Where the legacy output is *correct*, reproduce it exactly. **Exception — saldot:** the legacy float path (§5.7) is the thing we are fixing, so saldot golden tests assert **recomputed known-good integer expectations**, not a byte-diff against legacy float output. Audit every `/100.0` / `toDouble()` site before trusting it as an oracle.
- **Property tests** for `Euro` rounding boundaries (incl. the >2-decimal rounding decision, §5.1) and viite/RF/IBAN/Y-tunnus check digits.
- **Lexicographic-ordering test** for the report DSL: a chart mixing `'1','10','100','2'` to lock string-prefix matching (§5.7).
- **One contract test suite run against BOTH storage adapters** (SQLite-WASM + Postgres) — parity by construction; kills the dual-backend bit-rot.
- **Real-book regression:** load the existing `unittest/data/oy.kitsas`, compute saldot + reports, diff against known-good (integer) output.

## 10. Migration from existing `.kitsas`

`.kitsas` files are SQLite with essentially the target schema. A `kitsas-import` reads the legacy tables and maps to the new ones (mostly 1:1 because we keep the wire key names and blob+overlay shape). The `muunto.txt` old→new account-number migration already ships in each seed chart.

## 11. Legal & structural constraints (design in from day one)

1. **Immutability of the record after close** (KPL 2:7): one `TilitPaatetty` date locks all vouchers `pvm ≤` it; a confirmed (`vahvistettu`) fiscal year is final; reported VAT periods independently block ALV edits. Enforced centrally in the data layer, not the UI. Immutability is realised via the append-only log (§5.8), not row-level child immutability.
2. **Sequential, gapless numbering per `(fiscal-year, series)`** (null series = its own bucket), assigned only at `tila≥100`; drafts `tunniste=0`; re-date/series-change forces renumber; **preserved, never renumbered, across push/pull** (§4). A legal property of the record.
3. **Soft-delete of the voucher** (`tila=0`) plus a `Tositeloki` entry; child rows are replaced on update but always recoverable from the log snapshot.
4. **Append-only audit trail** (timestamp/state/user/full payload) on *every* mutation.
5. **Retention windows:** financial statements 10 years from period end; vouchers 6 years from the end of the period-end *year* (31.12 of year+6) (`tilinpaatoseditori/tilinpaatostulostaja.cpp:~208-213`).
6. **Money is integer cents** in storage, transport, *and computation* — structural, not formatting; the rewrite eliminates the legacy float saldot path (§5.7). No float ever touches a monetary value.
7. **Result-to-equity computed on read**, never posted; the model must support point-in-time and period-bounded saldo queries natively.
8. **User-modified rows win** over template re-application (`muokattu` flag on Asetus/Tili/Otsikko) — template updates merge, never clobber.
9. **Snapshot-ready schema:** the data model must permit a later deterministic, hashable snapshot of a closed year (the Tier‑3 SHA‑256-sealed electronic archive: self-contained static HTML, per-voucher HTML+JSON, attachments named `pitkakausitunnus-sarja-tunniste_nn.ext`, statutory reports, tilinpäätös PDF, tase-erittely, hashed into `arkisto.sha256` + `arkistovarmenne.pdf`). Tier‑0 builds no snapshot, only the properties it needs: stable ordering, log-derived state, no derived-only truth.

**Dropped across the board:** Qt mechanics — QObject signals/slots, `QVariantMap` stringly-typed bags, `QAbstract*Model` item-model plumbing, `QValidator`/`.ui`/`QMessageBox`, `QPainter`/`QPdfWriter` rendering, hand-built SQL + PRAGMA/migration ladders, the `kp()` singleton wiring, **and the legacy float saldot arithmetic**. Kept: the **JSON key names** (wire contract), the **algorithms/formulas** (where correct), the **enums/codes**, and the **endpoint model**.

## 12. Roadmap (tiers)

- **Tier 0 — irreducible core (this spec):** Euro; chart + lattice + seed charts; Tosite/Vienti + validation; fiscal year + computed equity + lock; numbering + soft-delete + audit; saldot + tuloslaskelma/tase via report DSL; the 7 Tier‑0 endpoints.
- **Tier 1 — VAT:** AlvKoodi taxonomy + rate-by-date (24→25.5% @2024-09-01, 14→13.5% @2026-01-01); automatic net+tax entry generation (reverse charge, import, margin scheme, cash-basis); VAT return codes 301–337; settlement voucher; period/due-date; lower-limit relief (incl. 2025 abolition); wires the real `onkoAlvIlmoitettu`/`onkoAlvVelvollinen` period data (§5.4).
- **Tier 2 — Invoicing & payment:** viite/RF/IBAN/Y-tunnus algorithms; sales-invoice → voucher; numbering; era open-item tracking + payment matching (incl. the customer/apartment-era → MYYNTISAATAVA guard, §5.4); `/kohdennukset`; due-date adjustment, reminders, credit notes, recurring/advance; virtual barcode + SEPA QR.
- **Tier 3 — Year-end & statutory output:** depreciation, accruals, income-tax provision, private-account closing; financial-statement notes engine + tilinpäätös PDF + size classification (incl. the cross-period rule, §5.5); tase-erittely; electronic archive + SHA‑256 seal.
- **Tier 4 — Authority & external:** OmaVero/Ilmoitin VAT submission; EU sales summary; e-invoice (Finvoice/Maventa) delivery; bank-statement (tiliote, ISO 20022 CAMT.053) import + reference matching.
- **Tier 5 — Product/SaaS:** multi-book office view, per-book permission bitmask, approval workflow (kierto), subscription plans, and **book-level sync** (§4).

## 13. Out of scope / next steps

1. **Visual & UX design** — a dedicated brainstorm with mockups (visual companion) once this spec is locked: dashboard, voucher-entry keyboard flow, ledger, reports, new-book wizard, design system on top of shadcn.
2. **Implementation plan** — the immediate next step: turn Tier‑0 into a sequenced, testable build plan (writing-plans skill), starting with `@penni/euro` (everything depends on it) and the golden-test ports.
3. **Tier 1+ specs** — each tier gets its own spec → plan → implementation cycle.

## Appendix A — source-of-truth files (paths relative to `kitsas-source/kitsas/`)

`model/euro.{h,cpp}` · `model/tosite.{h,cpp}` · `model/tositevienti.h` · `model/tositeviennit.cpp` · `model/tositerivi.cpp` · `db/tilityyppimodel.h` · `db/tilimodel.cpp` · `db/tili.cpp` · `db/tilikausi.{h,cpp}` · `db/tositetyyppimodel.{h,cpp}` · `db/kirjanpito.{h,cpp}` · `db/asetusmodel.h` · `db/kpkysely.h` · `sqlite/sqlitemodel.cpp` · `sqlite/routes/tositeroute.cpp` · `sqlite/routes/saldotroute.cpp` · `sqlite/routes/tilikaudetroute.cpp` · `sqlite/luo.sql` · `alv/alvlaskelma.cpp` · `raportti/laatijat/laatijantasetulos.cpp` · `tilinpaatoseditori/tilinpaatostulostaja.cpp` · `tilinpaatoseditori/tpaloitus.cpp` · `validator/*` · `laskutus/viitenumero.cpp` · `laskutus/iban.cpp` · `kirjaus/kirjauswg.cpp` · fixtures: `unittest/` + `unittest/data/oy.kitsas`.
