// ESLint 10 flat-config — re-activated in v1.4.2 after the v1.2 stub.
// Catches what tsc cannot: complexity, code smells, Lit-specific bugs,
// dead code. See issue #19 for context.
//
// Severity strategy: type-checked + sonarjs as ERROR (real bugs);
// complexity ceilings as WARN initially so legacy hot-spots don't block
// CI — promote to ERROR once the existing offenders are addressed.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import lit from 'eslint-plugin-lit';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'tests-e2e/snapshots/**',
    ],
  },

  // Base recommendations for all JS/TS.
  js.configs.recommended,

  // TypeScript sources — type-aware lint.
  {
    files: ['src/**/*.ts'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      lit.configs['flat/recommended'],
      sonarjs.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    rules: {
      // Complexity ceilings — warn so existing hot-spots don't fail CI.
      // Promote to error once src/main.ts and src/scroll-ux.ts are
      // refactored.
      complexity: ['warn', { max: 15 }],
      // max-depth promoted to error in v1.10 — zero current violations,
      // locks in flat control-flow style.
      'max-depth': ['error', 4],
      'max-lines-per-function': ['warn', { max: 100, skipComments: true, skipBlankLines: true }],
      'sonarjs/cognitive-complexity': ['warn', 15],

      // Lit framework correctness.
      'lit/no-invalid-html': 'error',
      'lit/no-legacy-template-syntax': 'error',
      'lit/no-template-bind': 'error',
      // Promoted to error in v1.10 — zero current violations.
      'lit/no-useless-template-literals': 'error',
      'lit/attribute-value-entities': 'error',

      // Pragmatic relaxations for this codebase.
      // main.ts has @ts-nocheck (HA integration boundary); type-checked
      // rules generate noise on `any`-flavoured HASS objects.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // unbound-method false-positives on Lit method.bind() patterns.
      '@typescript-eslint/unbound-method': 'off',
      // main.ts uses @ts-nocheck per architecture decision (HA boundary,
      // ~1500 LOC LitElement glue) — see file header. Allow with desc.
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-nocheck': false,
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': 'allow-with-description',
        minimumDescriptionLength: 10,
      }],
      // String unions like 'foo' | 'bar' | string serve as documentation
      // hints to consumers — keep them, even if structurally redundant.
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      // `void promise` is the canonical pattern to mark a promise as
      // intentionally not awaited; sonarjs flags it incorrectly.
      'sonarjs/void-use': 'off',
      // Defensive runtime null/undefined checks against narrowly-typed
      // values are often legitimate at HA/HASS boundaries — warn only.
      'sonarjs/different-types-comparison': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // sonarjs noise reduction — stylistic preferences. Warn so CI
      // doesn't block on legacy code; clean up incrementally.
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-nested-template-literals': 'off',
      'sonarjs/prefer-immediate-return': 'off',
      'sonarjs/no-small-switch': 'off',
      // Promoted to error in v1.10 — zero current violations.
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-ignored-exceptions': 'warn',
      'sonarjs/function-return-type': 'warn',
      'sonarjs/use-type-alias': 'warn',
      'sonarjs/no-redundant-boolean': 'warn',
      'sonarjs/no-redundant-assignments': 'warn',
      'sonarjs/no-dead-store': 'warn',
      'sonarjs/regex-complexity': 'warn',
      'no-useless-assignment': 'warn',

      // SonarCloud baseline cleanup (#39 / #36 triage).
      // - prefer-optional-chain: legacy `&&`-chains cleaned up in
      //   this sweep; promoted to error to lock in.
      // - prefer-readonly: zero violations after the sweep; error
      //   keeps it that way.
      // - no-useless-return: trailing useless returns gone; error
      //   prevents reintroduction.
      // - prefer-nullish-coalescing: legacy `||` defaults pruned in
      //   #31 for v1.6. `ignorePrimitives` keeps the rule pragmatic —
      //   number / string / boolean / bigint defaults where 0 / '' /
      //   false are semantically distinct from nullish stay as `||`.
      //   Severity is `warn` (not `error`) because the ~40 remaining
      //   non-primitive object / ternary cases need per-site review
      //   before promotion. New occurrences surface in PR diffs.
      // - no-nested-ternary: extraction is stylistic and manual.
      //   Warn so legacy nests don't fail CI; new ones surface in
      //   review.
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': ['warn', {
        ignorePrimitives: { boolean: true, string: true, number: true, bigint: true },
      }],
      '@typescript-eslint/prefer-readonly': 'error',
      'no-nested-ternary': 'warn',
      'no-useless-return': 'error',
    },
  },

  // E2E tests — Playwright + node, no type-aware lint (keep it light).
  {
    files: ['tests-e2e/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Unit tests — vitest in node.
  {
    files: ['tests/**/*.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },

  // ADR-0030: the page-wide zone is gone; each card passes its own
  // `Calendar`. Stops the removed singleton API from coming back.
  {
    files: ['src/**/*.ts', 'tests/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/time-zone', '**/time-zone.js'],
          importNames: ['setCardTimeZone', 'configuredTimeZone', 'cardTimeZone'],
          message: 'Removed in ADR-0030 — pass the card\'s Calendar instead.',
        }],
      }],
    },
  },

  // Build / config files — node CJS or ESM at root.
  {
    files: ['*.js', '*.cjs', '*.mjs', 'rollup.config*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
