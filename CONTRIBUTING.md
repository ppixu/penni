# Contributing to Penni

Thanks for your interest. Penni is in beta; issues and pull requests are welcome.

- **Language**: issues, pull requests and discussion can be in Finnish or English. Domain identifiers
  in code are Finnish (see the glossary in [`docs/kitsas-reference.md`](docs/kitsas-reference.md));
  comments follow the language of the file you are editing.
- **Before sending a PR**: run `pnpm lint && pnpm test` (after a `pnpm build` on a fresh checkout).
  Format with `pnpm format` (Biome).
- **Money is integer cents.** Use the `Euro` type from `@penni/euro`. Never use floats for money.
- **Adapter parity.** The SQLite (local) and Postgres (cloud) storage adapters must satisfy the same
  contract; parity is enforced by one shared test suite. If you touch stored data, run both.
- **Core invariants** (gapless numbering, soft delete with an audit log, period lock, immutability
  after close) are listed in [`CLAUDE.md`](CLAUDE.md) and `docs/design/architecture.md` section 11.
  Do not break them.
- **Kitsas reference.** `kitsas-source/` is a read-only git submodule of upstream Kitsas. Do not
  modify it; cite `file:line` from it in comments when you port a rule.
- **Licence.** Penni's own code is AGPL-3.0-or-later (Kitsas-derived parts keep their GPL terms; see
  [`NOTICE.md`](NOTICE.md)). By contributing you agree that your contribution is
  licensed under the same terms (inbound = outbound).
- **Security issues**: do not file them publicly; see [`SECURITY.md`](SECURITY.md).
