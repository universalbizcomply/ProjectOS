# 03 — UI Spec (Control Center design system)

Source of truth: `projectos/control-center/src/styles.css`, lines 23–120 (2,961 lines in total; one
file; no Tailwind, no component library). The values below are quoted from it. Do not invent new
values; reuse these tokens.

## 1. Themes

`src/owner/ShellTheme.tsx` sets `data-shell` on the root element:
- `standard` (default, light) or `command` (dark HUD);
- stored in localStorage `projectos.shell-theme`.

"Softer motion" sets `data-calm="1"` (localStorage `projectos.calm-motion`). It and
`prefers-reduced-motion` both stop all animation. `backdrop-filter` is banned.

## 2. Colour tokens

| Token | Standard (`:root`) | Command (`[data-shell='command']`) |
|---|---|---|
| `--bg` | `#eceef0` | `#050914` |
| `--rail` | `#e4e7ea` | `#070c1c` |
| `--card` | `#ffffff` | `rgba(14,32,68,0.55)` |
| `--card-2` | `#f6f7f9` | `rgba(20,44,88,0.55)` |
| `--tile` | `#f0f2f4` | — |
| `--tab-on` | `#ffffff` | — |
| `--idle-soft` | `#e2e5e9` | — |
| `--line` | `rgba(17,24,31,0.14)` | `rgba(0,213,255,0.30)` |
| `--line-soft` | `rgba(17,24,31,0.085)` | `rgba(0,213,255,0.17)` |
| `--ink` | `#0f1519` | `#e2f7ff` |
| `--dim` | `#4a545d` | `#8fc0dd` |
| `--faint` | `#5e6772` (≥4.5:1 on all backgrounds) | `#6f9dbe` |
| `--acc` | `#2c6390` | `#00d5ff` |
| `--acc-hi` | `#35759f` | `#5ee6ff` |
| `--acc-ink` | `#ffffff` | `#02121c` |
| `--acc-soft` | `#e0e8f0` | — |
| `--acc-line` | `#a6bed4` | — |
| `--acc-grad` | `linear-gradient(180deg,#356f9d,#255579)` | `linear-gradient(180deg,#3ce4ff,#00a8d8)` |
| `--acc-edge` | `#1f4a6b` | — |
| `--ok` / `--ok-soft` | `#1c6543` / `#dfeae4` | `#00d5ff` / same at 0.14 alpha |
| `--warn` / `--warn-soft` | `#795009` / `#f3e9d6` | `#ff5ad9` / same at 0.14 alpha |
| `--crit` / `--crit-soft` | `#8b2e25` / `#f1dedb` | `#ff6f5e` / same at 0.14 alpha |
| `--badge-ink` | `#ffffff` | `#12021c` |
| `--hud` / `--hud-2` | — | `#00d5ff` / `#ff5ad9` |

**Shadows (standard):**
- `--shadow: 0 1px 1px rgba(15,21,25,0.04)`
- `--btn-shadow: 0 1px 1px rgba(15,21,25,0.10), inset 0 1px 0 rgba(255,255,255,0.22)`
- `--hero-shadow: 0 1px 1px rgba(15,21,25,0.05), 0 10px 28px rgba(15,21,25,0.07)`
- `--lift: none`

**Shadows (command):** glows, e.g.
`--btn-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 0 22px rgba(0,213,255,0.45)`, and `--lift`
holds two radial gradients.

**Compatibility aliases** (for older screens only; do not use in new code): `--bg-panel`,
`--bg-elev`, `--text`, `--text-dim`, `--text-faint`, `--accent`, `--accent-dim`, `--mono`, `--sans`.

## 3. Typography

- **Fonts:** bundled, not loaded from the web (`public/fonts`): Barlow 400/500/700 and Barlow
  Condensed 400/600.
- **Families:**
  - `--font-body: Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif`
  - `--font-heading: 'Barlow Condensed', …`
  - `--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- **Rule:** all h1–h6 use `--font-body`. The condensed face was rejected on review.

| Style | Size / weight / tracking / line-height |
|---|---|
| Body | 15px / 400 / — / 1.6 |
| `h1.os-h1` | 36px / 600 / −0.035em / 1.12 |
| `.os-firstrun h1` | 40px / 600 / — / 1.08 |
| `.os-h2` | 22px / 600 / −0.028em |
| `.os-h3` | 14px / 600 |
| `.os-lede` | 15.5px |
| `.os-set-sub` | 14.5px |
| Dense UI text | 13px most common, then 12px and 14px; weight 600 most common |
| Command mode secondary, ghost and rail controls | mono, 11.5px, uppercase, tracking .13–.14em |

## 4. Spacing, radii, layout

- **No spacing tokens exist.** The values are hard-coded and must be reused as they are:
  - rail `308px`, padding `26px 18px`;
  - canvas padding `58px 72px 0`;
  - content column max `788px`, gap `42px`;
  - `.os-stack` gap `30px`;
  - `.os-plate` padding `32px`, radius `14px`.
- **Radii:** `--radius: 12px`, `--radius-sm: 8px`; also 999px (pills), 14, 10, 9 and 50%.
- **Breakpoints:** 1180, 1080, 900 (the rail stacks on top), 760, 640, 520.
- **Touch targets:** minimum 44px under `(pointer: coarse), (max-width: 520px)`.
- **Window:** 1200×820, minimum 900×600 (`src-tauri/tauri.conf.json`).

## 5. Core component states

| Component | Default | Hover / active | Disabled | Busy |
|---|---|---|---|---|
| `.os-pri` (primary button) | `--acc-grad` fill, `--btn-shadow`, 42–56px high depending on context, radius 8–12px | `filter: brightness(1.08)` / `translateY(1px)` | `opacity: .45` | label swaps ("Working…", "Storing…", "Stopping…"); an in-flight ref blocks double clicks; **no spinners** |
| `.os-sec` | transparent, `--line` border, radius 9px | — | `opacity: .45` | as above |
| `.os-ghost` | text only | — | `opacity: .45` | — |
| `.os-iconbtn` | 40×40, radius 9px, `.on` state | — | `opacity: .45` | — |
| `.os-input` / `.os-select` | 46px high | focus ring | — | — |
| `.os-tabs` / `.os-tab` | 36px high | `aria-selected` | — | — |
| Status dot | always next to a word: working `--ok`, waiting `--warn`, blocked `--crit`, done `--acc`, ready/paused `--faint` | — | — | — |
| Chips and badges | `.xw-chip` (10px uppercase pill: working / held / complete / blocked); `.ocp-badge` (ok / warn / crit / mut) | — | — | — |
| Confirmation | inline (`.ocp-confirm`, `.xw-confirm`, `OwnerActionInbox` `role="alertdialog"`). Focus moves to the confirm button; Escape cancels; **no modals** | — | — | — |
| Messages | `.os-refusal` (`.failed` = error, `role=alert`), `.os-empty`, `.xw-empty`, `.os-toast` (3,000 ms) | — | — | — |

## 6. Known UI debt (do not copy)

- **Variables used but never defined:** `--os-accent`, `--os-line`, `--os-ink`, `--os-ink-dim`,
  `--os-inset`, `--os-mono`, `--warn-ink`.
- **Hard-coded dark colours in older screens:** `#0e131d`, `#10261c`, `#ff9a9a`.
- **Duplicate rule:** `.ocp-btn` is defined twice (lines 526 and 693).
- **Unstyled class:** `os-primary` (Files tab, "Add a file") has no CSS rule.
- **Missing docs:** the design handoff and `IMPLEMENTATION_ORDER` docs cited in the code are absent
  from the repo. The README's view list is stale.
