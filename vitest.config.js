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
        'src/config-validation.ts',
        'src/const.ts',
        'src/data-source.ts',
        'src/defaults.ts',
        'src/location.ts',
        'src/format-utils.ts',
        'src/forecast-utils.ts',
        'src/sunshine-source.ts',
        'src/openmeteo-source.ts',
        // chart/plugins.ts is now a barrel re-export (#57); the
        // actual plugin code lives in chart/plugins/*.ts.
        'src/chart/plugins.ts',
        'src/chart/sanitize.ts',
        'src/chart/plugins/_shared.ts',
        'src/chart/plugins/separator.ts',
        'src/chart/plugins/daily-tick-labels.ts',
        'src/chart/plugins/precip-label.ts',
        'src/chart/plugins/sunshine-label.ts',
        'src/chart/plugins/temp-labels.ts',
        'src/chart/skeleton.ts',
        'src/editor/render-location.ts',
        'src/editor/location-lookup.ts',
        'src/scroll-ux.ts',
        'src/action-handler.ts',
        'src/teardown-registry.ts',
        'src/utils/intl-cache.ts',
        'src/utils/resolve-css-var.ts',
        'src/utils/safe-query.ts',
        'src/utils/numeric.ts',
        'src/utils/theme-tokens.ts',
        'src/utils/unit-converters.ts',
        'src/utils/series-cache.ts',
        'src/utils/shared-requests.ts',
        'src/utils/availability-grace.ts',
        'src/utils/time-zone.ts',
        'src/precip-rate.ts',
        'src/pressure-trend.ts',
        'src/dew-point-comfort.ts',
        'src/sun-strength.ts',
        'src/moon.ts',
        'src/attributes-layout.ts',
        'src/next-rain.ts',
        'src/zero-degree-popup.ts',
        'src/zero-degree-trend.ts',
        'src/live-source.ts',
        'src/chart-legend.ts',
        'src/sources-popup.ts',
        'src/popup-shell.ts',
        'src/precip-probability.ts',
        'src/weather-code-map.ts',
        'src/editor/toggle-pills.ts',
        'src/editor/render-live-panel.ts',
        'src/editor/render-sensors.ts',
        'src/editor/section-keys.ts',
        'src/weather-station-card-editor.ts',
        // Live-panel row renderers split out of main.ts (#449).
        'src/live-panel/*.ts',
        // Forecast pipeline split out of main.ts (#450).
        'src/forecast-pipeline.ts',
        'src/past-source.ts',
        'src/card-config.ts',
        // Sensor extraction and slot matcher split out of main.ts (#451).
        'src/sensor-readings.ts',
        'src/sensor-match.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        // Per-file floors set just under what is reached (#412), so the
        // two data sources cannot slide back to the global 80.
        'src/data-source.ts': { statements: 96, branches: 88, functions: 98, lines: 97 },
        'src/openmeteo-source.ts': { statements: 98, branches: 96, functions: 100, lines: 99 },
        // show_sources modules (ADR-0031)
        'src/live-source.ts': { statements: 98, branches: 98, functions: 98, lines: 98 },
        'src/chart-legend.ts': { statements: 98, branches: 98, functions: 98, lines: 98 },
        // Sensor extraction and slot matcher (#451).
        'src/sensor-readings.ts': { statements: 98, branches: 95, functions: 98, lines: 98 },
        'src/sensor-match.ts': { statements: 98, branches: 95, functions: 98, lines: 98 },
        'src/sources-popup.ts': { statements: 95, branches: 75, functions: 98, lines: 98 },
        // Modules at (or near) 100 % that were not gated before (#456).
        'src/popup-shell.ts': { statements: 98, branches: 90, functions: 98, lines: 98 },
        'src/precip-probability.ts': { statements: 100, branches: 95, functions: 100, lines: 100 },
        'src/weather-code-map.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/editor/toggle-pills.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/editor/section-keys.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/utils/resolve-css-var.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        // Live-panel rows (#449), each file at or near 100 %.
        'src/live-panel/*.ts': { statements: 98, branches: 90, functions: 98, lines: 98 },
        // Low floors just under what is reached; they stop a slide, they
        // do not claim these files are well covered. main.ts has none: at
        // ~67 % it would pull the global 80 below the gate, and changing
        // that needs an ADR amendment (ADR-0029).
        'src/weather-station-card-editor.ts': { statements: 88, branches: 74, functions: 90, lines: 93 },
        'src/editor/render-live-panel.ts': { statements: 79, branches: 71, functions: 70, lines: 80 },
        'src/editor/render-sensors.ts': { statements: 76, branches: 79, functions: 66, lines: 79 },
      },
    },
  },
};
