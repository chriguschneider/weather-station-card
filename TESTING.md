# Testing

Two test layers run on every commit:

| Layer | Tool | Scope |
|---|---|---|
| **Unit** (`tests/`) | Vitest | Pure modules — classifier, data sources, chart plugins, format/forecast utils, sunshine helpers, editor partial smoketests. 15 spec files, 469 tests. |
| **E2E + visual regression** (`tests-e2e/`) | Playwright | The bundled card boots in a static-served harness with a fake-hass mock. Covers render modes (visual baselines), pointer interactions, mode toggle, jump-to-now, editor mutators, editor visual regression. 6 specs across `tests-e2e/snapshots/` directories. |

Both layers run in CI before bundle verification. A failure in either
blocks the release pipeline.

## Run

```bash
# Unit
npm test                    # one-shot, used by CI (runner's zone, UTC in CI)
npm run test:tz             # time-zone-sensitive specs under UTC, Zurich, Denver
npm run test:watch          # live-reload while writing tests
npm run coverage            # vitest run --coverage with v8 provider

# E2E
npm run test:e2e            # full suite, headless
npm run test:e2e:update     # regenerate visual baselines after a
                            # deliberate UI change
```

`npm run build` chains: typecheck → unit → rollup. The E2E suite is
**not** chained into `build` (it needs the bundle to already be on
disk and Playwright's Chromium). CI runs them sequentially —
typecheck → unit → coverage → bundle → e2e.

## Coverage gate

CI fails the build if any of statements / branches / functions /
lines drops below **80 %** for the modules listed in
`vitest.config.js`. Editor + main.ts are out of unit-coverage scope
(rendering paths are exercised by Playwright instead).

Real coverage as of v1.9.x: 93.3 % statements, 83.9 % branches,
91.1 % functions, 95.7 % lines (run `npm run coverage` for the live
numbers). `scroll-ux.ts` and `data-source.ts` are the lowest-coverage
modules; the global aggregate sits comfortably above the 80 % gate.

> **History note**: pre-v1.4.2 the `include` array in
> `vitest.config.js` listed `.js` paths after the v1.2 TypeScript
> migration. The v8 coverage provider matched zero files and the
> gate was silently inert (`Statements 0/0 (Unknown%)`). Fixed in
> v1.4.2 — see issue #19.

## Unit-test layout

```
tests/
  action-handler.test.js
  condition-classifier.test.js
  data-source.test.js
  defaults.test.js
  editor.test.js
  editor-render-chart.test.js          ← v1.9.x partial smoketest
  editor-render-live-panel.test.js     ← v1.9.x partial smoketest
  forecast-utils.test.js
  format-utils.test.js
  openmeteo-source.test.js
  plugins.test.js
  scroll-ux.test.js
  sunshine-source.test.js
  teardown-registry.test.js
  utils.test.js
```

Tests are `.test.js` (vitest's `include` pattern) but import from `.ts`
sources via the standard TS-resolved import. No fixtures directory yet
— small test data is inlined. Promote to `tests/fixtures/*.ts` if a
payload grows past ~50 lines.

The two `editor-render-*.test.js` files are jsdom-environment Lit-render
smoketests (since v1.9.x): instantiate a mock `EditorLike` +
`EditorContext`, render the partial via Lit's `render(template,
container)`, then assert section headings, sub-section structure, and
gating by `hasSensor` / `hasLiveValue` / master toggles. Editor *full-
page* render and live-preview interactions are still Playwright's job.

## E2E layout

```
tests-e2e/
  pages/
    card.html           harness page, served at http://localhost:5173
    hass-mock.js        browser-side fake-hass implementation
  fixtures/
    generate.ts         deterministic fixture generators (recorder
                        stats, forecasts, hass states)
  snapshots/
    render-modes.spec.ts/
      daily-station.png
      daily-forecast.png
      ...
    editor-visual.spec.ts/
      editor.png
      editor-dark.png
    styles-grid.spec.ts/
      ...
  hass-mock.types.ts    type definitions for the mock contract
  _helpers.ts           openHarness, mount, settle, unmountAll
  render-modes.spec.ts          visual baselines across the render modes
  scroll-and-actions.spec.ts    drag, indicator chevrons, tap suppression
  mode-toggle-jump-to-now.spec.ts  daily↔hourly toggle, jump-to-now
  editor.spec.ts                editor mutator contracts
  editor-visual.spec.ts         editor light + dark visual baselines
  styles-grid.spec.ts           per-mode styles matrix grid
  tsconfig.json         extends ../tsconfig.json with rootDir = ..
```

The harness page (`pages/card.html`) loads the bundled card from
`/dist/weather-station-card.js` and a small mock from
`pages/hass-mock.js`. Specs call `mount(page, config, fixture)` to
insert a card with a fixture-backed hass; `settle(page)` waits for
the chart canvas to commit; `unmountAll(page)` resets between tests.

### Fake-hass contract

`hass-mock.js` answers exactly the WebSocket message types and
service-call shapes the card touches:

- `callWS({ type: 'recorder/statistics_during_period' })` → returns
  `recorderDaily` or `recorderHourly` from the fixture by `period`.
- `connection.subscribeMessage({ type: 'weather/subscribe_forecast' })`
  → emits the matching `forecastDaily` / `forecastHourly` array
  synchronously, returns a no-op unsubscribe.
- `callService(domain, service, data, target)` → logged on
  `hass.__serviceCalls` so a spec can assert what was fired.

Unrecognised message types `throw` so a typo in a future spec or
in card code surfaces as a hard failure rather than a silent miss.

## Visual baselines

Per spec, baselines live under
`tests-e2e/snapshots/<spec>.spec.ts/<name>.png`. Tolerance is
configured in `playwright.config.ts`:

- `maxDiffPixelRatio: 0.002` — 0.2 % of the viewport (~1 800 px out
  of ~921 600 at 1280×720) absorbs sub-pixel anti-aliasing drift on
  chart line strokes between headed/headless without masking real
  regressions like a missing dataset or a colour change.
- `threshold: 0.2` — Playwright's per-pixel default colour distance.

Animations are disabled per-test by setting
`forecast.disable_animation: true` in the fixture base config so the
500 ms easeOutQuart on the temperature line doesn't make the
screenshot timing race-prone.

<a id="updating-visual-baselines"></a>
### Updating baselines after a deliberate UI change

Visual baselines are pinned to the GitHub Actions `ubuntu-latest`
runner (see [ADR-0003](docs/adr/0003-e2e-baselines-pinned-to-gha.md)).
The comparison environment matches the assertion environment exactly,
which is what lets the Playwright tolerance sit at 0.2 % — tight
enough to catch subtle regressions like 1-px text shifts. The flip
side is that **locally-generated PNGs diff 1–4 % against the GHA
images** and must not be committed.

The supported regen path is the
[`update-baselines.yml`](.github/workflows/update-baselines.yml)
workflow:

```bash
gh workflow run update-baselines.yml --ref <your-feature-branch>
gh run list --workflow update-baselines.yml \
  --event workflow_dispatch --limit 1
gh run watch <run-id> --exit-status
```

The bot pushes a `chore: update e2e baselines from CI` commit on top
of the dispatched branch with the regenerated PNGs. Pull, review the
diff, merge through the normal PR flow.

> **Branch protection note.** The bot can push to feature branches
> but not directly to `master` (which is branch-protected). If you
> need master baselines refreshed, dispatch on a feature branch and
> open a PR; the bot writes there, the PR carries it through.

Always include the *why* in the commit / PR body — a baseline change
is a visual contract change, and reviewers can't tell from the .png
alone whether the diff is intended.

## What to add when

- New classifier rule or threshold → extend
  `condition-classifier.test.ts` with both a positive and a "just
  below the threshold" negative case.
- New sensor-driven field in `_buildForecast` → assert it surfaces
  in `entry` in the canonical-shape test.
- New render mode (e.g. compact, panel) → add a
  `render-modes.spec.ts` row + a fresh baseline.
- New pointer interaction (e.g. double-tap zooms) → cover the
  on-drag suppression path in `scroll-and-actions.spec.ts`.
- New editor mutator → assert that calling it dispatches a
  `config-changed` event with the expected delta in `editor.test.js`
  (Vitest, jsdom mutator-shape coverage).
- New editor partial / sub-section → extend the smoketest in
  `tests/editor-render-<partial>.test.js`: assert section heading,
  sub-section headings, and gating around any new toggle.

## What is intentionally not tested

- **Chart.js internal layout.** The visual baselines cover the
  outcome; mocking Chart.js's internal APIs adds setup without
  payoff.
- **Real Home Assistant frontend.** Specs run against the mock; HA
  integration is verified manually against a real HA instance — see
  [LOCAL-TESTING.md](LOCAL-TESTING.md) for the Docker recipe that
  doesn't depend on any maintainer-specific setup.
- **Cross-browser visual regression.** One project (Chromium) is
  sufficient: HA frontend itself targets Chromium-class browsers,
  and baselines pinned to a single rendering engine sidestep
  font-hinting drift across engines.

## Debugging a failing E2E spec

- `npx playwright test --headed --workers=1 -g "<spec name>"` —
  run a single spec headed so you can watch the harness live.
- `npx playwright show-trace test-results/<spec-folder>/trace.zip` —
  step through a recorded run after the fact.
- `playwright-report/index.html` — opens the HTML reporter with
  per-spec screenshot diffs (in CI, this is uploaded as the
  `playwright-report` artifact when the suite fails).
