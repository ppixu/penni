# @penni/kuitti-validointi

Read-only harness: runs real receipts from a `.kitsas` book through penni's text-based
receipt pipeline (path A) and reports per-field accuracy vs. the booked vouchers.
The harness is read-only: it never writes to the book it validates.

## Prerequisites

- Node ≥ 22, pnpm.
- **Tesseract** for image/scanned receipts: `brew install tesseract tesseract-lang`
  (the `fin`+`eng` language data). Without it, image/scanned receipts count as
  unreadable rather than failing the run.

## Run

```bash
# operate on a COPY of the real book (harness is read-only, but be safe)
cp ~/git/kitsas/<oma-kirja>.kitsas /tmp/validointi.kitsas
pnpm --filter @penni/kuitti-validointi validoi --db /tmp/validointi.kitsas --out ./kuitti-raportti
```

Flags: `--db <path>` (required), `--out <dir>` (default `./kuitti-raportti`),
`--limit N` (first N vouchers), `--vision` (opt-in; see below).
`--omistaja <nimi>` (repeatable) names the book owner for private-withdrawal matching; the built-in
default is a fictional placeholder, so pass your own name when validating a real book.

## `--vision` (optional)

Reruns image/scanned receipts through a cloud vision model. **Off by default. It uploads
receipt images to an external provider** — your data, your call. Requires the provider
credential in the environment (see `src/vision.ts`).

## Q5: Workers AI -litteraattori ja synteettinen pisteytys

Pilvi-spiken Q5 mittaa, riittääkö
pilvessä ajettava avoimen painon näkömalli valokuvien litterointiin. Mittaus ajetaan
**synteettisillä fikstuureilla** (`fixtures/synteettinen/`, keksittyä dataa; generaattori
`src/synteettinen/`) — oikeita kuitteja ei lueta eikä lähetetä.

```bash
# 1. Paikallinen Worker jonka `ai`-sidonta välittää kutsut tilillesi (ei deployta, ei luo resursseja;
#    vaatii `wrangler login`). Jätä pyörimään toiseen terminaaliin:
pnpm --filter @penni/kuitti-validointi worker

# 2. Pisteytys: Tesseract (normalisoitu + raaka) + Workers AI -mallit (+ Ollama jos vastaa)
pnpm --filter @penni/kuitti-validointi synteettinen \
  --malli @cf/qwen/qwen3.8-27b --malli @cf/google/gemma-4-26b-a4b-it
```

Tulokset (`tulokset/`, git-ignoroitu): `scorecard.md` (avainmittarit), `report.md`/`report.json`
(sama muoto kuin päiväharnessin), `transkriptit/`. **Kutsukatto 60** Workers AI -kutsua yhteensä:
laskuri on yksi kiinteä tiedosto `.ai-tila/laskuri.json` (paketin juuressa, git-ignoroitu; ei
riipu `--out`ista eikä cwd:stä, joten tulosten poistaminen ei nollaa sitä; vanhat
`<out>/ai-laskuri.json`-laskurit migroidaan maksimina, ja jos laskuri puuttuu mutta välimuistissa
on vastauksia, ajo kieltäytyy). Vastaukset välimuistissa (`tulokset/cache-ai/`, avain malli +
kuvan sha + kehote), joten uusinta ei kuluta kutsuja. `--vain <osa-nimestä>` ajaa vain osan
fikstuureista. Fikstuurit uudelleen: `pnpm --filter @penni/kuitti-validointi generoi-fikstuurit`
(vaatii `pdftoppm` ja macOS:n `sips`).

Workers AI on **vain** tässä synteettisessä ajossa. Päiväharnessissa (`validoi`) ei ole
Workers AI -saraketta, eikä synteettinen ajo avaa mitään fikstuurihakemiston ulkopuolelta
(`fikstuuriPolku` kieltäytyy, symlinkit mukaan lukien): oikeita kuitteja ei lähetetä Cloudflarelle.
Oikean korpuksen ajo vaatii omistajan erillisen hyväksynnän ja tekemättömän toteutuksen.

### Kuvan esikäsittely (kaikille sarakkeille)

`rasteroi()` ajaa kuvat `normalisoiKuva()`n läpi: JPEG:n EXIF-orientaatio sovelletaan pikseleihin
(tagi nollataan, ettei palvelin kierrä toiseen kertaan) ja pitkä sivu rajataan 1100 px:ään kuten
PDF-rasteroinnissa. Vaatii macOS:n `sips`in. `ocr`-kehote (`OCR_KEHOTE`, `src/vision.ts`) vaatii
rivinvaihtojen säilyttämistä ja kieltää arvojen laskemisen ja keksimisen.
