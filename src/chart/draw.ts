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
  /** Viewport size in bars for the scrolling modes (0 = fit-all, no
   *  virtualization). Computed by the ORCHESTRATOR via
   *  `effectiveVisibleBars(config)` — config interpretation stays out
   *  of this render module; draw.ts only consumes the number. */
  visibleBars: number;
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
  /** The render-data object the label plugins close over — the SAME
   *  reference drawChartUnsafe hands to both buildPlugins() and this
   *  builder. The value-printing plugins (precip / temp / sunshine /
   *  daily-tick) read their numbers from it LAZILY at draw time, so
   *  refreshing its fields in place re-prints fresh values on the next
   *  draw. updateChart() in main.ts mutates this during an in-place
   *  data update; without it the bars and lines move (uPlot owns those)
   *  but the printed numbers stay frozen — the "bar grew but the mm
   *  didn't" bug on always-on tablets that only ever hit updateChart()
   *  and never a full destroy+rebuild. */
  renderData: PluginRenderData & {
    tempHigh: ReadonlyArray<number | null | undefined>;
    tempLow: ReadonlyArray<number | null | undefined>;
  };
  update(): void;
  reset(): void;
  destroy(): void;
  resize(width?: number, height?: number): void;
  draw(): void;
  /** Virtualized-canvas pan (perf pass 2026-08). In scrolling modes
   *  the canvas is only viewport-wide and pinned (position: sticky);
   *  the scroll handler calls this with the wrapper's scrollLeft and
   *  the chart pans via uPlot setScale — a redraw proportional to the
   *  ~visibleBars columns on screen, not the full series. No-op for
   *  non-virtualized (non-scrolling) charts. */
  setScrollWindow(scrollLeftPx: number): void;
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
// Temperature line styling. Width 2 (integer) instead of the old 1.5:
// at DPR 1 a 1.5 px stroke has NO solid pixel core — the whole line is
// anti-aliasing fuzz, read by users as "verpixelt". 2 px renders a
// crisp core row. Dash lengthened from [6,4] to [10,6] so the forecast
// line reads as a calm dashed curve instead of choppy confetti when
// the hourly data wiggles by ±0.2 °C.
const LINE_WIDTH = 2;
const FORECAST_DASH = [10, 6];

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
          width: LINE_WIDTH,
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
          width: LINE_WIDTH,
          dash: FORECAST_DASH,
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
          width: LINE_WIDTH,
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
        // uPlot's bars builder indexes the returned colour arrays with
        // the ABSOLUTE data index (`fillColors[i]` for i in idx0..idx1)
        // — NOT relative to idx0. Return the full per-index arrays;
        // a window-relative slice shifts every bar colour by idx0
        // columns once the virtualized canvas pans (idx0 > 0), which
        // painted today's measured rain in the forecast tint.
        const len = ds.data.length;
        const fullFill: string[] = new Array(len);
        const fullStroke: string[] = new Array(len);
        for (let i = 0; i < len; i++) {
          fullFill[i] = fillArr?.[i] ?? singleFill;
          fullStroke[i] = strokeArr?.[i] ?? singleStroke;
        }
        barOpts.disp = {
          fill: { unit: 3, values: () => fullFill },
          stroke: { unit: 3, values: () => fullStroke },
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
/** Mutable x-window state shared between the scale's range function
 *  and `setScrollWindow`. Non-virtual charts keep min=-0.5 and
 *  span=columnCount for the chart's whole life; virtual charts pan
 *  `min` as the user scrolls. */
interface XWindow {
  min: number;
  span: number;
}

function buildScales(
  _data: BuildChartOpts['data'],
  precipMax: number,
  win: XWindow,
  tempMin: number,
  tempMax: number,
): uPlot.Scales {
  return {
    // x scale padded by 0.5 either side so data values land at
    // column CENTERS, not at the plot-area edges. Without this
    // padding, uPlot positions data 0 at xOff (left edge) and data
    // N-1 at xOff+xDim (right edge); the daily-tick-labels and
    // other plugins position labels at column-CENTER (i+0.5)*colW.
    // The range function reads the shared window state so a
    // virtualized chart pans by mutating `win.min` + setScale.
    x: { time: false, range: () => [win.min, win.min + win.span] },
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
  precipMax: number,
): ChartLike {
  const chartArea = {
    left: u.bbox.left / uPlot.pxRatio,
    top: u.bbox.top / uPlot.pxRatio,
    right: (u.bbox.left + u.bbox.width) / uPlot.pxRatio,
    bottom: (u.bbox.top + u.bbox.height) / uPlot.pxRatio,
  };
  // X mapping derives from the LIVE x-scale window rather than the
  // total column count, so the same formula covers both the classic
  // full-width canvas (scale spans all columns) and the virtualized
  // viewport canvas (scale spans ~visibleBars columns, panned via
  // setScrollWindow). `xScale.width` reports the VIRTUAL full width
  // (columnCount × px-per-column) — plugins divide it by ticks.length
  // to recover the column width, which must stay scroll-invariant.
  const plotW = u.bbox.width / uPlot.pxRatio;
  const sx = u.scales['x'];
  const scaleMin = (sx && typeof sx.min === 'number' && Number.isFinite(sx.min)) ? sx.min : -0.5;
  const scaleMax = (sx && typeof sx.max === 'number' && Number.isFinite(sx.max)) ? sx.max : (Math.max(0.5, columnCount - 0.5));
  const span = Math.max(0.001, scaleMax - scaleMin);
  const pxPerCol = plotW / span;
  const xToPx = (v: number): number => chartArea.left + (v - scaleMin) * pxPerCol;
  // X-axis lives ABOVE the chart drawing area (uPlot side: 0). The
  // Chart.js plugins were written against that orientation
  // (`position: 'top'`), so `xScale.top` is the canvas top (0) and
  // `xScale.bottom` is the boundary between the label band and the
  // plot area — i.e. chartArea.top.
  const xScale: ChartScaleLike = {
    ticks: Array.from({ length: columnCount }, (_, i) => ({ value: i })),
    top: 0,
    bottom: chartArea.top,
    width: columnCount * pxPerCol,
    getPixelForTick: xToPx,
    getPixelForValue: xToPx,
  };
  // Y mapping is pure arithmetic against the known scale ranges
  // (PrecipAxis [0, precipMax], SunshineAxis [0, 1], TempAxis
  // [tempMin, tempMax]) — no u.valToPos, which both cost a call +
  // try/catch per data point per draw and returned NaN when a
  // split-line series left a scale unranged.
  const drawHeight = chartArea.bottom - chartArea.top;
  const tempRange = (tempMaxForShim - tempMinForShim) || 1;
  const yFor = (axisId: string, v: number): number => {
    if (axisId === 'PrecipAxis') {
      return precipMax > 0 ? chartArea.bottom - (v / precipMax) * drawHeight : chartArea.bottom;
    }
    if (axisId === 'SunshineAxis') {
      return chartArea.bottom - v * drawHeight;
    }
    return chartArea.bottom - ((v - tempMinForShim) / tempRange) * drawHeight;
  };
  const precipScale: ChartScaleLike = {
    ticks: [],
    top: chartArea.top,
    bottom: chartArea.bottom,
    width: plotW,
    getPixelForTick: () => 0,
    // Value-0 anchors to the actual chart-area bottom — the precip-label
    // plugin centres its "Xmm" boxes on the PrecipAxis baseline.
    getPixelForValue: (v: number) => (v === 0 ? chartArea.bottom : yFor('PrecipAxis', v)),
  };
  const tempScale: ChartScaleLike = {
    ticks: [],
    top: chartArea.top,
    bottom: chartArea.bottom,
    width: plotW,
    getPixelForTick: () => 0,
    getPixelForValue: (v: number) => yFor('TempAxis', v),
  };
  return {
    ctx: u.ctx,
    canvas: (u.ctx ? u.ctx.canvas : null) as HTMLCanvasElement | null,
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
        const x = xToPx(i);
        const y = (typeof v === 'number' && Number.isFinite(v))
          ? yFor(ds.yAxisID, v)
          : chartArea.bottom;
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
function measureContainer(
  target: HTMLElement,
  chartHeight: number,
  wrapperEl: HTMLElement | null = null,
): { width: number; height: number } {
  // Virtualized mode: the canvas is viewport-sized, so measure the
  // scroll wrapper (the visible viewport), NOT the full-content-width
  // .chart-container.
  const container = wrapperEl ?? (target.closest('.chart-container') as HTMLElement | null);
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

  // ── Canvas virtualization (perf pass 2026-08) ─────────────────────
  // In scrolling modes the canvas used to be CONTENT-width (~7 700 CSS
  // px at hourly ×DPR² device px ≈ tens of MB of buffer) and scrolled
  // via CSS overflow — every redraw painted the full width. Now the
  // canvas is VIEWPORT-width, pinned with position:sticky inside the
  // full-width .chart-container, and the x-scale window pans via
  // `setScrollWindow` as the wrapper scrolls. The DOM rows (condition
  // icons, wind) keep the full-width native scroll; alignment holds
  // because px-per-column is identical on both sides
  // (viewportW / visibleBars === contentW / totalBars).
  const wrapperEl = target.closest('.forecast-scroll.scrolling') as HTMLElement | null;
  // Same viewport rule as render() — 'today' is pinned to 8 bars
  // (one calendar day per page), other modes use number_of_forecasts.
  // The orchestrator computes this via effectiveVisibleBars(config).
  const visibleBars = opts.visibleBars;
  const virtual = !!wrapperEl && visibleBars > 0 && columnCount > visibleBars;

  const labelsBaseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  const { width, height } = measureContainer(target, opts.chartHeight, virtual ? wrapperEl : null);

  // Sticky pinning + explicit width for the virtual canvas; reset any
  // leftovers when this build is non-virtual (mode toggle reusing the
  // same target div).
  if (virtual) {
    target.style.position = 'sticky';
    target.style.left = '0';
    target.style.width = `${width}px`;
  } else {
    target.style.position = '';
    target.style.left = '';
    target.style.width = '';
  }

  // X-window: virtual charts start at the wrapper's current scroll
  // offset (a rebuild mid-scroll must not snap the view); classic
  // charts span every column for their whole life.
  let colWpx = virtual ? width / visibleBars : 0;
  const win: XWindow = virtual
    ? { min: (wrapperEl ? wrapperEl.scrollLeft : 0) / colWpx - 0.5, span: visibleBars }
    : { min: -0.5, span: Math.max(1, columnCount) };

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
  // Pixel-aware floor (community post 15 "yellow", maintainer
  // decision): the label needs a FIXED number of pixels — offset
  // above/below the dot (fontSize + 4) plus half a glyph plus
  // breathing room — while the proportional reserve shrinks with the
  // chart. At small chart_height values the 18 % top slice fell below
  // the label's pixel need and "34°" poked into the date/time band.
  // Raise the fractions until the label fits (capped so the plot
  // never degenerates); at the default chart height the floors are
  // inactive and the classic proportions apply unchanged. This pads
  // ONLY the TempAxis — the sunshine/precip bars live on their own
  // axes and keep their exact heights.
  const labelFontPx = labelsBaseSize + 1;
  const labelNeedPx = labelFontPx + 4 + Math.ceil(labelFontPx / 2) + 2;
  const xAxisBandPx = Math.ceil(labelsBaseSize * 1.3) * 2 + sunshineLabelBand + 10;
  const plotHeightPx = Math.max(40, height - xAxisBandPx);
  const bottomReserve = Math.min(0.4, Math.max(0.24, labelNeedPx / plotHeightPx));
  const topReserve = Math.min(0.35, Math.max(0.18, labelNeedPx / plotHeightPx));
  const tempMinForShim = rawMin - (rawRange + 3) * (bottomReserve / (1 - bottomReserve - topReserve));
  const tempMaxForShim = rawMax + (rawRange + 3) * (topReserve / (1 - bottomReserve - topReserve));

  const series = buildSeries(datasets, opts.textColor, hasBothBlocks);
  const scales = buildScales(data, precipMax, win, tempMinForShim, tempMaxForShim);
  const axes = buildAxes(sunshineLabelBand, labelsBaseSize);

  // ── Supersampling for low-DPR displays (visual pass 2026-08) ──────
  // At DPR 1 every stroke is rendered with exactly one sample per
  // pixel — a 2 px spline is visibly stair-stepped ("verpixelt").
  // Render into a 2× pixel buffer instead and let the canvas's CSS
  // size (unchanged) scale it down: 4 samples per displayed pixel,
  // the same smoothing a Retina screen gets for free. Implementation:
  // uPlot 1.6.x has no per-instance pxRatio, so after every internal
  // canvas (re)size we grow the BUFFER and pre-scale the context —
  // uPlot's own drawing (device-px coordinates) and the plugin layer
  // (ctx.scale on top of the existing transform) both inherit the
  // scale transparently. Memory cost is 4× the canvas buffer, which
  // the viewport-sized virtual canvas keeps at ~2 MB. High-DPR
  // devices skip this — they're already smooth.
  const superSample = (typeof devicePixelRatio === 'number' && devicePixelRatio < 1.5) ? 2 : 1;
  const applySuperSample = (u: uPlot): void => {
    if (superSample === 1) return;
    const can = u.ctx.canvas;
    const targetW = Math.round(u.width * uPlot.pxRatio * superSample);
    const targetH = Math.round(u.height * uPlot.pxRatio * superSample);
    if (can.width === targetW && can.height === targetH) return;
    // Assigning width/height resets the context transform — re-apply.
    can.width = targetW;
    can.height = targetH;
    u.ctx.setTransform(superSample, 0, 0, superSample, 0, 0);
  };

  // Run the existing chart.js-shaped plugins through a synthesized
  // ChartLike on every uPlot draw. Order matters: separator and tick
  // labels fire after the data has been drawn, then precip/sunshine
  // labels paint on top (matching Chart.js's afterDatasetsDraw vs
  // afterDraw ordering by listing them in the same sequence).
  const uplotPlugin: uPlot.Plugin = {
    hooks: {
      // Ensure the supersampled buffer BEFORE anything paints this
      // frame. drawClear fires at the start of every redraw; setSize
      // covers the resize path where uPlot just reset the canvas
      // buffer to its own 1× dimensions.
      setSize: (u) => { applySuperSample(u); },
      drawClear: (u) => { applySuperSample(u); },
      draw: (u) => {
        const shim = buildChartLikeShim(u, columnCount, datasets, tempMinForShim, tempMaxForShim, precipMax);
        // Plugins draw in CSS pixels (per the shim's divide-by-pxRatio
        // bbox conversion). uPlot itself draws in device pixels by
        // multiplying coordinates by pxRatio inline; it does NOT use
        // ctx.scale(). So on high-DPR devices (most phones, retina
        // laptops) the plugin's CSS-pixel calls land at 1/pxRatio of
        // the intended canvas position — labels visually clustered in
        // a fraction of the chart width.
        //
        // Wrap plugin draws with a transient ctx.scale(pxRatio,
        // pxRatio) so CSS-pixel coords inside plugin code are scaled
        // to device pixels by the canvas matrix itself. Font sizes,
        // line widths, and translate calls inside the plugins now
        // produce display-sized output at any DPR. uPlot's own
        // drawing already happened before this hook fires, so the
        // scale doesn't double-count anything.
        const c = u.ctx;
        const pr = uPlot.pxRatio;
        c.save();
        if (pr !== 1) c.scale(pr, pr);
        for (const p of plugins) {
          if (p.afterDatasetsDraw) p.afterDatasetsDraw(shim);
        }
        for (const p of plugins) {
          if (p.afterDraw) p.afterDraw(shim);
        }
        c.restore();
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
    // Share the plugins' render-data object by reference (see the
    // interface doc) so main.ts can refresh its fields in place.
    renderData: data,
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
      // Drop the virtual-mode inline styles so a later non-virtual
      // build into the same div starts clean.
      target.style.position = '';
      target.style.left = '';
      target.style.width = '';
    },
    resize(w?: number, h?: number): void {
      const next = (w && h)
        ? { width: w, height: h }
        : measureContainer(target, opts.chartHeight, virtual ? wrapperEl : null);
      if (virtual) {
        target.style.width = `${next.width}px`;
        colWpx = next.width / visibleBars;
        // Re-anchor the window to the wrapper's current scroll offset
        // under the NEW column width.
        win.min = (wrapperEl ? wrapperEl.scrollLeft : 0) / colWpx - 0.5;
      }
      uplot.setSize(next);
      if (virtual) {
        uplot.setScale('x', { min: win.min, max: win.min + win.span });
      }
    },
    draw(): void {
      uplot.redraw();
    },
    setScrollWindow(scrollLeftPx: number): void {
      if (!virtual || !Number.isFinite(scrollLeftPx) || colWpx <= 0) return;
      const min = scrollLeftPx / colWpx - 0.5;
      // Sub-millicolumn no-op guard — scroll events can repeat the
      // same position (momentum end, programmatic clamps).
      if (Math.abs(min - win.min) < 1e-3) return;
      win.min = min;
      uplot.setScale('x', { min, max: min + win.span });
    },
  };

  return instance;
}
