import resolve from 'rollup-plugin-node-resolve';
import serve from 'rollup-plugin-serve';
import copy from 'rollup-plugin-copy';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const dev = process.env.ROLLUP_WATCH;
// Bundle-attribution mode: emits sourcemap + visualizer treemap/raw-data
// into test-results/ for a one-off analysis run. Off by default — keeps
// prod build fast and ships no sourcemap. Toggle with:
//   BUNDLE_ANALYZE=1 npm run rollup
// (PowerShell: $env:BUNDLE_ANALYZE=1; npm run rollup)
const analyze = process.env.BUNDLE_ANALYZE === '1';

// Inline plugin: substitutes the literal '__CARD_VERSION__' in main.ts
// with the package.json version at build time. Avoids the manual
// release-time bump dance for the console banner — package.json is the
// single source of truth. Tests run on the unsubstituted source where
// the banner reads "v__CARD_VERSION__"; harmless because no test
// inspects that string.
const injectCardVersion = {
  name: 'inject-card-version',
  transform(code, id) {
    if (!id.endsWith('main.ts')) return null;
    const replaced = code.replaceAll("'__CARD_VERSION__'", JSON.stringify(pkg.version));
    return replaced === code ? null : { code: replaced, map: null };
  },
};

const serveopts = {
  contentBase: ['./dist'],
  host: '0.0.0.0',
  port: 5000,
  allowCrossOrigin: true,
  headers: {
    'Access-Control-Allow-Origin': '*',
  },
};

export default {
  input: 'src/main.ts',
  output: {
    dir: 'dist',
    format: 'es',
    // Entry filename pinned so HACS' Lovelace-resource registration
    // (`weather-station-card.js`) keeps working unchanged. Dynamic
    // imports produce additional chunk files with content-hashed
    // names so the browser caches them forever (HACS only appends
    // `?hacstag=` to the registered entry — chunk freshness is the
    // hash's job).
    entryFileNames: 'weather-station-card.js',
    chunkFileNames: '[name]-[hash].js',
    sourcemap: (dev || analyze) ? true : false,
  },
  // HA registers our entry as `type: module` (verified via
  // `.storage/lovelace_resources`), so ESM output + dynamic `import()`
  // both work natively. The single-entry, multi-chunk shape with
  // hashed chunk names is the same recipe advanced-camera-card uses
  // in production.
  //
  // `preserveEntrySignatures: 'strict'` is load-bearing — without it,
  // rollup lets the editor chunk re-import shared code from the
  // entry file (`weather-station-card.js`). HACS appends `?hacstag=`
  // only to the registered entry URL, not to relative chunk imports,
  // so the browser ends up with TWO copies of the entry under
  // different URLs (with and without the query string). The second
  // copy re-executes the top-level `customElements.define` call and
  // throws ("already registered"). `strict` forces rollup to extract
  // the shared code into its own content-hashed chunk and turn the
  // entry into a thin facade, so chunks never re-import the entry
  // and the hacstag mismatch never happens.
  preserveEntrySignatures: 'strict',
  plugins: [
    // Version-string substitution runs before TS so the placeholder
    // disappears before any downstream pass sees it. Idempotent — only
    // touches main.ts, only matches the exact placeholder literal.
    injectCardVersion,
    // TypeScript first so it sees raw .ts/.tsx and emits ESM JS for
    // the rest of the pipeline. allowJs=true (in tsconfig) lets us
    // migrate one file at a time during v1.2 — .js files pass through
    // unchanged. noEmitOnError stays false so a type error is a CI
    // signal but doesn't stall a local watch build.
    typescript({
      tsconfig: './tsconfig.json',
      noEmitOnError: false,
      // Rollup emits the bundle; we only want type checking + transpile
      // here, no separate .d.ts output.
      compilerOptions: {
        noEmit: false,
        declaration: false,
        sourceMap: (dev || analyze) ? true : false,
      },
    }),
    resolve(),
    dev && serve(serveopts),
    copy({
      targets: [
        { src: 'src/icons/*', dest: 'dist/icons' },
      ]
    }),
    // Production minification (skipped in dev/watch so source maps stay
    // readable). Drops bundle from ~800 KB unminified to ~250-300 KB —
    // halves bytes-on-the-wire even after HA's gzip layer. Class names
    // preserved so HA's "Add card from Lovelace UI" finds the custom
    // element registration; function names are mangled.
    !dev && terser({
      format: { comments: false },
      compress: { passes: 2 },
      mangle: { keep_classnames: true, keep_fnames: false },
    }),
    // Bundle-attribution treemap + raw JSON, emitted only when
    // BUNDLE_ANALYZE=1. The treemap is interactive HTML; the raw JSON
    // is fed into test-results/_analyze-bundle.cjs (or any future
    // tooling) for module-size aggregation.
    analyze && visualizer({
      filename: 'test-results/bundle-stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: false,
      sourcemap: true,
      emitFile: false,
    }),
    analyze && visualizer({
      filename: 'test-results/bundle-stats.json',
      template: 'raw-data',
      gzipSize: true,
      brotliSize: false,
      sourcemap: true,
      emitFile: false,
    }),
  ].filter(Boolean),
};
