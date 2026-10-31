# @penni/cli

Agent interface to a local `.penni` bookkeeping database. Build, export, and draft vouchers
via JSON. Designed for LLM agents: structured I/O, no GUIs, read-only, plus new drafts and attachments.

## Install & run

```bash
# build the CLI
pnpm --filter @penni/cli build

# invoke directly (needs a book: --kirja or $PENNI_KIRJA, see below)
node packages/cli/dist/index.js --kirja kirja.penni perustiedot

# or put a `penni` binary on PATH: `pnpm --filter @penni/cli link` does NOT work (pnpm's
# `link` rejects --filter). Run link from the package directory instead:
cd packages/cli && pnpm link --global
penni --kirja kirja.penni perustiedot
```

## Global flags

- `--kirja <path>` — book path (SQLite `.penni` file). Required: supply via flag or `$PENNI_KIRJA` env var.
- `--json` — output as JSON (default: human text). Errors go to stderr as `{virhe, koodi}`;
  exit code is always 1 on error.
- `--agentti <nimi>` — attribute this CLI call to an agent in the audit log (e.g. `--agentti claude-code`).
  Default: `'cli'`. Visible in the `lahde` field of voucher records.

## Commands

### `perustiedot`

Book metadata: company name, Y-tunnus, legal form, VAT status, the current fiscal year, and
today's date. Call this first.

```bash
penni perustiedot --json
```

Output:
```json
{
  "nimi": "Testi Oy",
  "ytunnus": null,
  "muoto": null,
  "alvVelvollinen": true,
  "pvm": "2026-08-15",
  "tilikausi": { "alkaa": "2026-01-01", "loppuu": "2026-12-31" },
  "tilitPaatetty": null
}
```

### `tilikaudet`

List all fiscal years defined in the book.

```bash
penni tilikaudet
```

### `tilit --haku <merkkijono>`

Search the chart of accounts. `--haku` filters by account name or number (optional).

```bash
penni tilit --haku pankkitili
penni tilit --json
```

### `saldot --pvm <YYYY-MM-DD> [--alkupvm <YYYY-MM-DD>] [--tili <numero> ...]`

Account balances. `--pvm` defaults to today. Repeat `--tili` to filter.

```bash
penni saldot --pvm 2026-06-30 --tili 1910 --tili 3000
penni saldot --alkupvm 2026-01-01 --pvm 2026-06-30 --json
```

### `raportti <muoto> --pvm <YYYY-MM-DD> [--alkupvm <YYYY-MM-DD>]`

Render a report layout, e.g. `tulos/yleinen` (income statement) or `tase/yleinen` (balance
sheet) — the format id as stored in the book's report layouts (see `charts/yritys/raportit.json`
for the full list). Requires the format id as a positional arg and `--pvm` (period end date);
an unknown `muoto` fails with `koodi: EIRAPORTTIA`, a missing `--pvm` fails validation.

```bash
penni raportti tulos/yleinen --pvm 2026-06-30 --json
penni raportti tase/yleinen --pvm 2026-06-30
```

### `tositteet [--alkaen <YYYY-MM-DD>] [--loppuen <YYYY-MM-DD>] [--teksti <...>] [--sarja <...>] [--bucket kirjanpidossa|luonnos|saapuneet|malli|poistetut]`

Search vouchers. Filters are AND-combined; `--bucket` restricts by voucher state (default: `kirjanpidossa`, finalized and booked).

```bash
penni tositteet --alkaen 2026-02-01 --loppuen 2026-02-28 --json
penni tositteet --bucket luonnos
penni tositteet --teksti "konsultointi" --bucket kirjanpidossa
```

### `tosite <id>`

Fetch a single voucher by ID: header fields, the partner, every ledger entry with its VAT code
and rate, and the attachment list (metadata only — never the file data). Copy `alvKoodi` /
`alvProsentti` from an earlier similar voucher when drafting a new one.

```bash
penni tosite 1 --json
```

Output:
```json
{
  "id": 1,
  "pvm": "2026-02-01",
  "tyyppi": 100,
  "tila": 100,
  "sarja": "",
  "tunniste": 1,
  "otsikko": "Toimistotarvikkeet",
  "kumppani": { "id": 3, "nimi": "Testi Oy" },
  "viennit": [
    {
      "tili": 4000,
      "debet": { "sentit": 10000, "eur": "100,00 €" },
      "kredit": { "sentit": 0, "eur": "0,00 €" },
      "pvm": "2026-02-01",
      "alvKoodi": 26,
      "alvProsentti": 25.5,
      "selite": null
    }
  ],
  "liitteet": [
    {
      "id": 5,
      "nimi": "kuitti.pdf",
      "tyyppi": "application/pdf",
      "koko": 48213,
      "sha": "9f2c…",
      "luotu": "2026-02-01T10:00:00.000Z"
    }
  ]
}
```

`kumppani` is `null` when the voucher has no partner (`nimi` is `null` if the partner id no
longer resolves); `koko` is the file size in bytes. Text mode prints the header fields as
`avain: arvo` lines followed by a `viennit:` table and a `liitteet:` table.

### `viennit [--tili <numero>] [--alkaen <YYYY-MM-DD>] [--loppuen <YYYY-MM-DD>] [--alvprosentti <n>] [--raja <n>]`

List posted ledger entries (vouchers with `tila >= 100`), filtered by the entry's own date.
Each row links back to its voucher: `tosite` is the voucher id (pass it to `penni tosite`),
`tunniste` its number and `otsikko` its subject. `alvKoodi` + `alvProsentti` show how VAT was
booked. `--raja` defaults to 200 rows on the CLI; `lukumaara` always carries the full count.

```bash
penni viennit --tili 1910 --alkaen 2026-01-01 --loppuen 2026-06-30 --json
```

Output:
```json
{
  "lukumaara": 1,
  "viennit": [
    {
      "tosite": 1,
      "tunniste": 1,
      "pvm": "2026-02-01",
      "tili": 1910,
      "debet": { "sentit": 10000, "eur": "100,00 €" },
      "kredit": { "sentit": 0, "eur": "0,00 €" },
      "alvKoodi": 0,
      "alvProsentti": 0,
      "selite": null,
      "otsikko": "Konsultointi"
    }
  ],
  "rajattu": false
}
```

### `alv [--alkupvm <YYYY-MM-DD>] [--loppupvm <YYYY-MM-DD>]`

VAT report (sales, purchases, and net liability). `--loppupvm` defaults to today; `--alkupvm`
defaults to the start of the fiscal year that contains today (or the earliest fiscal year's
start if none does).

```bash
penni alv --alkupvm 2026-01-01 --loppupvm 2026-06-30 --json
```

### `luonnos`

Create a draft voucher. Reads a JSON object from stdin; does not consume a voucher number.

```bash
echo '{
  "pvm": "2026-06-01",
  "tyyppi": 101,
  "otsikko": "Puhelinlasku",
  "viennit": [
    {"tili": 4000, "debet": 2550, "kredit": 0},
    {"tili": 1910, "debet": 0, "kredit": 2550}
  ]
}' | penni luonnos --json
```

Draft schema:
- `pvm`: YYYY-MM-DD (required).
- `tyyppi`: int, voucher type (required; see `ohje`).
- `otsikko`: string, subject (optional).
- `sarja`: string, series (optional, defaults to empty).
- `viennit`: array of `{tili, debet, kredit, ...}` (required; see below).
- `tila`: omitted or exactly `50` (draft). **Any other value is refused** (`koodi: LUONNOSVAIN`) —
  not just ≥ 100; e.g. `0` or `99` are refused too. Drafts only, no exceptions.

Money in drafts is **integer cents**. No `sentit`/`eur` wrapper:
```json
{"tili": 1910, "debet": 10000, "kredit": 0}  // 100.00 €
```

**Drafts (tila 50) never consume a gapless voucher number.** When a human finalizes a draft (tila ≥ 100) in the app,
a sequential number is assigned at that moment; the CLI has no numbering authority.

Output (on success, exit 0):
```json
{
  "id": 3,
  "tila": 50,
  "tunniste": 0,
  "pvm": "2026-06-01",
  "varoitukset": []
}
```

**Validation.** Before saving, the draft is checked with the engine's `tarkasta` against the
same validation context the finalize path uses (chart, fiscal years, period lock, VAT
settings). Drafts may be incomplete, so most findings do **not** stop the save — they come
back in `varoitukset` so you can fix the draft right away instead of the human hitting
`EIVALMISTU` at finalize time:

```json
"varoitukset": [
  {
    "koodi": "EITASMAA",
    "viesti": "Debet 25,50 € ja kredit 25,00 € eivät täsmää (erotus 0,50 €).",
    "estaaKirjauksen": true
  }
]
```

- `koodi` — the engine's check code (`EITASMAA`, `EITASMAAPVM`, `EIAVOINTAKUTTA`, `PVMALV`,
  `ALVITON_ALVKIRJAUS`, `ERA_ILMAN_ERITTELYA`).
- `estaaKirjauksen: true` — finalizing will fail until this is fixed (block severity);
  `false` — a warning or something the human confirms when finalizing.

Text mode prints the same list as a table followed by the `id`/`tila`/`tunniste`/`pvm` lines
(`varoitukset: (ei rivejä)` when there is nothing to report).

**Refused even as a draft** (exit 1, nothing saved):

| `koodi` | Why |
|---------|-----|
| `TILIPUUTTUU` | A non-zero entry on an account number that is not in the chart. Always a typo; a human could not finalize it without re-keying the entry. The message lists the missing numbers. |
| `PVMPUUTTUU` | The voucher or an entry date is not a real calendar date (e.g. `2026-02-30`). |
| `PVMLUKITTU` | The date falls in a locked period (`TilitPaatetty`) — the engine refuses this for every voucher state. |
| `LUONNOSVAIN` | A `tila` other than 50 was given. |

An unbalanced voucher (`EITASMAA`) or a date outside every fiscal year (`EIAVOINTAKUTTA`) is
still saved: both are legitimate states of an unfinished draft (e.g. a receipt whose second
leg is not known yet, or next year's receipt before that fiscal year is created).

### `liite <tositeId> <tiedosto> [--nimi <nimi>]`

Attach a receipt or invoice file (PDF, JPEG or PNG, at most 10 MB) to a voucher. The type is
taken from the extension (`.pdf`, `.jpg`/`.jpeg`, `.png`) and checked against the file's
leading bytes; `--nimi` sets the stored file name (default: the file's base name). The file
is stored with a SHA-256 checksum through the same engine attachment storage the app uses.

```bash
penni --agentti claude-code liite 42 ~/kuitit/2026-03-puhelin.pdf --json
```

Output:
```json
{
  "id": 7,
  "tosite": 42,
  "nimi": "2026-03-puhelin.pdf",
  "tyyppi": "application/pdf",
  "koko": 48213,
  "sha": "9f2c…"
}
```

Rules:
- Allowed for **drafts** (tila 50) and for **booked** vouchers (tila ≥ 100) whose date and
  entry dates are not in a locked period. Attaching evidence does not change the books.
- A booked voucher in a locked period (`TilitPaatetty`) is refused with `koodi: PVMLUKITTU`;
  deleted/other states with `LIITE_EI_SALLITTU`; a missing voucher with `EITOSITETTA`.
- Always adds a new attachment — it never replaces or deletes an existing one.
- The addition is written to the voucher's audit log (`Tositeloki`) with the `--agentti`
  source, like `luonnos`; the voucher's state and number are unchanged.
- Other errors: `TIEDOSTO` (cannot read the file), `TIEDOSTOTYYPPI` (unsupported extension or
  content that does not match it), `LIITE_LIIAN_SUURI`.

**Security boundary.** Only the CLI reads the file from disk. The registry tool behind this
command (`liite_lisays` in `@penni/tyokalut`) takes the file *content* (base64), a file name
without directories and a MIME type — never a path — because registry tools are also callable
by the in-app assistant. It is a writing tool, so the assistant (Kysy, read-only) refuses it.

### `liitteet <tositeId>`

List a voucher's attachments: `id`, `nimi`, `tyyppi`, `koko` (bytes), `sha`, `luotu`. Never
the file data. (`tosite <id>` includes the same list.)

```bash
penni liitteet 42 --json
```

### `tiliote <tiliote.pdf> [--tili <numero>] [--luonnokset]`

Reconcile a bank statement PDF against the book. Supported formats: the bank's monthly
statement (period, opening and closing balance) and the "Tapahtumat" transaction export
(transactions only). The PDF is read with `lueTiliotePdf` (`@penni/luku`); the matching and
the booking suggestions are the engine's `muodostaTyolista` — the **same code path as the
desktop Täsmäytys view**:

- **Bank account**: the book's `TasmaysPankkitili` setting (what the Täsmäytys view uses),
  otherwise the first bank account in the chart; `--tili` overrides.
- **Balance checks** (monthly statement only): `saldot.tasmaa` — the transactions sum to
  closing − opening balance; `kirjanpito.tasmaa` — the statement's opening balance equals the
  book's bank account balance on the day before the period (`kirjanpito.pvm`).
- **Already booked** (`kirjattu: true`, `tila: "joKirjattu"`): a posting on the bank account
  with exactly the same amount within ±2 days. Matching is count-based — each booked posting
  matches at most one statement row, nearest date first — and drafts count as booked, so a
  half-drafted batch is never drafted twice. `kirjattuTunniste` is `<year>-<voucher number>`.
- **Other states**: `kuittiPuuttuu` (not booked) and `omaPaaoma` (the owner's own money
  movement, by the book's owner names).
- **Suggestion** (`ehdotus`): the history-based booking suggestion — account, VAT code and
  rate, and the title of the earlier similar voucher with the month updated — unless a saved
  vendor expense-account rule applies.

```bash
penni tiliote ~/pankki/tiliote-2026-02.pdf --json
penni --agentti claude-code tiliote ~/pankki/tiliote-2026-02.pdf --luonnokset --json
```

Output (abridged):
```json
{
  "pankkitili": { "numero": 1910, "nimi": "Pankkitili 1" },
  "muoto": "kuukausitiliote",
  "kausi": { "alkaa": "2026-02-01", "loppuu": "2026-02-28" },
  "saldot": {
    "alkusaldo": { "sentit": 0, "eur": "0,00 €" },
    "loppusaldo": { "sentit": 8000, "eur": "80,00 €" },
    "tapahtumienSumma": { "sentit": 8000, "eur": "80,00 €" },
    "tasmaa": true,
    "erotus": { "sentit": 0, "eur": "0,00 €" }
  },
  "kirjanpito": { "pvm": "2026-01-31", "saldo": { "sentit": 0, "eur": "0,00 €" }, "tasmaa": true, "erotus": { "sentit": 0, "eur": "0,00 €" } },
  "lukumaarat": { "joKirjattu": 1, "valmis": 0, "nimitasmays": 0, "kuittiPuuttuu": 1, "omaPaaoma": 0 },
  "rivit": [
    { "nro": 1, "pvm": "2026-02-02", "nimi": "ASIAKAS OY", "viite": "1232", "maara": { "sentit": 10000, "eur": "100,00 €" },
      "tila": "joKirjattu", "kirjattu": true, "kirjattuTunniste": "2026-1", "ehdotus": null, "luonnos": null, "virhe": null },
    { "nro": 2, "pvm": "2026-02-16", "nimi": "PILVIPALVELU", "viite": null, "maara": { "sentit": -2000, "eur": "−20,00 €" },
      "tila": "kuittiPuuttuu", "kirjattu": false, "kirjattuTunniste": null,
      "ehdotus": { "tili": 7690, "tilinNimi": "Atk-palvelut", "alvKoodi": 0, "alvProsentti": 0, "otsikko": "Pilvipalvelu helmikuu 2026", "peruste": "pankkinimi" },
      "luonnos": null, "virhe": null }
  ],
  "luonnokset": null
}
```

`saldot` and `kirjanpito` are `null` for the Tapahtumat export (no balances).

**`--luonnokset`** creates draft vouchers (tila 50, no voucher number) for the rows the
desktop view pre-selects — every row that is not already booked and not the owner's own
money movement — exactly as its "Kirjaa valitut" does: with the suggested account, and for
rows without a receipt the suggested VAT code (domestic VAT is split out of the gross amount,
reverse-charge VAT is added on both sides); without a suggestion the engine's default
account rules apply. Each created draft's id is on its row (`luonnos`) and in `luonnokset`;
a row that fails (e.g. locked period) gets `virhe` and the others continue. The drafts are
logged with the `--agentti` source. Running the command again finds the new drafts as booked.
The CLI has no receipt folder: attach receipts afterwards with `penni liite`.

Errors: `TIEDOSTO` (cannot read the file), `EI_TEKSTIA` (scanned PDF without a text layer),
`VAARA_MUOTO` (no supported statement format found), `EIPANKKITILIA`, `TILIPUUTTUU`
(`--tili` not in the chart).

**Security boundary.** Only the CLI reads the PDF from disk and parses it; the registry tool
(`tiliote` in `@penni/tyokalut`) receives the parsed statement (period, balances and
transactions in cents), never a path. It is a writing tool (it can create drafts), so the
in-app assistant (Kysy) does not get it.

### `ohje [--json]`

Agent guide: tool registry, field specs, and examples. JSON includes a `tyokalut` array (registry
tool name, description, schema). Each entry also carries a `komento` field — the actual command
word to type on this CLI, since some registry tool names differ from their command (e.g. tool
`tilit_haku` is invoked as `penni tilit`) — and a `kaytto` usage line with the CLI arguments.
Read `kaytto` for the arguments: `syote` is the tool's input schema, which for `liite` and
`tiliote` takes file *content* (the CLI reads the file you name) and for `luonnos` is the stdin
JSON. The human-readable form (no `--json`) lists commands by `komento`, grouped into read
commands and writing commands (new drafts and attachments only), each with its `käyttö:` line.

```bash
penni ohje
penni ohje --json
```

## For agents

Start by calling `penni ohje --json` to discover available tools and their schemas.

**Money** is always an object with two fields:
- `sentit`: integer cents (e.g., `10000` for 100.00 €).
- `eur`: formatted display string (e.g., `"100,00 €"`).

**Dates** are ISO 8601 `YYYY-MM-DD`.

**Draft vouchers** are transient: they do not consume a sequential number, and they
can be edited or discarded without bookkeeping consequences. Finalization (`tila ≥ 100`)
is a human action in the web app — the CLI cannot finalize, unlock, delete, or file
any voucher. The only writes are new drafts (`luonnos`, `tiliote --luonnokset`) and new
attachments (`liite`).

**Audit trail**: every mutation (via `luonnos`, `liite`, `tiliote --luonnokset` or the app) is
logged with a `lahde` (origin). Use `--agentti` to tag your calls in the audit log for tracing.

## Errors

On error, the CLI writes to stderr and exits with code 1:

```json
{
  "virhe": "virheviesti",
  "koodi": "koodi"
}
```

In text mode (no `--json`), errors are human-readable to the console.
