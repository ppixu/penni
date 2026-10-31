# Penni

*Kirjanpito omalla koneellasi.*

**Penni** is Finnish small-business double-entry bookkeeping (kirjanpito) for sole traders,
associations, housing companies and limited companies. It is **local-first**: the desktop app
and the browser app keep your books in a file on your own machine, with an optional cloud
backend for sync and backups. Domain logic follows Finnish bookkeeping and tax practice
(VAT, statutory reports, gapless voucher numbering, audit trail).

Site and browser demo: <https://penni.pro>

> **Beta.** Penni is under active development and has not been audited by an accountant.
> **Keep backups** of your book files, **verify the figures** before filing anything, and
> remember that the person keeping the books (the kirjanpitovelvollinen) is always responsible
> for their correctness. The software is provided without warranty (see [`LICENSE`](LICENSE)).

## Features at a glance

- Double-entry bookkeeping with a keyboard-first voucher grid editor
- Vouchers, sales invoices (PDF), accounts, fiscal years and a locked, immutable record after close
- VAT handling and statutory reports (income statement, balance sheet, ledgers)
- Receipt reading: transcribes a receipt and proposes a voucher; you review and approve
- Optional assistant ("Kysy") that looks things up and drafts vouchers; nothing is booked without
  your approval, and Penni works fully without it
- Import of existing Kitsas books
- Money is integer cents throughout; gapless numbering per fiscal year and series; soft delete with
  an append-only audit log
- Runs as an Electron desktop app (SQLite), in the browser (SQLite-WASM + OPFS), as a self-hosted
  Node server, or on Cloudflare (Durable Objects)

## Repository layout

| Path | Contents |
|------|----------|
| `apps/web` | React + Vite browser app |
| `apps/desktop` | Electron desktop app |
| `apps/server` | Self-hostable Node server (Fastify, SQLite) |
| `apps/pilvi` | Cloudflare Workers / Durable Objects backend |
| `packages/*` | Domain engine, contract, storage adapters, PDF, import, assistant tools (`@penni/*`) |
| `charts/` | Chart-of-accounts data (see [`NOTICE.md`](NOTICE.md)) |
| `docs/design/` | Architecture and UX design documents |
| `docs/mockups/` | Visual mockups and the landing page source |
| `docs/kitsas-reference.md` | Notes on the Kitsas codebase and the Finnish glossary |
| `kitsas-source/` | Upstream Kitsas as a read-only git submodule (rules reference only) |

Architecture: see [`docs/design/architecture.md`](docs/design/architecture.md) ("one engine, two
transports": the same pure domain engine runs in-process or behind a server). UX:
[`docs/design/ux-design.md`](docs/design/ux-design.md).

## Getting started

Requirements: Node 22 and pnpm 9 (`corepack enable` picks the right pnpm from `package.json`).

```bash
git clone --recurse-submodules https://github.com/ppixu/penni.git
cd penni
pnpm install
pnpm build
pnpm test
pnpm lint
```

`pnpm test` builds the packages it depends on automatically (see `turbo.json`), so running
`pnpm build` first is optional.

If you cloned without `--recurse-submodules`, run `git submodule update --init`. The
`kitsas-source/` submodule is only needed by the tests that import upstream Kitsas' sample book
(`kitsas-source/unittest/data/oy.kitsas`); those tests are skipped when it is not checked out.

Run the apps:

```bash
pnpm --filter @penni/web dev          # browser app at http://localhost:5173
PORT=3000 PENNI_DB=./kirjanpito.db \
  pnpm --filter @penni/server start   # self-hosted server (after pnpm build)
pnpm --filter @penni/pilvi dev        # Cloudflare backend, local workerd
```

The Electron desktop app is more involved. It loads the built browser app from `apps/web/dist`,
and its main process uses `better-sqlite3`, which must be compiled for Electron's Node ABI:

```bash
pnpm build                                  # builds apps/web/dist and the packages
pnpm --filter @penni/desktop run rebuild    # recompile better-sqlite3 for Electron
pnpm --filter @penni/desktop dev            # compile the main process and start Electron
```

Use `run rebuild`: a bare `pnpm rebuild` is pnpm's own command, not the package script. The
Electron build of `better-sqlite3` cannot be loaded from plain Node (the desktop and storage tests
then fail with a `NODE_MODULE_VERSION` error), so run `pnpm install --force` to restore the Node
build before going back to `pnpm test`.

## Language

The product UI is in Finnish. Domain identifiers in code stay Finnish (tosite = voucher,
vienti = ledger entry, tili = account, tilikausi = fiscal year, alv = VAT, ...) to match the
bookkeeping domain; comments follow the language of the file. A glossary is in
[`docs/kitsas-reference.md`](docs/kitsas-reference.md). Issues and discussion in Finnish or
English are both fine.

## Relationship to Kitsas

Penni is inspired by and partly derived from [Kitsas / Kitupiikki](https://github.com/artoh/kitupiikki)
(copyright Arto Hyvättinen and Kitsas Oy, GPL-3.0-or-later). The chart-of-accounts data is copied
from Kitsas, and parts of the engine and tests are translated from its C++ sources. Penni is an
**independent, modified work**; it is **not affiliated with, endorsed by or supported by Kitsas Oy**.
See [`NOTICE.md`](NOTICE.md) for details.

## License

Penni's own code is licensed under the **GNU Affero General Public License v3.0 or later**
(`AGPL-3.0-or-later`; see [`LICENSE`](LICENSE)). The parts derived from Kitsas (the chart-of-accounts
data and code translated from it) remain under `GPL-3.0-or-later` with Kitsas' additional terms and
are combined with the AGPL code as permitted by section 13 of both licences. See
[`NOTICE.md`](NOTICE.md).

The apps show the copyright, licence and no-warranty notice under **Asetukset → Tietoja**
(`/tietoja`). For AGPL section 13, both servers answer `GET /lahdekoodi` with a plain-text source
offer (no login required), and the login page links to the source. If you host a **modified**
version, point these at your own source: `PENNI_LAHDEKOODI_URL` for `apps/server`,
`LAHDEKOODI_URL` (a Worker variable) for `apps/pilvi`, and `VITE_LAHDEKOODI_URL` at build time for
`apps/web`. The default is <https://github.com/ppixu/penni>.

## Links

- Site: <https://penni.pro>, contact: <hei@penni.pro>
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Security reports: [`SECURITY.md`](SECURITY.md)
