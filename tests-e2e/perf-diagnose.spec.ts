// Perf diagnose — one-off deep-scan that captures CPU profile, JS
// coverage, heap counters, long-task and paint timings during a single
// mount of the card. NOT a regression gate, NOT routine CI.
//
// Skipped by default. To run:
//   PERF_DIAGNOSE=1 npx playwright test tests-e2e/perf-diagnose.spec.ts
// (PowerShell: $env:PERF_DIAGNOSE=1; npx playwright test ...)
//
// Outputs (test-results/):
//   perf-diagnose-profile.cpuprofile  — loadable in Chrome DevTools
//                                       Performance tab ("Load profile")
//   perf-diagnose-coverage.json       — per-script used/total bytes
//   perf-diagnose-metrics.json        — heap counters, long tasks,
//                                       paint entries, user marks/measures
//   perf-diagnose-summary.json        — human-readable top-N digest
//
// One mount per scenario × default-config; 5 iterations for the
// summary timing only (CPU profile + coverage taken on iteration 0
// to keep artefact sizes manageable).

import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

const GATE = process.env.PERF_DIAGNOSE === '1';

test.describe('perf-diagnose', () => {
  test.skip(!GATE, 'set PERF_DIAGNOSE=1 to run');
  test.describe.configure({ mode: 'serial' });

  test('mount: hourly-combination (CPU profile + coverage + metrics)', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);

    // Long-task observer must be installed before navigation so it
    // catches main-thread blocks during bundle parse + first mount.
    await page.addInitScript(() => {
      (window as unknown as { __perfDiag: unknown }).__perfDiag = {
        longTasks: [] as Array<{ name: string; startTime: number; duration: number }>,
        paint: [] as Array<{ name: string; startTime: number }>,
      };
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            (window as unknown as { __perfDiag: { longTasks: unknown[] } }).__perfDiag.longTasks.push({
              name: e.name,
              startTime: e.startTime,
              duration: e.duration,
            });
          }
        });
        obs.observe({ entryTypes: ['longtask'] });
      } catch {
        // longtask not supported in headless Chromium? leave list empty.
      }
      // Paint observer — captures first-paint and first-contentful-
      // paint as soon as Chromium emits them. addInitScript runs
      // before any document content, so the observer is installed
      // before either entry could fire. The existing
      // performance.getEntriesByType('paint') read in the spec
      // returned [] in headless mode; buffering them in an init-
      // script observer gives us the data the spec needs to compare
      // chrome-paint (skeleton + live-panel) against canvas-paint
      // (mount_ms).
      try {
        const paintObs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            (window as unknown as { __perfDiag: { paint: unknown[] } }).__perfDiag.paint.push({
              name: e.name,
              startTime: e.startTime,
            });
          }
        });
        paintObs.observe({ entryTypes: ['paint'], buffered: true });
      } catch {
        // paint timing not supported — leave empty.
      }
    });

    await openHarness(page, { theme: 'light' });

    // Start JS coverage AFTER harness page loaded — we want bundle
    // execution, not the harness HTML itself.
    await page.coverage.startJSCoverage({ resetOnNavigation: false });

    // CPU profile starts just before mount so the profile is dominated
    // by mount-time work (Lit setup, data-source first emit, Chart.js
    // constructor + first draw).
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');

    const config = {
      ...buildBaseConfig(),
      show_station: true,
      show_forecast: true,
      forecast: { type: 'hourly' as const, disable_animation: true },
    };
    const fixture = buildFullFixture();

    const t0 = await page.evaluate(() => performance.now());
    await mount(page, config, fixture, 'diag');
    const t1 = await page.evaluate(() => performance.now());

    // Stop profiler before any teardown.
    const profileResult = (await cdp.send('Profiler.stop')) as { profile: unknown };
    const coverage = await page.coverage.stopJSCoverage();

    // Heap + DOM counters via CDP — Performance.getMetrics returns a
    // flat name/value list.
    await cdp.send('Performance.enable');
    const metricsResult = (await cdp.send('Performance.getMetrics')) as {
      metrics: Array<{ name: string; value: number }>;
    };
    const counters: Record<string, number> = {};
    for (const m of metricsResult.metrics) counters[m.name] = m.value;

    // Per-script coverage attribution.
    const coverageSummary = coverage.map((c) => {
      const total = c.source ? c.source.length : 0;
      let used = 0;
      for (const r of c.functions) {
        for (const range of r.ranges) {
          if (range.count > 0) used += range.endOffset - range.startOffset;
        }
      }
      return {
        url: c.url,
        totalBytes: total,
        usedBytes: used,
        unusedBytes: Math.max(0, total - used),
        pctUsed: total ? Math.round((used / total) * 1000) / 10 : 0,
      };
    });

    // Browser-side perf entries — paint, user marks, user measures.
    const perfEntries = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      out.paint = performance.getEntriesByType('paint').map((e) => ({
        name: e.name,
        startTime: e.startTime,
      }));
      out.marks = performance.getEntriesByType('mark').map((e) => ({
        name: e.name,
        startTime: e.startTime,
      }));
      out.measures = performance.getEntriesByType('measure').map((e) => ({
        name: e.name,
        startTime: e.startTime,
        duration: e.duration,
      }));
      out.longTasks =
        (window as unknown as { __perfDiag?: { longTasks: unknown[] } }).__perfDiag
          ?.longTasks || [];
      // Prefer the addInitScript-buffered paint observer over the
      // direct getEntriesByType call (which returned empty in
      // headless Chromium). If both have entries, the buffered one
      // wins because it's guaranteed to have caught the events.
      const bufferedPaint =
        (window as unknown as { __perfDiag?: { paint: unknown[] } }).__perfDiag?.paint;
      if (Array.isArray(bufferedPaint) && bufferedPaint.length > 0) {
        out.paint = bufferedPaint;
      }
      return out;
    });

    const out = 'test-results';
    mkdirSync(out, { recursive: true });

    writeFileSync(`${out}/perf-diagnose-profile.cpuprofile`, JSON.stringify(profileResult.profile));
    writeFileSync(
      `${out}/perf-diagnose-coverage.json`,
      JSON.stringify(coverageSummary, null, 2),
    );
    writeFileSync(
      `${out}/perf-diagnose-metrics.json`,
      JSON.stringify({ counters, perfEntries }, null, 2),
    );

    // Hot-function digest from the CPU profile. The V8 profile is a
    // sampled call tree — we aggregate self-time by node ID for a
    // quick "top callees" list. Real flame-graph analysis happens in
    // DevTools after loading the .cpuprofile.
    const profile = profileResult.profile as {
      nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number; children?: number[] }>;
      samples?: number[];
      timeDeltas?: number[];
    };
    const selfTimeByNode = new Map<number, number>();
    if (profile.samples && profile.timeDeltas) {
      for (let i = 0; i < profile.samples.length; i++) {
        const nodeId = profile.samples[i];
        const dt = profile.timeDeltas[i] || 0;
        selfTimeByNode.set(nodeId, (selfTimeByNode.get(nodeId) || 0) + dt);
      }
    }
    const nodeMap = new Map(profile.nodes.map((n) => [n.id, n]));
    const hot = [...selfTimeByNode.entries()]
      .map(([id, t]) => {
        const n = nodeMap.get(id);
        const fn = n?.callFrame.functionName || '(anonymous)';
        const url = n?.callFrame.url || '';
        const line = n?.callFrame.lineNumber ?? -1;
        return { selfTimeUs: t, fn, url, line };
      })
      .sort((a, b) => b.selfTimeUs - a.selfTimeUs)
      .slice(0, 30);

    let totalProfileUs = 0;
    for (const v of selfTimeByNode.values()) totalProfileUs += v;

    const summary = {
      scenario: 'hourly-combination',
      mountToRendered_ms: Math.round((t1 - t0) * 100) / 100,
      heap_jsHeapUsedSize_MB: counters.JSHeapUsedSize
        ? Math.round((counters.JSHeapUsedSize / (1024 * 1024)) * 100) / 100
        : null,
      heap_jsHeapTotalSize_MB: counters.JSHeapTotalSize
        ? Math.round((counters.JSHeapTotalSize / (1024 * 1024)) * 100) / 100
        : null,
      nodes_count: counters.Nodes || null,
      js_listeners_count: counters.JSEventListeners || null,
      documents_count: counters.Documents || null,
      paint_entries: perfEntries.paint,
      long_task_count: Array.isArray(perfEntries.longTasks) ? perfEntries.longTasks.length : 0,
      long_task_total_ms: Array.isArray(perfEntries.longTasks)
        ? Math.round(
            (perfEntries.longTasks as Array<{ duration: number }>).reduce(
              (s, e) => s + (e.duration || 0),
              0,
            ) * 100,
          ) / 100
        : 0,
      profile_total_us: totalProfileUs,
      top_hot_functions: hot,
      coverage_total_bytes: coverageSummary.reduce((s, c) => s + c.totalBytes, 0),
      coverage_used_bytes: coverageSummary.reduce((s, c) => s + c.usedBytes, 0),
      coverage_pct_used: (() => {
        const t = coverageSummary.reduce((s, c) => s + c.totalBytes, 0);
        const u = coverageSummary.reduce((s, c) => s + c.usedBytes, 0);
        return t ? Math.round((u / t) * 1000) / 10 : 0;
      })(),
    };

    writeFileSync(
      `${out}/perf-diagnose-summary.json`,
      JSON.stringify(summary, null, 2),
    );

    // Pick out first-paint (FP) and first-contentful-paint (FCP)
    // for the console line — these are the "card chrome visible"
    // markers, distinct from mountToRendered_ms which waits for the
    // chart canvas.
    const fp = (summary.paint_entries as Array<{ name: string; startTime: number }>)
      .find((e) => e.name === 'first-paint');
    const fcp = (summary.paint_entries as Array<{ name: string; startTime: number }>)
      .find((e) => e.name === 'first-contentful-paint');

    console.log('[perf-diagnose] mount_ms=', summary.mountToRendered_ms,
      'fp_ms=', fp ? Math.round(fp.startTime) : null,
      'fcp_ms=', fcp ? Math.round(fcp.startTime) : null,
      'heap_used_MB=', summary.heap_jsHeapUsedSize_MB,
      'nodes=', summary.nodes_count,
      'coverage_used_pct=', summary.coverage_pct_used,
      'longtasks=', summary.long_task_count);

    await unmountAll(page);

    expect(summary.mountToRendered_ms).toBeGreaterThan(0);
  });
});
