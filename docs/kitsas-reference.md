# Kitsas reference notes

Reference notes on the upstream **Kitsas** (formerly Kitupiikki) C++/Qt code, which is included
unmodified in the `kitsas-source/` git submodule. All paths below are relative to `kitsas-source/`.
Penni's own code does not use this structure; the notes are kept to help locate the original
Finnish bookkeeping rules when porting or checking behaviour (see [`NOTICE.md`](../NOTICE.md) for
how Penni relates to Kitsas). The Finnish glossary at the end is used across Penni as well.

## Language note

The Kitsas code base — identifiers, comments, Doxygen docs, UI strings, commit messages — is in
Finnish. See the glossary below for navigating it.

## Build

Built with **Qt 6 (≥ 6.4; all features need 6.8)** and **qmake**. Requires QtWidgets, QtSql, QtPdf, QtPdfWidgets, QtWebEngineWidgets, QtSvg, plus `core5compat`/`svgwidgets` on Qt 6. Linux also links `libzip` (`-lzip`, gated by `DEFINES += USE_ZIPLIB`); Windows links `openjp2` and `bcrypt`.

The app target lives in `kitsas/kitsas.pro` (`TARGET = kitsas`). The top-level `kitsasproject.pro` is a `subdirs` project bundling the app plus all unit tests.

```bash
# App only
qmake kitsas/kitsas.pro "CONFIG+=release" && make qmake_all && make -j

# Everything (app + all unit tests)
qmake kitsasproject.pro && make qmake_all && make
```

`make qmake_all` is required — it regenerates per-target Makefiles before `make`. QtCreator is the intended dev environment. Packaging/cross-compile scripts: `kaanna-*.sh` (build) and `paketoi-*.sh` (package: AppImage / Windows-MXE / Mac). `kitsas/versio.h` holds the version, API URL (`KITSAS_API`), and feature flags (`PRO_VERSIO`, `KITSAS_PORTABLE`).

## Tests

Tests are **QtTest** executables. There are two trees:
- `unittest/` — focused unit tests, each its own `.pro` (`AlvLaskelmaTesti`, `KieliTesti`, `ValidatorTest`, `eurotest`, `tositerivitesti`, `viitetesti`). Each includes `unittest/apptest.pri`, which pulls in the **entire app source** via `../kitsas/sources.pri` and adds `QT += testlib` + `CONFIG += testcase`.
- `testit/` — broader integration tests (`testit.pro`, `pdftesti.pro`, `tiliotetesti.pro`), exercising PDF import, bank-statement (tiliote) parsing, etc. against fixtures in `testit/data/` and `unittest/data/` (e.g. `oy.kitsas`).

```bash
# Build & run one unit test
qmake unittest/eurotest/eurotest.pro && make qmake_all && make && ./eurotest

# Single test function (QtTest filter)
./eurotest "testFunctionName"
```

Note `unittest/apptest.pri` still references `-lpoppler-qt5`/`-lpoppler`; on a Qt 6 / poppler-less setup adjust libs locally before building tests.

## Architecture

### The `kp()` singleton and the REST abstraction (most important)

Everything routes through one global: **`kp()`** (alias for `Kirjanpito::db()`, `db/kirjanpito.h`). It owns every shared model — accounts (`tilit()`), fiscal years (`tilikaudet()`), settings (`asetukset()`), cost centres (`kohdennukset()`), VAT types (`alvTyypit()`), products (`tuotteet()`), and more — and emits app-wide signals (`tietokantaVaihtui`, `kirjanpitoaMuokattu`, `tilikausiPaatetty`, `onni`, …). `KitsasInterface` (`db/kitsasinterface.h`) is the abstract face of these getters so tests can supply partial implementations.

**All data access is a REST-style query, regardless of backend.** Create one with the global `kpk(polku, metodi)`, which returns a `KpKysely` (`db/kpkysely.h`) with `GET/POST/PATCH/PUT/DELETE` semantics and `vastaus` / `lisaysVastaus` / `virhe` signals. `kpk()` delegates to `kp()->yhteysModel()->kysely(...)`. There are two `YhteysModel` implementations:

- **SQLite** (`sqlite/`, local `.kitsas` file): `SQLiteModel` dispatches each path to a `SQLiteRoute` subclass in **`sqlite/routes/`** (`tositeroute`, `myyntilaskutroute`, `alvroute`, `tilitroute`, …). These routes **deliberately mirror the cloud server's REST endpoints**, so application code is identical for both backends.
- **Cloud** (`pilvi/`, Kitsas' hosted cloud service): `PilviModel` / `PilviKysely` make real HTTP calls. The Pro version (`--pro` or `PRO_VERSIO`) logs straight into the cloud.

In upstream, a feature touching stored data extends the SQLite route and keeps it matching the cloud endpoint's request/response shape; raw SQL lives only under `sqlite/`.

### Domain model

`model/` holds the bookkeeping core: `Tosite` (voucher/document) contains `TositeVienti`/`TositeViennit` (ledger entries) and `TositeRivi`/`TositeRivit` (invoice rows); `Lasku` (invoice), `Maksutapa` (payment method), `Euro` (integer-cents money type; no floats for money). `db/` holds the Qt item-models loaded once per open book (`TiliModel`, `TilikausiModel`, `AsetusModel`, `KohdennusModel`, …) plus the `Tili`/`Tilikausi`/`Kohdennus` value types.

### Major UI areas (each a top-level dir, generally a page/widget under the main window)

`KitupiikkiIkkuna` (`kitsas/kitupiikkiikkuna.cpp`) is the main window; `main.cpp` wires up the singleton, fonts, splash, login. Feature areas:

| Dir | Area |
|-----|------|
| `aloitussivu` | Start page / welcome / login |
| `kirjaus` | Voucher entry (bookkeeping) |
| `laskutus` | Invoicing (sales/purchase invoices, IBAN, reference numbers) |
| `selaus` | Browsing vouchers/ledger |
| `raportti` | Reports (income statement, balance sheet) |
| `tilinpaatoseditori` | Financial-statement editor |
| `alv` | VAT (ALV) reporting |
| `kierto` | Document circulation / approval workflow |
| `arkisto` / `arkistoija` | HTML electronic archive generation |
| `tuonti` / `kitupiikkituonti` | Imports (PDF invoices in `tuonti/pdf`, bank statements in `tuonti/pdftiliote`, legacy Kitupiikki data) |
| `naytin` | PDF/attachment viewer |
| `maaritys` | Settings/configuration screens |
| `uusikirjanpito` | New-book wizard (`tilikartat/` = chart-of-accounts templates, `sqlite/luo.sql`) |
| `pilvi` / `tilaus` / `toimisto` | Cloud account, subscriptions, accounting-office multi-book view |
| `validator` | IBAN / Finnish reference-number validators |
| `tools` | Shared helpers, logging (`kitsaslokimodel`) |

### Internationalisation

Two layers: Qt `.ts` translations (`tr/kitsas_en.ts`, `tr/kitsas_sv.ts`) and a custom JSON dictionary `tr/tulkki.json` driven by `Kielet` (`kieli/`). In code, translate runtime/data strings with `kp()->kaanna(teksti, kieli)` or the global `tulkkaa(...)`; UI uses standard Qt `tr()`.

## Finnish glossary (for navigating identifiers)

kirjanpito = bookkeeping · tili = account · tilikausi = fiscal year · tosite = voucher/document · vienti = ledger entry · kirjaus = posting/entry · lasku = invoice · myyntilasku/ostolasku = sales/purchase invoice · alv (arvonlisävero) = VAT · kohdennus = cost centre/project · maksutapa = payment method · tiliote = bank statement · raportti = report · tilinpäätös = financial statements · kohdennus = allocation · kumppani/asiakas/toimittaja = partner/customer/supplier · era = open item/installment · ryhmä = group · pilvi = cloud · yhteys = connection · kysely = query · asetus = setting · kierto = circulation/workflow · selaus = browsing · tuonti = import · liite = attachment · viite = reference number · huoneisto = apartment (housing-company features) · ainokainen = singleton · kaanna/tulkkaa = translate.
