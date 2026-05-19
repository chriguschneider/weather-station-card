import { defineConfig, devices } from '@playwright/test';

// Playwright config for the weather-station-card E2E + visual-regression
// suite. Tests live under tests-e2e/ and load the bundled card via a
// minimal HTML harness (tests-e2e/pages/card.html). No real Home
// Assistant connection — `tests-e2e/hass-mock.ts` stands in for the
// `hass` object the card consumes.
//
// One project (chromium) is enough for the v1.3 deliverable: HA
// frontend itself targets Chromium-class browsers, and visual-
// regression baselines tied to a single rendering engine sidestep
// font-hinting drift that would otherwise plague cross-browser
// snapshots.

export default defineConfig({
  testDir: './tests-e2e',
  // Visual regression baselines live next to each spec under
  // tests-e2e/<spec>.spec.ts-snapshots/. Pinning the path keeps
  // baselines stable when specs are renamed.
  snapshotPathTemplate: '{testDir}/snapshots/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local: 1 retry catches the rare flake on slow disk; CI: 2 because
  // GHA shared runners have noisier I/O.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    // Always capture trace on first retry — the trace viewer is the
    // fastest way to debug a Lit / Chart.js render race.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Visual regression tolerance:
  //   - Baselines are generated on the actual GHA ubuntu-latest
  //     runner (via .github/workflows/update-baselines.yml,
  //     dispatched manually) so the comparison environment matches
  //     the assertion environment exactly. With both renders coming
  //     from the same image, observed diff is well under 0.2 %
  //     (sub-pixel anti-aliasing on chart line strokes only).
  //   - 0.2 % catches a missing dataset, wrong colour, layout shift,
  //     or any deliberate UI change that needs a fresh baseline.
  //   - threshold 0.2 is the per-pixel colour-distance default.
  //
  // Local iteration in WSL: the same threshold may report ~1–4 %
  // diff against the committed (GHA-generated) baselines because
  // WSL2's GPU virtualization renders subpixel hinting differently.
  // For UI changes, dispatch the update-baselines workflow on a
  // branch and review the bot's commit — never commit
  // WSL-generated baselines to master.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
      // Animations (the 500 ms easeOutQuart on temperature lines) are
      // disabled per-test by toggling forecast.disable_animation in
      // the card config — see tests-e2e/_helpers.ts. This keeps the
      // toHaveScreenshot timing deterministic.
    },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      // Scope: every spec EXCEPT the mobile lane's. Without this, the
      // chromium project would also pick up the mobile-* specs and run
      // them at Desktop DPR=1, which defeats the point of the lane.
      testIgnore: /mobile-.*\.spec\.ts/,
    },
    {
      // Mobile-emulation lane (Stufe 3a per the perf-pass discussion).
      // Pixel 7 device profile gives viewport 412x915 + DPR 2.625 +
      // mobile user-agent + touch events — a realistic Android
      // Companion App proxy with current-generation hardware. Catches
      // DPR-class bugs (the canvas overflow + plugin coordinate
      // mismatch we found in fix(chart) PR #176) that DPR=1
      // environments hide.
      // Scope is intentionally narrow: only assertion-based specs
      // tagged with the `mobile-` filename prefix. Visual baselines
      // stay on the chromium lane to keep snapshot review tractable
      // and avoid doubling the baseline matrix.
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
      },
      testMatch: /mobile-.*\.spec\.ts/,
    },
  ],

  webServer: {
    // Static-serve the repo root so /dist/weather-station-card.js and
    // /tests-e2e/pages/card.html are reachable. Reuses an existing
    // server when one is already running (developer iteration).
    command: 'npx http-server -p 5173 -c-1 --silent .',
    url: 'http://localhost:5173/tests-e2e/pages/card.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
