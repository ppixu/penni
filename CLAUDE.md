# CLAUDE.md — Penni

**Penni** is a modern TypeScript/web implementation of Finnish small-business bookkeeping, inspired by and partly derived from **Kitsas / Kitupiikki** (see `NOTICE.md`). It is in **beta**: a pnpm/Turborepo monorepo with apps in `apps/` (web, desktop, server, pilvi) and packages in `packages/` (engine, storage adapters, contract, …). Licensed AGPL-3.0-or-later.

## Where things are

- **`docs/design/architecture.md`** — architecture + Tier‑0 core spec. **Read this first** for any engine/data work.
- **`docs/design/ux-design.md`** — UX & visual design (style "A"; design tokens; the grid voucher editor).
- **`docs/mockups/`** — visual mockups (HTML).
- **`kitsas-source/`** — the original Kitsas Qt/C++ code, the **reference** for the Finnish business logic. Read it to confirm rules (cite `file:line`); it is reference-only — do not modify it as part of Penni work. It is a git submodule (upstream `artoh/kitupiikki`, pinned); run `git submodule update --init` to fetch it. `docs/kitsas-reference.md` documents that codebase and holds the Finnish glossary.

## Locked decisions (see `docs/design/architecture.md` §2)

Hybrid local-first + cloud · TypeScript monorepo (pnpm + Turborepo) · a **pure domain engine** implementing the proven ~22-endpoint REST contract · React + Vite + shadcn/Tailwind · ts-rest + zod · Node 22 + PostgreSQL (cloud) / SQLite‑WASM + OPFS (local) · book-level push/pull sync (no CRDT) · **"one engine, two transports"**. UX: style A (calm/minimal, indigo accent ~`#4f46e5`), **keyboard-first double-entry grid as the default voucher editor**, "fast & simple".

## Core invariants — never violate (see `docs/design/architecture.md` §11)

Integer cents only (no floats touch money) · gapless numbering per `(tilikausi, sarja)` assigned at finalize (`tila≥100`) · soft-delete + append-only audit log (`Tositeloki`) · `TilitPaatetty` period lock · result-to-equity computed on read (never posted) · immutability of the record after close.

## Conventions

- Money is the `Euro` integer-cents type — never floats, anywhere.
- Domain identifiers may stay Finnish (matching the bookkeeping domain and `kitsas-source`); package scope is `@penni/*`.
- When touching stored data, the SQLite (local) and Postgres (cloud) adapters must satisfy the *same* contract — parity is enforced by one shared test suite.

## Glossary

Finnish bookkeeping terms (tili = account, tosite = voucher, vienti = ledger entry, alv = VAT, kirjanpito = bookkeeping, tilikausi = fiscal year, …) — see the glossary in `docs/kitsas-reference.md`.
