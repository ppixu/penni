# Notice

**Penni** is copyright (c) 2026 Olli Pikkarainen. Penni's own code is licensed under the
**GNU Affero General Public License, version 3 or (at your option) any later version**
(`AGPL-3.0-or-later`). The full licence text is in [`LICENSE`](LICENSE).

Parts of Penni are derived from Kitsas and remain under Kitsas' licence; see below.

## Derived from Kitsas

Penni is a **modified, derivative work** based in part on
**Kitsas** (formerly Kitupiikki), Finnish open-source bookkeeping software:

- Source: <https://github.com/artoh/kitupiikki>
- Copyright (c) Arto Hyvättinen and Kitsas Oy
- Licence: GNU General Public License, version 3 or later (`GPL-3.0-or-later`),
  with the additional terms stated in Kitsas' `LICENSE`

What was taken from Kitsas:

- The chart of accounts data in [`charts/yritys/`](charts/yritys/) is copied from Kitsas
  (`kitsas/tilikartat/yritys/`).
- Parts of the engine and its tests are translated from the Kitsas C++ sources. The source files
  concerned are cited in comments in the form `file.cpp:line` (relative to `kitsas/` in the
  Kitsas repository).
- The upstream Kitsas repository is included unmodified as the git submodule
  [`kitsas-source/`](kitsas-source/), used only as a reference for the Finnish bookkeeping rules.
  It is not built or distributed as part of Penni and keeps its own licence
  (`kitsas-source/LICENSE`).

### Licensing of the Kitsas-derived parts

The parts taken from Kitsas are **not** relicensed. They remain under the
**GNU General Public License, version 3 or later** (`GPL-3.0-or-later`) together with the
additional terms of Kitsas' `LICENSE`:

- the chart-of-accounts data in [`charts/yritys/`](charts/yritys/) (package `@penni/charts`,
  which is therefore declared `GPL-3.0-or-later`), and
- code and tests translated from the Kitsas C++ sources (cited in comments as `file.cpp:line`).

Penni's own code is `AGPL-3.0-or-later`. Section 13 of GPLv3 and section 13 of AGPLv3 allow
GPL-licensed and AGPL-licensed works to be combined into one work. The combined work, Penni as a
whole, is distributed under `AGPL-3.0-or-later`; the GPL-3.0-or-later terms continue to apply to
the Kitsas-derived parts, and the AGPL's network-use requirement (offering the source to users who
interact with Penni over a network) applies to the combined work. This is not legal advice.

The Kitsas licence asks that modified versions are clearly marked as such, that Kitsas Oy does not
support modified versions, and that the name of Kitsas Oy is not used in modified versions. In line
with these terms:

- Penni is an **independent, modified work**. It has been changed substantially from Kitsas,
  including a rewrite in TypeScript.
- Penni is **not affiliated with, endorsed by or supported by Kitsas Oy**. Do not ask Kitsas Oy for
  support for Penni.
- The name of Kitsas Oy is not used for the branding or marketing of Penni. It appears only to
  credit the origin of the code and data.

## Third-party components

- **Inter** typeface, copyright (c) The Inter Project Authors, licensed under the SIL Open Font
  License 1.1. Licence texts: [`packages/lasku-pdf/fonts/OFL.txt`](packages/lasku-pdf/fonts/OFL.txt)
  and [`docs/mockups/landing-assets/Inter-LICENSE.txt`](docs/mockups/landing-assets/Inter-LICENSE.txt).
- **npm dependencies** are installed from the npm registry and remain under their own licences.
  See each package's `package.json` and the `node_modules` tree after `pnpm install`.
