# Documentation style guide

Conventions for writing or extending docs in this repo. The goal is to keep the
docs **scannable, current, and TL;DR-resistant** — every addition must earn its place.

→ Back to [README](../README.md)

## File naming

| Pattern | Used for | Examples |
| --- | --- | --- |
| `ALL-CAPS.md` at repo root | Top-level meta-docs | `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `MIGRATION.md`, `TESTING.md`, `LICENSE.md` |
| `ALL-CAPS.md` in `docs/` | User reference docs | `docs/CONFIGURATION.md`, `docs/CONDITIONS.md`, `docs/SENSORS.md`, `docs/TROUBLESHOOTING.md` |
| Lowercase | Special-purpose | `README.md` (GitHub; HACS renders it in the store via `render_readme`) |

## Header pattern

Every doc starts with the same three-block header:

```markdown
# Title

[1–2 descriptive sentences: what this covers, who it's for.]

→ Back to [README](../README.md)
```

The "Back to README" link is the navigation anchor — never skip it.

## Voice by doc-type

Pick the voice that matches the reader's mode:

| Doc-type | Voice | Examples in this repo |
| --- | --- | --- |
| **Procedural** (do-this-then-that) | Imperative, direct: *"Run X. Open Y. Set Z."* | `CONTRIBUTING.md`, `TESTING.md`, `MIGRATION.md` |
| **Reference** (lookup) | Tables + concise prose. Cold neutral tone. | `docs/CONFIGURATION.md`, `docs/CONDITIONS.md` |
| **Explainer** (concept) | Prose with code-path traces, *why*-focused. | `ARCHITECTURE.md` |
| **Q&A** (problem/solution) | Question-as-heading + direct answer. | `docs/TROUBLESHOOTING.md` |

All English, casual but precise. No filler ("simply", "just", "very") — these are
fluff that adds words without information.

## Tables vs. prose

- Use a **table** when items have ≥ 3 attributes (config keys: name + type + default + desc).
- Use **prose** when explaining *why* something exists or *how* it interacts with other parts.
- Don't sprawl: ≤ 5 columns per table; wrap descriptions inside cells.

## Code-block conventions

Always tag the language:

```yaml
forecast:
  show_sunshine: true
```

```bash
npm run build
```

```ts
import { lightenColor } from '../format-utils.js';
```

Never use bare ` ``` `. The tag drives syntax highlighting on GitHub.

## Cross-linking

| From | To | Pattern |
| --- | --- | --- |
| Within same doc | Section | `[Section name](#section-anchor)` (auto-generated) |
| README | `docs/X.md` | `[docs/X.md](docs/X.md)` |
| `docs/X.md` | `docs/Y.md` | `[X → Y](Y.md#y-anchor)` |
| `docs/X.md` | README | `→ Back to [README](../README.md)` (top of file) |
| Any doc | Issues / PRs | Full GitHub URL, e.g. `https://github.com/chriguschneider/weather-station-card/issues/15` |

Never use absolute URLs to files in this repo — relative paths survive forks.

## Length targets (the TL;DR enforcement)

These limits exist to prevent doc-bloat:

| File | Max lines | Why |
| --- | --- | --- |
| `README.md` | 300 | First impression. Anything more = users skim, miss the pitch |
| `docs/*.md` | 250 | Reference docs benefit from depth, but past 250 lines you stop scanning |

If a single section approaches ~150 lines, **split it** into a new doc rather
than extending the existing one. See "When to split" below.

## When to add a new doc vs. extend an existing one

| You're documenting… | Goes in… |
| --- | --- |
| Config keys / their effect | `docs/CONFIGURATION.md` |
| Single FAQ entry | `docs/TROUBLESHOOTING.md` |
| Sensor wiring recipe | `docs/SENSORS.md` |
| Classifier rule / threshold | `docs/CONDITIONS.md` |
| Migration footnote | `MIGRATION.md` |
| Architecture nuance | `ARCHITECTURE.md` |
| Build / test / release how-to | `CONTRIBUTING.md` / `TESTING.md` |
| Topic with its own audience and reference value beyond a single use case | **New file in `docs/`** |

When in doubt: extend, don't fragment.

## The TL;DR principle

The central rule: **every section must answer "what does the reader gain?"**

Decision algorithm before adding any new content:

1. Can I link to existing content instead of repeating? → **Link.**
2. Does the addition replace something redundant? → Add it, remove the redundancy.
3. Does it pass the cold-read test (a new reader skims the doc and the addition stands on its own)? → Add.
4. None of the above? → **Don't add.**

When asked to expand: ask "what becomes shorter?"

## Anchor naming

GitHub auto-generates anchors from headings: lowercase, spaces → hyphens, special
chars stripped. So `## A. Setup` becomes `#a-setup`.

Add a manual `<a id="..."></a>` only when:

- The same heading appears twice in a doc (anchors collide).
- A short, stable, externally-linkable anchor matters more than the heading text.

When manual: kebab-case, prefixed with the file context (`config-setup`, not bare
`setup`). Example pattern: `docs/CONFIGURATION.md` uses `#config-setup` etc.

## Versioning notes

Add `(since vX.Y)` inline after a key — only when:

- The key was added in **v1.0 or later**, AND
- A HACS user pinned to an older version might wonder why their YAML isn't recognised.

Don't retroactively annotate every key — it's noise. Removed keys live in
`MIGRATION.md`, not the reference.

Example:

```markdown
| `forecast.type` | `'daily' \| 'hourly' \| 'today'` | `'daily'` | … The `'today'` mode (since v1.4) renders a 24-hour window centred on "now". |
```

## Image conventions

| Type | Format | Source | Example |
| --- | --- | --- | --- |
| **Screenshots** of the rendered card | PNG via e2e baseline | `tests-e2e/snapshots/render-modes.spec.ts/*.png` | `daily-combination-sunshine.png` |
| Screenshots of the editor or non-rendered UI | PNG, hand-made | `images/` | `images/editor.png` |
| Diagrams, logo | SVG | `images/` | `images/logo.svg` |
| Animated hero (≤ 2 MB) | GIF | `images/` | (none currently) |

Prefer e2e snapshots over hand-made PNGs for any rendered-card screenshot —
they're auto-regenerated on every `update-baselines.yml` run, so the README
stays current without manual upkeep.

For light/dark adaptive rendering on GitHub:

```html
<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="tests-e2e/snapshots/render-modes.spec.ts/X-dark.png" />
  <img alt="Description" src="tests-e2e/snapshots/render-modes.spec.ts/X.png" />
</picture>
```

All images carry meaningful `alt` text.

### HACS sanitizer constraints

`README.md` is also rendered inside the HACS info panel, which
sanitises the markdown more aggressively than GitHub does. Two
patterns that work on GitHub but get dropped by HACS:

- **`<picture>` / `<source>` tags.** The sanitiser strips them, leaving
  only the `<img>` fallback. Use plain `<img>` in `README.md` even
  if it costs the light/dark adaptive rendering — the HACS info-panel
  reader is the lower-common-denominator audience.
- **Relative image paths.** Resolve from the GitHub URL, not the HACS
  install. Always use absolute
  `https://raw.githubusercontent.com/<owner>/<repo>/master/...` URLs
  for any image referenced from `README.md`.

Other docs (`docs/*.md`, `CONTRIBUTING.md`, etc.) are GitHub-only
and aren't affected — `<picture>` and relative paths are fine there.

## Card colour tokens

Single source of truth for the card's visual colours. Every concept
colour exposed to users via YAML is listed here together with where it
applies in the rendered card. When adding a new colourable concept,
extend this table first — that's how the `--warning-color`-as-sunshine
mistake (#121) gets prevented next time.

| Concept | YAML config key | Default value | Where it applies |
| --- | --- | --- | --- |
| **Sunshine** | `forecast.sunshine_color` | `rgba(255, 215, 0, 1.0)` (literal `#FFD700`) | Sunshine bar in the chart. |
| **Precipitation** | `forecast.precipitation_color` | `rgba(132, 209, 253, 1.0)` (literal light blue) | Precipitation bar in the chart. Forecast-side bars (combination mode) render at ~45 % alpha. |
| **Temperature — high** | `forecast.temperature1_color` | `rgba(255, 152, 0, 1.0)` (literal orange) | High-temperature curve and per-day high label. |
| **Temperature — low** | `forecast.temperature2_color` | `rgba(68, 115, 158, 1.0)` (literal dark blue) | Low-temperature curve and per-day low label. |

All four defaults are literal RGBA. Users can still pass their own
`var(--token, fallback)` in YAML for theme-driven colouring; the chart
resolver expands user input the same way it always did.

### Choosing a theme token for a new concept colour

If you wire a new default to `var(--some-token, fallback)`, the token's
*semantic meaning* in HA's standard themes has to match what the user
expects from the concept name. Two forms of the trap:

- **Name overlap, semantic mismatch.** `--warning-color` is the warning /
  alert colour (orange / red in default + Mushroom + Slate themes), not
  "warm yellow". `forecast.sunshine_color` defaulting to `--warning-color`
  rendered orange bars in real installs while looking yellow in
  Playwright (Chromium has no HA theme; the literal fallback ran).
- **Token defined but obscure.** If the token isn't in HA's default theme
  bundle (`frontend/src/resources/styles.ts`), every theme that doesn't
  define it falls through to the literal fallback. That's fine — but it
  means the `var(...)` wrapper buys nothing. Drop it and use the
  literal directly. The v1.9.0 defaults wired `--state-sensor-precipitation-color`
  and `--state-sensor-temperature-color` this way; both turned out to
  not exist in HA at all (verified via code search on
  home-assistant/frontend) and were dropped in the #121 follow-up.

Verify a candidate token by opening HA's `developer-tools/template` and
evaluating `{{ state_attr('frontend.styles', '--your-token') }}` against
your live theme — or just inspect `getComputedStyle(document.body)` in
the browser console.

### Test coverage

The Playwright e2e baselines run against Chromium with no HA theme
loaded, so theme-driven token resolution isn't exercised there. The
Vitest case in `tests/defaults-colours.test.js` simulates a hostile
theme (every "warning"-shaped token defined to orange) and asserts each
default still resolves to the right colour family — extend that file
when you add a new concept colour.

## CHANGELOG format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and SemVer.

### Audience

The CHANGELOG entry is **not** an engineering log. The release workflow
uploads it verbatim as the GitHub release body, and HACS shows that body
inside its in-app update dialog. The reader is a dashboard owner deciding
whether to click *Update* — not a future maintainer reading git history.
They don't know what ESLint, dependency-cruiser, or `vitest.config.js`
are, and they shouldn't have to.

Write for that reader. Plain user-perspective English, lead with what
the user gains or has to do (re-configure, clear cache, update YAML, …).

### Voice

- **Lead with impact, not mechanism.** "Hourly chart now scrolls smoothly
  on touch devices" is the headline; *how* it was achieved (rAF
  coalescing, label cache, …) is at most a parenthetical.
- **No tool names** unless directly relevant to the user. ESLint,
  dependency-cruiser, vitest, sonarjs, CodeQL, etc. belong in commit
  messages and PRs.
- **No file paths.** `src/main.ts`, `chart/styles.ts` are noise to the
  user.
- **No internal metrics.** Coverage percentages, lint-warning counts,
  threshold numbers, bundle-byte deltas — all internal.
- **No multi-paragraph rationale.** Link the issue / PR instead.

### Structure

```markdown
## [X.Y.Z] — YYYY-MM-DD

[1–2 sentences answering "what does this mean for me?" — what's new
or better, and whether the user needs to do anything. If there are
no user-facing changes, say exactly that in one plain sentence and
keep the rest of the entry short — don't pad with tooling detail.]

### Added
- [User-visible new capability, in their words.]
### Changed
- [User-visible behaviour difference. Mention the mechanism only if
  it helps the user understand a trade-off.]
### Fixed
- [What was broken from the user's perspective; what's fixed now.]
### Removed
- ...
### Deprecated
- ...
### Under the hood
- [Internal cleanup, build/CI work, refactors with zero user-facing
  effect. One short line each. If the whole release is internal,
  this is the only section after the lead.]
### Deferred to vX.Y+1
- ...
```

### The "would they click Update?" test

Before committing the entry, re-read it as a HACS user seeing it in the
update dialog with no other context. Can they tell whether the update
affects them and whether they need to do anything? If the answer is
"no, they'd just be confused by the jargon", rewrite.

Reference issues / PRs as `(#123)` or full URL on first mention.

## Migration entries

For each breaking change in `MIGRATION.md`:

```markdown
### `oldKey` → `newKey` (since vX.Y)

**Why**: [the constraint or motivation]

**Before**:
```yaml
oldKey: foo
```

**After**:
```yaml
newKey: bar
```
```

Always include *why* — the next person reading MIGRATION.md is figuring out
whether to roll forward or pin; they need the reasoning, not just the syntax.
