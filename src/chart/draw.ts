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
  /** True for hourly/today (per-hour bars). False for daily.
   *  Drives the boundary handling for split temp lines: hourly
   *  shows a dashed segment across the station→forecast boundary;
   *  daily leaves a gap there (matching Chart.js's transparent
   *  borderColor on the boundary segment in daily-combo). */
  isHourly: boolean;
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

/** Mask a line dataset's data into a station portion and a forecast
 *  portion. Each portion is the same length as the original; entries
 *  outside the portion become null so uPlot's spline path only
 *  renders where the data is.
 *
 *  The forecast portion includes the LAST STATION INDEX (boundary)
 *  too: the spline draws from station-today's value through forecast-
 *  today's value with the forecast's dashed style. Without this, the
 *  temp line has an obvious break at the doubled-today boundary —
 *  the Chart.js segment.borderDash callback used to handle this
 *  inline; with split series we replicate the connection by
 *  overlapping by one point. The station portion still draws its
 *  solid line up to and including the boundary point. */
function splitLineSeriesData(
  data: ReadonlyArray<number | null | undefined>,
  stationCount: number,
  isHourly: boolean,
): { station: Array<number | null | undefined>; forecast: Array<number | null | undefined> } {
  const n = data.length;
  const station = new Array<number | null | undefined>(n);
  const forecast = new Array<number | null | undefined>(n);
  // Hourly: forecast includes the boundary point (stationCount-1) so
  //   the spline draws a dashed segment from station-now to
  //   forecast-now — visual cue "measured up to now, predicted from
  //   now on".
  // Daily: forecast starts at stationCount, so the spline LEAVES a
  //   gap at the doubled-today boundary. Matches Chart.js's
  //   transparent boundary borderColor for daily-combo.
  const forecastStart = isHourly ? stationCount - 1 : stationCount;
  for (let i = 0; i < n; i++) {
    station[i] = i < stationCount ? data[i] : null;
    forecast[i] = i >= forecastStart ? data[i] : null;
  }
  return { station, forecast };
}

/** Convert dataset bag into a uPlot AlignedData tuple. Index 0 is the
 *  x-axis (synthetic 0..N-1 indices); subsequent arrays are the y
 *  values per series.
 *
 *  Line datasets expand into TWO uPlot series each (station + forecast
 *  portion, masked with nulls) so the forecast half can be styled
 *  dashed via `series.dash`. Bar datasets stay one-to-one. The order
 *  the shim relies on for `getDatasetMeta(i)` is the ORIGINAL
 *  `datasets[i]` order — the split is internal to uPlot's view. */
function toAlignedData(
  labels: ReadonlyArray<string | undefined>,
  datasets: ReadonlyArray<{ data: ReadonlyArray<number | null | undefined>; type: 'line' | 'bar' }>,
  stationCount: number,
  hasBothBlocks: boolean,
  isHourly: boolean,
): AlignedData {
  const n = labels.length;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) xs[i] = i;
  const ys: Array<Array<number | null | undefined>> = [];
  // Bars first, then lines — uPlot renders series in order, so the
  // last-pushed series sit ON TOP. Temperature lines need to render
  // over the precip and sunshine bars (otherwise a tall sunshine
  // bar hides the spline behind it). buildSeries uses the same
  // two-pass order so AlignedData and series array stay aligned.
  for (const ds of datasets) {
    if (ds.type === 'bar') {
      ys.push(ds.data.slice() as Array<number | null | undefined>);
    }
  }
  for (const ds of datasets) {
    if (ds.type === 'line') {
      if (hasBothBlocks) {
        const { station, forecast } = splitLineSeriesData(ds.data, stationCount, isHourly);
        ys.push(station, forecast);
      } else {
        ys.push(ds.data.slice() as Array<number | null | undefined>);
      }
    }
  }
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
  hasBothBlocks: boolean,
): uPlot.Series[] {
  const series: uPlot.Series[] = [{}]; // index 0 = x

  const barCount = datasets.filter((d) => d.type === 'bar').length;
  let barIdx = 0;

  // Two-pass iteration so bar series go first, line series last.
  // uPlot draws in series order, so the LATEST-pushed series sit ON
  // TOP visually. We want temperature lines drawn over the precip
  // and sunshine bars — otherwise a tall sunshine bar (90 % of
  // chart height on a sunny day) hides the spline curve behind it.
  // toAlignedData mirrors this two-pass order so ys[] indexes match.
  const orderedDatasets: typeof datasets = [
    ...datasets.filter((d) => d.type === 'bar'),
    ...datasets.filter((d) => d.type === 'line'),
  ];

  for (const ds of orderedDatasets) {
    if (ds.type === 'line') {
      const stroke = typeof ds.borderColor === 'string' ? ds.borderColor : textColor;
      const splineFactory = uPlot.paths.spline as () => uPlot.Series.PathBuilder;
      // In combination modes, each temp line dataset emits TWO uPlot
      // series (station + forecast portions, see toAlignedData's split).
      // Forecast portion gets `dash: [6, 4]` — same dash Chart.js
      // used for the segment.borderDash callback on forecast segments.
      // Single-block modes (station-only / forecast-only) collapse to
      // one series with no dash for station-only, dashed for
      // forecast-only.
      if (hasBothBlocks) {
        series.push({
          label: String(ds.label ?? ''),
          scale: ds.yAxisID,
          show: !ds.hidden,
          stroke,
          width: 1.5,
          paths: splineFactory?.() ?? null,
          // Show a small point at each data value — matches the
          // Chart.js baseline's `elements.point.radius: 2`.
          points: { show: true, size: 4, fill: stroke, stroke },
          spanGaps: false,
        });
        series.push({
          label: '',
          scale: ds.yAxisID,
          show: !ds.hidden,
          stroke,
          width: 1.5,
          dash: [6, 4],
          paths: splineFactory?.() ?? null,
          // Show a small point at each data value — matches the
          // Chart.js baseline's `elements.point.radius: 2`.
          points: { show: true, size: 4, fill: stroke, stroke },
          spanGaps: false,
        });
      } else {
        series.push({
          label: String(ds.label ?? ''),
          scale: ds.yAxisID,
          show: !ds.hidden,
          stroke,
          width: 1.5,
          paths: splineFactory?.() ?? null,
          // Show a small point at each data value — matches the
          // Chart.js baseline's `elements.point.radius: 2`.
          points: { show: true, size: 4, fill: stroke, stroke },
          spanGaps: false,
        });
      }
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
      // Grouped: each bar fills its half of the column — precip
      // covers the left 50 %, sunshine the right 50 %, touching at
      // the centre, reaching the column edges. Matches the visual
      // expectation that "the grid is half precipitation, half
      // sunshine per column". A dataset's `barPercentage` can shrink
      // its half-slot share further (e.g. 0.8 → 40 %), but the
      // default (1.0) gives the full 50/50 split.
      // Each grouped bar gets ~50 % of the column. With the x-scale
      // padded by 0.5 either side, data point i is centered at
      // (i + 0.5) * colW — column centers, not plot edges — so the
      // 50/50 bars sit inside their own column and don't bleed into
      // neighbours. Matches the "half precip, half sunshine per
      // column" layout from the Chart.js baseline.
      const sizeFactor = grouped ? Math.min(rawPct, 1) * 0.5 : rawPct;
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
  _data: BuildChartOpts['data'],
  precipMax: number,
  columnCount: number,
  tempMin: number,
  tempMax: number,
): uPlot.Scales {
  return {
    // x scale padded by 0.5 either side so data values land at
    // column CENTERS, not at the plot-area edges. Without this
    // padding, uPlot positions data 0 at xOff (left edge) and data
    // N-1 at xOff+xDim (right edge); the daily-tick-labels and
    // other plugins position labels at column-CENTER (i+0.5)*colW.
    x: { time: false, range: () => [-0.5, Math.max(0.5, columnCount - 0.5)] },
    TempAxis: {
      range: () => [tempMin, tempMax],
    },
    PrecipAxis: {
      range: () => [0, precipMax],
    },
    SunshineAxis: {
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
  // sunshine strip when sunshine is on, plus a small breathing band
  // (~10 px) between the date row and the plot area. The temp-labels
  // plugin clamps itself inside the chart area so we don't need a
  // huge cushion here — Chart.js's natural layout is closer to this.
  const xAxisSize = lineH * 2 + sunshineLabelBand + 10;
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
  tempMinForShim: number,
  tempMaxForShim: number,
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
      // Anchor value-0 lookups to the actual chart-area bottom: the
      // precip-label plugin uses this to position the "Xmm" boxes
      // centered on the PrecipAxis baseline, and we want them sitting
      // at the bottom of the chart. uPlot's valToPos(0, scale) can
      // drift when the scale's range is contested by other series on
      // the same y direction, so for the bar-baseline case we read it
      // off the bbox directly.
      if (v === 0) return chartArea.bottom;
      try { return u.valToPos(v, 'PrecipAxis'); } catch { return chartArea.bottom; }
    },
  };
  // TempAxis pixel mapping computed directly from the orchestrator's
  // tempMin/tempMax (passed in via opts) so we don't depend on
  // u.valToPos(_, 'TempAxis'), which has been returning NaN when
  // uPlot's scale init paths haven't fully populated the scale's
  // min/max (split-line series with mostly-null data on one side
  // can leave the scale unranged).
  const tempScale: ChartScaleLike = {
    ticks: [],
    top: chartArea.top,
    bottom: chartArea.bottom,
    width: u.bbox.width / uPlot.pxRatio,
    getPixelForTick: () => 0,
    getPixelForValue: (v: number) => {
      const drawHeight = chartArea.bottom - chartArea.top;
      const range = (tempMaxForShim - tempMinForShim) || 1;
      const fracFromMin = (v - tempMinForShim) / range;
      return chartArea.bottom - fracFromMin * drawHeight;
    },
  };
  return {
    ctx: u.ctx,
    chartArea,
    scales: {
      x: xScale,
      PrecipAxis: precipScale,
      TempAxis: tempScale,
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
  const stationCount = opts.stationCount;
  const lineCount = datasets.filter((d) => d.type === 'line').length;
  const hasBothBlocks = stationCount > 0 && stationCount < columnCount && lineCount > 0;

  // Clear any prior uPlot child (defensive — orchestrator already
  // destroys the previous instance before constructing a new one).
  while (target.firstChild) target.removeChild(target.firstChild);

  const labelsBaseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  const { width, height } = measureContainer(target, opts.chartHeight);

  // Pre-compute TempAxis min/max so the shim and the scale agree.
  //
  // Bottom-pad sized so the lowest data value always renders with
  // ~25 % of the chart drawing area BELOW it — that band is the
  // exact space the style2 low-temp label ("X°" rendered below the
  // dot) needs, plus a small gap above the precip-label boxes at
  // chartArea.bottom. Solved from the proportionality equation
  //   (lowestValue - tempMin) / (tempMax - tempMin) = 0.25
  // so the label always fits inside the chart without overlapping
  // either the line dot or the precip box.
  // Same on top so the high-temp labels have room above.
  const tempFiniteForShim = [...data.tempHigh, ...data.tempLow].filter((v): v is number => Number.isFinite(v as number));
  const rawMin = tempFiniteForShim.length ? Math.min(...tempFiniteForShim) : 0;
  const rawMax = tempFiniteForShim.length ? Math.max(...tempFiniteForShim) : 30;
  const rawRange = Math.max(1, rawMax - rawMin);
  // Reserve a fraction of the y-axis range at top and bottom so
  // the style2 "X°" labels (rendered below the low spline and above
  // the high spline) always have chart space to land in without
  // crashing into the precip-label boxes (bottom) or the date band
  // (top). Constants are proportional to the data range so they
  // scale: a narrow temp range (cold week, 3 °C spread) gets just
  // enough padding; a wide range (cold morning → hot afternoon,
  // 25 °C spread) gets more headroom.
  const bottomReserve = 0.24;
  const topReserve = 0.18;
  const tempMinForShim = rawMin - (rawRange + 3) * (bottomReserve / (1 - bottomReserve - topReserve));
  const tempMaxForShim = rawMax + (rawRange + 3) * (topReserve / (1 - bottomReserve - topReserve));

  const series = buildSeries(datasets, opts.textColor, hasBothBlocks);
  const scales = buildScales(data, precipMax, columnCount, tempMinForShim, tempMaxForShim);
  const axes = buildAxes(sunshineLabelBand, labelsBaseSize);

  // Run the existing chart.js-shaped plugins through a synthesized
  // ChartLike on every uPlot draw. Order matters: separator and tick
  // labels fire after the data has been drawn, then precip/sunshine
  // labels paint on top (matching Chart.js's afterDatasetsDraw vs
  // afterDraw ordering by listing them in the same sequence).
  const uplotPlugin: uPlot.Plugin = {
    hooks: {
      draw: (u) => {
        const shim = buildChartLikeShim(u, columnCount, datasets, tempMinForShim, tempMaxForShim);
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
    // [top, right, bottom, left] in CSS pixels. Bottom 14 px is the
    // breathing room the precip-label boxes need below the baseline —
    // the boxes are centered on the PrecipAxis-0 line, so half their
    // height (~8 px) sits below it. Without padding they clip into
    // the canvas edge. Matches Chart.js's `layout.padding.bottom: 10`
    // from the pre-uPlot setup.
    padding: [4, 0, 14, 0],
    plugins: [uplotPlugin],
  };

  const alignedData = toAlignedData(labels, datasets, stationCount, hasBothBlocks, opts.isHourly);
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
      // dataBag.datasets is the original chart.js-shaped dataset list
      // (one entry per logical dataset). toAlignedData re-splits line
      // datasets into station+forecast portions at the current
      // stationCount; bar datasets stay one-to-one.
      const splitDatasets = dataBag.datasets.map((d, i) => ({
        data: d.data,
        type: datasets[i].type,
      }));
      const aligned = toAlignedData(dataBag.labels, splitDatasets, stationCount, hasBothBlocks, opts.isHourly);
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
