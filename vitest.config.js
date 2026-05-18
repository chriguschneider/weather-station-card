// Unit tests for the data / format / classifier / chart-plugin layers.
// Lit DOM / chart orchestration / editor render paths covered by
// Playwright E2E (#14); see TESTING.md.
//
// Coverage thresholds gated in CI (npm run coverage in build.yml).
// Pre-v1.4.2 the include array listed .js paths after the v1.2 .ts
// migration; v8 matched zero files and the gate was silently inert.
// Paths are .ts now.
export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // uPlot reads window.matchMedia at module-load time for retina DPR
    // detection. jsdom doesn't ship a matchMedia stub by default, so
    // every test file that imports main.ts (which transitively imports
    // uPlot) blows up at import. setup.js provides a no-op stub.
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'lcov'],
      include: [
        'src/condition-classifier.ts',
        'src/data-source.ts',
        'src/format-utils.ts',
        'src/forecast-utils.ts',
        'src/sunshine-source.ts',
        'src/openmeteo-source.ts',
        // chart/plugins.ts is now a barrel re-export (#57); the
        // actual plugin code lives in chart/plugins/*.ts.
        'src/chart/plugins.ts',
        'src/chart/plugins/_shared.ts',
        'src/chart/plugins/separator.ts',
        'src/chart/plugins/daily-tick-labels.ts',
        'src/chart/plugins/precip-label.ts',
        'src/chart/plugins/sunshine-label.ts',
        'src/scroll-ux.ts',
        'src/action-handler.ts',
        'src/teardown-registry.ts',
        'src/utils/safe-query.ts',
        'src/utils/numeric.ts',
        'src/utils/unit-converters.ts',
        'src/precip-rate.ts',
        'src/pressure-trend.ts',
        'src/dew-point-comfort.ts',
        'src/sun-strength.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
};
