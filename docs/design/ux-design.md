# Penni — UX & Visual Design (Tier‑0)

**Status:** Draft for review · **Date:** 2026-06-26 · **Companion to:** `architecture.md`.

The visual language and core interaction model for **Penni** (inspired by and partly derived from Kitsas, see `NOTICE.md`), decided through an interactive mockup session. Mockups live in `docs/mockups/`. This spec defines design tokens, the component kit, and the key Tier‑0 screens precisely enough to build against React + Vite + shadcn/Tailwind.

---

## 1. Design principles

1. **Fast & simple above all.** The daily loop (enter a voucher, find a voucher, read a report) must feel instant. Minimal fields, smart defaults, no modal mazes.
2. **Keyboard-first for the power user, approachable for the owner.** Everything reachable by keyboard; mouse never required. Complexity is *progressively disclosed*, never dumped.
3. **Honest double-entry, quietly.** The grid editor *is* double-entry (debet/kredit), but the UI does the bookkeeping work for you (VAT, balancing-line suggestions, live `Täsmää`). The truth is always visible, never hidden.
4. **Calm and minimal (direction A).** White, hairline borders, generous whitespace, one restrained indigo accent, flat (no decorative shadows). The numbers lead; the chrome recedes.
5. **Light-first, dark-ready.** Ship light; the token system makes a dark theme a swap, not a rewrite.
6. **Finnish-native.** Number/date formatting, terminology, and statutory layouts are Finnish by default (fi/sv/en switchable via the `kaanna` layer).
7. **Accessible.** WCAG AA contrast, visible focus rings, full keyboard nav, the grid usable with a screen reader.

## 2. Visual language — direction A (tokens)

All values are **design tokens** (CSS custom properties → Tailwind theme). Dark theme reuses the token *names* with different values (deferred). Hex values below are the working set; the accent hue in particular is tunable.

### 2.1 Color (light theme)

| Token | Value | Use |
|---|---|---|
| `--bg-app` | `#ffffff` | main content background |
| `--bg-subtle` | `#fafafa` | sidebar, table zebra, insets |
| `--surface` | `#ffffff` | cards, panels |
| `--border` | `#ececf0` | hairline separators, card borders |
| `--border-strong` | `#e4e4e7` | input borders |
| `--text` | `#18181b` | primary text, figures |
| `--text-muted` | `#6b7280` | secondary text, nav |
| `--text-subtle` | `#9ca3af` | labels, placeholders, dates |
| `--accent` | `#4f46e5` | primary actions, active nav, focus |
| `--accent-soft` | `#eef2ff` | focused-row tint, accent backgrounds |
| `--accent-fg` | `#ffffff` | text on accent |
| `--positive` | `#16a34a` | positive amounts, `Täsmää` |
| `--positive-soft` / `--positive-border` | `#f0fdf4` / `#bbf7d0` | balance bar (balanced) |
| `--warning` | `#d97706` | warn-severity validation |
| `--danger` / `--danger-soft` | `#dc2626` / `#fef2f2` | block-severity validation, errors |
| `--focus-ring` | `rgba(79,70,229,.15)` | 3px focus ring + `--accent` border |

**Accent note:** `#4f46e5` is the working indigo; tune toward Linear's `#5E6AD2` or Stripe's `#635BFF` during the polish pass. It is one token — changing it re-skins the app.

### 2.2 Typography

- **Family:** `Inter` (variable) for all UI, system-sans fallback. No serif (that belonged to the rejected warm direction).
- **Money & figures:** always `font-variant-numeric: tabular-nums`. Money is right-aligned in tables.
- **Type scale (px):** label 9.5 · xs 11 · sm 12.5 · base 13.5 · md 15 · lg 16 · xl 21 · display 27 (rare).
- **Weights:** 400 body · 500 medium · 600 semibold (titles, active nav, primary buttons) · 700 sparingly (page titles).
- **Labels:** uppercase, 9.5px, letter-spacing .6px, `--text-subtle`, weight 600.

### 2.3 Spacing, radius, elevation

- **Spacing scale (px):** 4 · 6 · 8 · 10 · 13 · 16 · 20 · 24 · 32.
- **Radius:** input 6 · button 8 · card 10 · panel 13 · pill 999.
- **Elevation:** flat by default (borders, not shadows). One elevation token for floating layers only (popovers, menus, command palette): `0 8px 24px rgba(0,0,0,.12)`.
- **Icons:** line icons (Lucide), 1.5px stroke, 16px default.

## 3. Component kit (shadcn/Tailwind)

Built on shadcn/ui + Radix primitives, themed with the tokens above. The kit, and what each maps to:

| Component | Behaviour / source |
|---|---|
| **App shell** | fixed 158px sidebar (`--bg-subtle`, hairline right border) + main column. |
| **Sidebar nav item** | 8px-radius row; active = `--surface` with a 1px ring + accent icon + semibold; inactive = `--text-muted`. |
| **Top bar** | page title (md/semibold) + subtitle (subtle) on the left; primary/secondary actions on the right. Hairline bottom border. |
| **Button** | primary (accent fill, `--accent-fg`), secondary (surface + `--border-strong`), ghost (text only). 8px radius, 600 weight. |
| **Field** | label (uppercase tiny) + input (`--border-strong`, 6px). Focused = `--accent` border + `--focus-ring`. |
| **Segmented control** | `#f4f4f5` track, active segment = surface + accent text. (Voucher type, mode toggles.) |
| **Table (ledger)** | TanStack Table; uppercase tiny headers; hairline row borders; tabular-nums; right-aligned money; row hover = `--bg-subtle`; focused/edited row = `--accent-soft`. |
| **Combobox / autocomplete** | Radix/cmdk; the **account picker** — type number or name, filtered list, keyboard select. Account number shown subtly left of name. |
| **KPI card** | label (uppercase tiny) + figure (md/semibold tabular). Surface + hairline; the hero figure (e.g. Tulos) may use accent fill. |
| **Balance bar** | sticky footer of the voucher editor: `Debet n · Kredit n · ✓ Täsmää` (positive-soft) or `Erotus n` (warning/danger). |
| **Command palette** | `cmdk`, opened with `⌘K`: jump to anything, run any action. |
| **Toast** | bottom, subtle; for save confirmations and async results. |
| **Empty state** | line icon + one line + a primary action; calm, never a dead end. |

## 4. Key screens

### 4.1 App shell & navigation

Sidebar: brand (accent mark + "Penni") · Kojelauta · Tositteet · Laskut · Raportit · Tilikartta · Asetukset · (book/period indicator at the foot). The active book + fiscal year are always visible. `⌘K` command palette is the universal accelerator.

### 4.2 Dashboard (Kojelauta)

The overview seen in the mockups: a row of KPI cards (Tilikauden tulos / Pankki / Myyntisaatavat / ALV-velka) over a recent-vouchers list. Calm, scannable, tabular figures, positive amounts in `--positive`. Each KPI links to its detail (saldo, ledger, VAT). A single primary `+ Uusi tosite` action.

### 4.3 Voucher entry — the grid *(DEFAULT editor)*

The centerpiece and the daily driver. A keyboard-first double-entry grid; **fast & simple** is the acceptance bar.

**Layout:** top fields (Päivä · Tyyppi · Selite) over the entry grid (Tili · Selite · Debet · Kredit · ALV) with a sticky **balance bar** and primary actions (`Tallenna`, `Tallenna ja uusi`).

**The fast path (target: a simple expense in ~5 keystrokes + amounts):**
1. `N` (or `+ Uusi tosite`) opens the editor with **Päivä pre-filled to today**, cursor in the first `Tili` cell.
2. Type an account number or name → autocomplete → `Enter` accepts.
3. `Tab` to amount → type it. **VAT auto-fills from the account's default rate** (resolved by date, per the architecture spec's rate-by-date rule).
4. `Enter` adds the next row, **pre-suggesting the balancing line** (e.g. the default pankki/vastatili for the remaining amount) so a two-line voucher needs almost no typing.
5. `⌘S` saves; `Tallenna ja uusi` reopens a blank voucher for stack entry.

**Smart defaults:** account-derived VAT; suggested counter-account; remembered recent accounts/selite; auto-generated VAT entry rows shown read-only (not hand-keyed).

**Validation surfacing** (maps directly to the architecture spec's `Violation` severities):
- `block` (e.g. `EITASMAA`, `PVMLUKITTU`) → balance bar/field turns `--danger`; `Tallenna` disabled with the reason inline. Finalize is blocked.
- `warn` (only `EITASMAAPVM`) → `--warning` hint; save still allowed.
- `confirm` (era/account, VAT-exempt) → a small confirm step before finalize, never a silent pass.
- The live `✓ Täsmää` is the always-visible expression of the debet=kredit invariant.

**Numbering:** the draft shows "Luonnos · ei numeroa ennen tallennusta"; the sequential `tunniste` is assigned on finalize (per `(tilikausi, sarja)`), shown after save — reflecting that numbering is a property of the finalized record.

### 4.4 Simplified entry *(secondary)*

The guided "tapahtuma" form (type → amount → account; double-entry generated and previewed) remains available — for the owner or quick one-offs — but is **not** the default. It produces the identical `Tosite`; "avaa gridinä" expands it into the grid.

### 4.5 Remaining Tier‑0 screens (patterns)

These apply the kit above; they pose no new visual decisions and are detailed during implementation:

- **Ledger browser (Selaus):** a TanStack table over `/tositteet` / `/viennit` with a filter bar (pvm range, tyyppi, tili, kumppani, viite, luonnos/poistetut). Fast keyboard navigation; row → open voucher. Running balance for account views (`paakirja`).
- **Reports (Tuloslaskelma / Tase):** rendered from the report-row DSL + `/saldot`; clean typographic statement (indent/subtotal/bold per DSL flags), period selector, current-vs-previous columns, drill-down to ledger, export (PDF/CSV).
- **New-book wizard:** 3 steps — org type (yritys / yhdistys / asoy) → seed chart preview → fiscal year + basics. Calm, one decision per step; sensible defaults; finishes into the dashboard.

## 5. Global interaction & keyboard model

- `⌘K` command palette (go anywhere, do anything).
- `N` new voucher · `/` focus search · `⌘S` save · `Esc` cancel/close.
- In the grid: `Tab`/`Shift+Tab` move cells, `Enter` new row, `⌘Enter` save-and-new, arrow keys in autocomplete.
- Everything actionable has a discoverable shortcut surfaced in the command palette and inline key hints.

## 6. Localization & formatting

- **Money:** Finnish format `1 234,56 €` — space thousands separator, comma decimal, trailing `€`. Rendered from integer cents via the `Euro` layer; tabular-nums; right-aligned.
- **Dates:** `pp.kk.vvvv` (`26.06.2026`); long form in greetings (`26. kesäkuuta 2026`).
- **i18n:** fi default, sv/en switchable; runtime/data strings via the `kaanna`/`tulkkaa` layer (carried from the current app); UI strings via standard React i18n.

## 7. Accessibility, density, responsiveness

- **A11y:** WCAG AA contrast on all token pairs (verify accent-on-white and muted text); always-visible focus rings (`--focus-ring`); the grid exposes proper roles/labels so debet/kredit and balance state are announced.
- **Density:** a **comfortable ⟷ compact** toggle (row height/padding) — comfortable for owners, compact for accountants — without changing the layout.
- **Responsive:** desktop-first (it is a pro tool), but the shell collapses the sidebar to icons and stacks KPI cards on narrow widths; voucher grid remains usable on a laptop.

## 8. Implementation notes

- **Tokens → Tailwind:** define tokens as CSS variables on `:root` (+ a `.dark` scope later); map them in `tailwind.config` `theme.extend.colors` so utilities resolve to vars. Components consume tokens only — no hard-coded hex in components.
- **Libraries:** shadcn/ui + Radix (primitives, theming), TanStack Table (ledger/grid), `cmdk` (command palette), Radix Combobox (account picker), Lucide (icons), Inter (variable font, self-hosted).
- **Component package:** lives in `packages/ui` (per the architecture monorepo) so web app and any future surface share one kit.

## 9. Deferred / open items

- **Dark theme** (token values only).
- **Accent hue** final tuning (working `#4f46e5`).
- **Final detail mockups** for ledger, reports, new-book wizard (patterns agreed; pixels during implementation).
- **Real font licensing/self-hosting** and a polish pass (micro-interactions, empty states, loading skeletons).
- **Invoicing / VAT / year-end screens** — Tier‑1+ UX, their own specs.

## Appendix — mockup references

`docs/mockups/`: `visual-direction.html` (A/B/C) · `visual-direction-scandi.html` · `voucher-entry.html` (grid vs simple). Chosen: **direction A**, **grid editor default**.
