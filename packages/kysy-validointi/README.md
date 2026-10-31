# @penni/kysy-validointi

Read-only eval harness: runs a golden set of Finnish bookkeeping questions through
`@penni/kysy`'s `kysy()` loop against a real book, and scores each answer against a value
computed live from the engine (never hand-typed, so the set can't rot). Expected
values come from the engine itself, so a golden question can never go stale.

## Prerequisites

- Node ≥ 22, pnpm.
- [Ollama](https://ollama.com) running locally with the target model pulled
  (`ollama pull qwen3.5:2b`). The runner checks this up front and refuses to start otherwise.

## Run

```bash
# operate on a COPY of the real book (harness is read-only, but be safe)
cp ~/git/kitsas/<oma-kirja>.kitsas /tmp/validointi.kitsas
pnpm --filter @penni/kysy-validointi validoi --db /tmp/validointi.kitsas --out ./kysy-raportti
```

Flags: `--db <path>` (required, `.kitsas` or `.penni`), `--malli <nimi>` (default
`qwen3.5:2b`), `--limit N` (first N questions), `--out <dir>` (default `./kysy-raportti`),
`--url <ollama-url>`, `--ajattelu` (enable the model's thinking mode), `--cache <dir>`
(default `<out>/cache` — repeat runs against the same book/model/questions are served from
disk instead of re-paying for inference).

A `.kitsas` source is imported read-only into a fresh temp `.penni` file before the run; the
original file is never modified. A `.penni` path is used as-is.

Output: a console summary, `report.md` (per-question table + failure-mode counts), and
`report.json` (the same data, for tooling).
