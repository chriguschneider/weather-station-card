// uPlot instance builder. Replaces the previous Chart.js builder
// (slice 2 of the 2026-05 perf stack — see ADR-0012). uPlot is ~50 KB
// vs Chart.js's ~130 KB + plugins; the swap drops ~100 KB raw / ~30 KB
// gzipped from the bundle, and uPlot's V8 parse cost on cold mount is
// proportionally smaller.
//
// The card's plugin contract is preserved: plugins still consume a
// chart.js-shaped `ChartLike` object (scales.x.getPixelForTick, ctx,
// chartArea, getDatasetMeta). uPlot has no notion of any of that
// directly — at draw time we build a thin shim from the uPlot
// instance and run each plugin against it. Keeping the contract
// stable means the four plugins (separator, daily-tick-labels,
// precip-label, sunshine-label) and their unit tests carry over
// unchanged. The shim cost is ~one object per plugin per frame, which
// is dwarfed by the actual canvas drawing.
//
// uPlot's x-axis is numeric; the card's data is positional (each
// dataset element corresponds to one bucket). We use synthetic
// indices 0..N-1 for the x-scale so the alignment matches the old
// CategoryScale, and `axes[0].values` looks up the per-tick label
// from `data.dateTime` via the indexed callback.

import uPlot from 'uplot';
import type { ChartBarLike, ChartLike, ChartPlugin, ChartScaleLike, CssStyleLike, PluginCardConfig, PluginRenderData } from './plugins.js';

export interface BuildChartOpts {
  datasets: ReadonlyArray<{
    label: unknown;
    type: 'line' | 'bar';
    data: ReadonlyArray<number | null | undefined>;
    yAxisID: string;
    borderColor: string | ReadonlyArray<string>;
    backgroundColor: string | ReadonlyArray<string>;
    barPercentage?: number;
    segment?: unknown;
    hidden?: boolean;
  }>;
  plugins: ReadonlyArray<ChartPlugin>;
  data: PluginRenderData & {
    tempHigh: ReadonlyArray<number | null | undefined>;
    tempLow: ReadonlyArray<number | null | undefined>;
  };
  config: PluginCardConfig & { use_12hour_format?: boolean };
  textColor: string;
  backgroundColor: string;
  dividerColor: string;
  chartTextColor?: string;
  precipMax: number;
  precipUnit: string;
  tempUnit: string;
  doubledToday: boolean;
  stationCount: number;
  style: CssStyleLike;
  sunshineLabelBand: number;
  /** Chart-container height in CSS pixels (from `config.forecast.chart_height`).
   *  Passed in explicitly because the chart-container's CSS height is set
   *  inline at render time, but the inner `<div id="forecastChart">`
   *  target may not have its computed CSS resolved at uPlot construction
   *  time (Lit just committed the template; layout may still be settling).
   *  uPlot needs an explicit numeric height up-front. */
  chartHeight: number;
  inPreview?: boolean;
}

/** Public surface mirroring Chart.js's instance API the rest of the
 *  card touches: `data.datasets`/`data.labels` for in-place updates
 *  from main.ts, `update`/`reset`/`destroy`/`resize`/`draw` lifecycle
 *  hooks for scroll-ux and the orchestrator. */
export interface UplotChart {
  readonly uplot: uPlot;
  data: {
    labels: ReadonlyArray<string | undefined>;
    datasets: Array<{
      data: ReadonlyArray<number | null | undefined>;
      backgroundColor?: string | ReadonlyArray<string>;
      borderColor?: string | ReadonlyArray<string>;
      hidden?: boolean;
    }>;
  };
  update(): void;
  reset(): void;
  destroy(): void;
  resize(width?: number, height?: number): void;
  draw(): void;
}

type AlignedData = [Array<number>, ...Array<Array<number | null | undefined>>];

/** Convert dataset bag into a uPlot AlignedData tuple. Index 0 is the
 *  x-axis (synthetic 0..N-1 indices); subsequent arrays are the y
 *  values per series in the order they appear in `datasets`. */
function toAlignedData(
  labels: ReadonlyArray<string | undefined>,
  datasets: ReadonlyArray<{ data: ReadonlyArray<number | null | undefined> }>,
): AlignedData {
  const n = labels.length;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) xs[i] = i;
  const ys = datasets.map((ds) => ds.data.slice() as Array<number | null | undefined>);
  return [xs, ...ys] as AlignedData;
}

/** Build the `series` array uPlot consumes. Bar series get a custom
 *  paths factory so per-bar fill/stroke arrays apply (uPlot's stock
 *  bars factory expects single fill/stroke; we route through `disp`).
 *  Line series use the spline path renderer to match the smoothing
 *  the old Chart.js setup used (`tension: 0.3`).
 *
 *  Multi-bar grouping: chart.js auto-grouped multiple bar datasets
 *  side-by-side within a column slot. uPlot has no equivalent — all
 *  bar series default to centered on the x value, so two datasets
 *  overlap. We replicate the side-by-side look by alternating
 *  `align: -1` (left half of slot) for the first bar series and
 *  `align: 1` (right half) for the second, with `size: [0.5]` each.
 *  Single-bar charts keep their full `barPercentage` width centered. */
function buildSeries(
  datasets: BuildChartOpts['datasets'],
  textColor: string,
): uPlot.Series[] {
  const series: uPlot.Series[] = [{}]; // index 0 = x

  const barCount = datasets.filter((d) => d.type === 'bar').length;
  let barIdx = 0;

  for (const ds of datasets) {
    if (ds.type === 'line') {
      const stroke = typeof ds.borderColor === 'string' ? ds.borderColor : textColor;
      series.push({
        label: String(ds.label ?? ''),
        scale: ds.yAxisID,
        show: !ds.hidden,
        stroke,
        width: 1.5,
        paths: (uPlot.paths.spline as () => uPlot.Series.PathBuilder)?.() ?? null,
        points: { show: false },
        spanGaps: false,
      });
    } else {
      const fillArr = Array.isArray(ds.backgroundColor) ? ds.backgroundColor : null;
      const strokeArr = Array.isArray(ds.borderColor) ? ds.borderColor : null;
      const singleFill = typeof ds.backgroundColor === 'string' ? ds.backgroundColor : textColor;
      const singleStroke = typeof ds.borderColor === 'string' ? ds.borderColor : singleFill;
      // When grouping multiple bar series side-by-side, each gets a
      // 35%-of-slot sub-slot share (precip on left, sunshine on
      // right) so the pair fits inside the column with breathing
      // room around them — matches the Chart.js baseline (precip
      // ~25 %, sunshine ~35 % of column, leaving small gaps at the
      // slot edges and a small gap at the column centre between
      // them).
      //
      // Standalone (no sunshine) bars use the full barPercentage of
      // the slot directly, centered.
      const grouped = barCount > 1;
      const rawPct = typeof ds.barPercentage === 'number' ? ds.barPercentage : 0.8;
      // Grouped: each bar caps at ~25 % of the column slot so the
      // pair leaves visible gap on both sides AND between them —
      // matches the Chart.js baseline (precip_bar_size default is
      // 100 → barPercentage 1.0; without scaling the bars would fill
      // their entire half-slot with no breathing room).
      const sizeFactor = grouped ? Math.min(rawPct, 1) * 0.25 : rawPct;
      const align: -1 | 0 | 1 = grouped ? (barIdx === 0 ? -1 : 1) : 0;
      const barsFactory = uPlot.paths.bars as uPlot.Series.BarsPathBuilderFactory;
      const barOpts: uPlot.Series.BarsPathBuilderOpts = {
        size: [sizeFactor, Infinity, 1],
        gap: 0,
        align,
      };
      if (fillArr || strokeArr) {
        barOpts.disp = {
          fill: {
            unit: 3,
            values: (_u: uPlot, _si: number, i0: number, i1: number) => {
              const out: string[] = [];
              for (let i = i0; i <= i1; i++) out.push(fillArr?.[i] ?? singleFill);
              return out;
            },
          },
          stroke: {
            unit: 3,
            values: (_u: uPlot, _si: number, i0: number, i1: number) => {
              const out: string[] = [];
              for (let i = i0; i <= i1; i++) out.push(strokeArr?.[i] ?? singleStroke);
              return out;
            },
          },
        };
      }
      series.push({
        label: String(ds.label ?? ''),
        scale: ds.yAxisID,
        show: !ds.hidden,
        stroke: singleStroke,
        fill: singleFill,
        width: 0,
        paths: barsFactory(barOpts),
        points: { show: false },
      });
      barIdx++;
    }
  }
  return series;
}

/** Y-scale definitions from the orchestrator. Temperature autoscales
 *  with a ±5° padding ring (matches the old `suggestedMin/Max` recipe
 *  in draw.ts); precipitation pins to the orchestrator-provided ceiling
 *  so a single trailing 0.1 mm doesn't blow up the axis; sunshine is
 *  0..1 fractions. */
function buildScales(
  data: BuildChartOpts['data'],
  precipMax: number,
): uPlot.Scales {
  const tempFinite = [...data.tempHigh, ...data.tempLow].filter((v): v is number => Number.isFinite(v as number));
  const tempMin = tempFinite.length ? Math.min(...tempFinite) - 5 : 0;
  const tempMax = tempFinite.length ? Math.max(...tempFinite) + 6 : 30;
  return {
    x: { time: false },
    TempAxis: {
      auto: false,
      range: () => [tempMin, tempMax],
    },
    PrecipAxis: {
      auto: false,
      range: () => [0, precipMax],
    },
    SunshineAxis: {
      auto: false,
      range: () => [0, 1],
    },
  };
}

/** Axes config: x-axis reserves the same vertical strip the old
 *  Chart.js setup used (two label rows + optional sunshine band), with
 *  the actual labels rendered by the chart-plugin layer (the four
 *  plugins paint into the strip in their afterDraw hooks). Y-axes are
 *  invisible — series colours and the precipitation/sunshine plugins
 *  carry all the value cues.
 *
 *  X-axis is at the TOP (side: 0) — preserves the Chart.js layout
 *  (`position: 'top'`) so the daily-tick-labels plugin's `xScale.bottom -
 *  N` coordinate math lands in the right band (just above the chart
 *  drawing area). */
function buildAxes(sunshineLabelBand: number, labelsBaseSize: number): uPlot.Axis[] {
  const baseSize = labelsBaseSize || 11;
  const lineH = Math.ceil(baseSize * 1.3);
  // Two stacked label rows (date + time / weekday + date) plus the
  // sunshine strip when sunshine is on. Padding on top for the chart's
  // own breathing room.
  const xAxisSize = lineH * 2 + sunshineLabelBand + 8;
  return [
    {
      scale: 'x',
      side: 0,
      size: xAxisSize,
      stroke: 'transparent',
      grid: { show: false },
      ticks: { show: false },
      values: () => [],
    },
    { scale: 'TempAxis', show: false },
    { scale: 'PrecipAxis', show: false },
    { scale: 'SunshineAxis', show: false },
  ];
}

/** Per-frame shim: build a Chart.js-shaped ChartLike that wraps the
 *  uPlot instance. Plugins read tick positions via getPixelForTick(i),
 *  per-bar geometry via getDatasetMeta(idx).data[i], etc.
 *
 *  Coordinates here are CSS pixels — uPlot scales the ctx by pxRatio
 *  internally, so drawing in CSS px lands at the right device px.
 *
 *  meta.data is synthesized lazily per dataset: for bar series we
 *  compute (x, y, options.borderColor) per data point; for line series
 *  we leave .data empty (plugins only read meta for bars). */
function buildChartLikeShim(
  u: uPlot,
  columnCount: number,
  datasets: BuildChartOpts['datasets'],
): ChartLike {
  const chartArea = {
    left: u.bbox.left / uPlot.pxRatio,
    top: u.bbox.top / uPlot.pxRatio,
    right: (u.bbox.left + u.bbox.width) / uPlot.pxRatio,
    bottom: (u.bbox.top + u.bbox.height) / uPlot.pxRatio,
  };
  const colW = columnCount > 0 ? (u.bbox.width / uPlot.pxRatio) / columnCount : 0;
  // X-axis lives ABOVE the chart drawing area (uPlot side: 0). The
  // Chart.js plugins were written against that orientation
  // (`position: 'top'`), so `xScale.top` is the canvas top (0) and
  // `xScale.bottom` is the boundary between the label band and the
  // plot area — i.e. chartArea.top.
  const xScale: ChartScaleLike = {
    ticks: Array.from({ length: columnCount }, (_, i) => ({ value: i })),
    top: 0,
    bottom: chartArea.top,
    width: u.bbox.width / uPlot.pxRatio,
    getPixelForTick: (i: number) => chartArea.left + (i + 0.5) * colW,
    getPixelForValue: (v: number) => chartArea.left + (v + 0.5) * colW,
  };
  const precipScale: ChartScaleLike = {
    ticks: [],
    top: chartArea.top,
    bottom: chartArea.bottom,
    width: u.bbox.width / uPlot.pxRatio,
    getPixelForTick: () => 0,
    getPixelForValue: (v: number) => {
      try { return u.valToPos(v, 'PrecipAxis'); } catch { return chartArea.bottom; }
    },
  };
  return {
    ctx: u.ctx,
    chartArea,
    scales: {
      x: xScale,
      PrecipAxis: precipScale,
    },
    getDatasetMeta: (idx: number) => {
      const ds = datasets[idx];
      if (!ds) return null;
      const data: ChartBarLike[] = [];
      for (let i = 0; i < ds.data.length; i++) {
        const v = ds.data[i];
        const x = chartArea.left + (i + 0.5) * colW;
        let y = chartArea.bottom;
        if (typeof v === 'number' && Number.isFinite(v)) {
          try { y = u.valToPos(v, ds.yAxisID); } catch { /* axis not ready */ }
        }
        const colorAtI = Array.isArray(ds.borderColor) ? ds.borderColor[i] : ds.borderColor;
        data.push({ x, y, options: { borderColor: typeof colorAtI === 'string' ? colorAtI : undefined } });
      }
      return { data };
    },
  };
}

/** Read the chart container's pixel dimensions. uPlot needs explicit
 *  width/height at construction time. Height is passed in from the
 *  config (chart_height) because the inner div may not have layout
 *  yet at construction; width is read from the parent
 *  `.chart-container` (whose `width: 100%` resolves against
 *  `.forecast-content`, which IS sized by the time drawChart fires).
 *  Falls back to the target's own width if the container can't be
 *  resolved. */
function measureContainer(target: HTMLElement, chartHeight: number): { width: number; height: number } {
  const container = target.closest('.chart-container') as HTMLElement | null;
  const rect = (container ?? target).getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || target.getBoundingClientRect().width));
  return { width, height: Math.max(1, chartHeight) };
}

export function buildChart(target: HTMLElement, opts: BuildChartOpts): UplotChart {
  const {
    datasets,
    plugins,
    data,
    config,
    precipMax,
    sunshineLabelBand,
  } = opts;

  const labels = data.dateTime ?? [];
  const columnCount = labels.length;

  // Clear any prior uPlot child (defensive — orchestrator already
  // destroys the previous instance before constructing a new one).
  while (target.firstChild) target.removeChild(target.firstChild);

  const labelsBaseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  const { width, height } = measureContainer(target, opts.chartHeight);

  const series = buildSeries(datasets, opts.textColor);
  const scales = buildScales(data, precipMax);
  const axes = buildAxes(sunshineLabelBand, labelsBaseSize);

  // Run the existing chart.js-shaped plugins through a synthesized
  // ChartLike on every uPlot draw. Order matters: separator and tick
  // labels fire after the data has been drawn, then precip/sunshine
  // labels paint on top (matching Chart.js's afterDatasetsDraw vs
  // afterDraw ordering by listing them in the same sequence).
  const uplotPlugin: uPlot.Plugin = {
    hooks: {
      draw: (u) => {
        const shim = buildChartLikeShim(u, columnCount, datasets);
        for (const p of plugins) {
          if (p.afterDatasetsDraw) p.afterDatasetsDraw(shim);
        }
        for (const p of plugins) {
          if (p.afterDraw) p.afterDraw(shim);
        }
      },
    },
  };

  const uplotOpts: uPlot.Options = {
    width,
    height,
    pxAlign: true,
    series,
    scales,
    axes,
    legend: { show: false },
    cursor: {
      show: false,
      drag: { x: false, y: false, setScale: false },
    },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    padding: [4, 0, 0, 0],
    plugins: [uplotPlugin],
  };

  const alignedData = toAlignedData(labels, datasets);
  const uplot = new uPlot(uplotOpts, alignedData, target);

  const mutableDatasets = datasets.map((ds) => ({
    data: ds.data,
    backgroundColor: ds.backgroundColor,
    borderColor: ds.borderColor,
    hidden: ds.hidden,
  }));
  const dataBag = { labels, datasets: mutableDatasets };

  const instance: UplotChart = {
    uplot,
    data: dataBag,
    update(): void {
      const aligned = toAlignedData(dataBag.labels, dataBag.datasets);
      uplot.setData(aligned);
    },
    reset(): void {
      // chart.js had a notion of "reset to initial animation frame".
      // uPlot has no animation system — reset is a no-op. Kept on the
      // surface so the existing main.ts call site doesn't need a
      // version guard.
    },
    destroy(): void {
      try { uplot.destroy(); } catch { /* already gone */ }
    },
    resize(w?: number, h?: number): void {
      const next = (w && h) ? { width: w, height: h } : measureContainer(target, opts.chartHeight);
      uplot.setSize(next);
    },
    draw(): void {
      uplot.redraw();
    },
  };

  return instance;
}
