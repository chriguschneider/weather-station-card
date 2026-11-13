// dependency-cruiser config — added v1.4.2 (issue #19) for the
// architecture-rules-as-code phase. Catches:
//  - circular imports (impossible to bundle cleanly)
//  - module-boundary violations (e.g. chart/ pulling from main)
//  - orphans (files no entry path imports)
//
// Layered architecture for this card (top → bottom):
//   main.ts (LitElement glue, HA boundary)
//     ├─ editor/* (config UI)
//     ├─ chart/*  (uPlot orchestration)
//     ├─ data-source.ts, sunshine-source.ts, openmeteo-source.ts
//     ├─ scroll-ux.ts, action-handler.ts (DOM behaviour)
//     └─ utils/*, format-utils, forecast-utils, condition-classifier,
//        teardown-registry, locale, const (pure / leaf modules)

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular imports break tree-shaking and signal a missing abstraction. ' +
        'Extract the shared interface to a leaf module.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Files no entry path reaches are dead code. Either wire them in or ' +
        'delete them. Allow-list config / type-only files.',
      from: {
        orphan: true,
        pathNot: [
          '\\.(d|test|spec)\\.(js|ts)$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '\\.eslintrc',
          'tsconfig\\.json$',
          'eslint\\.config\\.(m?js|cjs)$',
          'vitest\\.config\\.(m?js|cjs)$',
          'rollup\\.config.*\\.(m?js|cjs)$',
          'playwright\\.config\\.(m?js|ts)$',
          '\\.dependency-cruiser\\.(js|cjs|mjs)$',
        ],
      },
      to: {},
    },
    {
      name: 'chart-no-uplevel',
      severity: 'error',
      comment:
        'src/chart/* must not import from main, editor, or sibling-only ' +
        'concerns like scroll-ux. The chart layer renders, the orchestrator ' +
        '(main.ts) wires data into it.',
      from: { path: '^src/chart/' },
      to: {
        path: ['^src/main\\.ts$', '^src/scroll-ux\\.ts$', '^src/editor/'],
      },
    },
    {
      name: 'editor-no-uplevel',
      severity: 'error',
      comment:
        'src/editor/* must not import from main or runtime concerns. The ' +
        'editor renders the config UI; main consumes the output via setConfig.',
      from: { path: ['^src/editor/', '^src/weather-station-card-editor\\.ts$'] },
      to: {
        path: ['^src/main\\.ts$', '^src/chart/', '^src/scroll-ux\\.ts$'],
      },
    },
    {
      name: 'domain-no-uplevel',
      severity: 'error',
      comment:
        'Top-level data/domain modules must not import main, chart/ or ' +
        'editor/. They feed the orchestrator, never the other way round.',
      from: {
        path: '^src/(data-source|openmeteo-source|sunshine-source|location|live-source|sources-popup)\\.ts$',
      },
      to: {
        path: ['^src/main\\.ts$', '^src/chart/', '^src/editor/', '^src/weather-station-card-editor\\.ts$'],
      },
    },
    {
      name: 'editor-dynamic-only',
      severity: 'error',
      comment:
        'ADR-0013: the editor is its own lazy chunk. main.ts must import it ' +
        'with a dynamic import() only, never statically.',
      from: { path: '^src/main\\.ts$' },
      to: {
        path: ['^src/editor/', '^src/weather-station-card-editor\\.ts$'],
        dependencyTypesNot: ['dynamic-import'],
      },
    },
    {
      name: 'utils-leaf',
      severity: 'error',
      comment:
        'src/utils/* are leaf modules. They must not import from any other ' +
        'src/ subtree.',
      from: { path: '^src/utils/' },
      to: { path: '^src/(?!utils/)' },
    },
    {
      name: 'no-deprecated-core',
      severity: 'warn',
      comment: 'Avoid Node core APIs flagged as deprecated.',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|playwright-report|test-results|tests-e2e/snapshots)(/|$)' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Track type-only imports so `import type { Foo } from './types.js'`
    // counts as a dependency. Without this, editor/types.ts shows up
    // as an orphan despite being referenced by every render-* module.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
