// uPlot instance builder (ADR-0012). Plugins consume a `ChartLike` shim
// (scales.x.getPixelForTick, ctx, chartArea, getDatasetMeta) built from
// the uPlot instance on every draw.
//
// The x-scale uses synthetic indices 0..N-1: the card's data is
// positional, one dataset element per bucket.

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
  /** Mode/unit-static FLOOR for the precipitation y-axis ceiling,
   *  resolved by the orchestrator (config interpretation stays in the
   *  wiring layer). The actual ceiling — max(floor, tallest bucket) —
   *  is derived from the data HERE, at build time and again on every
   *  in-place update(), so a data refresh rescales the bars without a
   *  destroy+rebuild. */
  precipFloor: number;
  precipUnit: string;
  tempUnit: string;
  doubledToday: boolean;
  stationCount: number;
  /** True for hourly/today (per-hour bars), false for daily. Hourly
   *  draws a dashed segment across the station→forecast boundary;
   *  daily leaves a gap there. */
  isHourly: boolean;
  style: CssStyleLike;
  sunshineLabelBand: number;
  /** Chart height in CSS pixels (`config.forecast.chart_height`). Passed
   *  in because the target div may not have its layout resolved yet at
   *  construction, and uPlot needs a numeric height up-front. */
  chartHeight: number;
  /** Viewport size in bars for the scrolling modes (0 = fit-all, no
   *  virtualization), computed by the orchestrator. */
  visibleBars: number;
  inPreview?: boolean;
  /** Extra bottom padding in CSS px, on top of the 14 px the one-line
   *  precip box needs. The orchestrator passes the two-line box's
   *  extra when `forecast.show_precip_probability` is on (#288). */
  extraBottomPad?: number;
}

/** Chart handle the rest of the card touches: `data.datasets` /
 *  `data.labels` for in-place updates from main.ts, plus the lifecycle
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
  /** The render-data object the label plugins close over (the same
   *  reference goes to buildPlugins() and this builder). They read it
   *  lazily at draw time, so main.ts refreshes its fields in place on a
   *  data update and the printed values follow. */
  renderData: PluginRenderData & {
    tempHigh: ReadonlyArray<number | null | undefined>;
    tempLow: ReadonlyArray<number | null | undefined>;
  };
  update(): void;
  reset(): void;
  destroy(): void;
  resize(width?: number, height?: number): void;
  draw(): void;
  /** Pans the virtualized canvas to the wrapper's scrollLeft (ADR-0019).
   *  No-op for non-virtualized charts. */
  setScrollWindow(scrollLeftPx: number): void;
}

type AlignedData = [Array<number>, ...Array<Array<number | null | undefined>>];

/** Mask a line dataset into a station portion and a forecast portion,
 *  each as long as the original, with null outside the portion. Hourly
 *  forecasts include the last station index so the line has no break at
 *  the boundary. */
function splitLineSeriesData(
  data: ReadonlyArray<number | null | undefined>,
  stationCount: number,
  isHourly: boolean,
): { station: Array<number | null | undefined>; forecast: Array<number | null | undefined> } {
  const n = data.length;
  const station = new Array<number | null | undefined>(n);
  const forecast = new Array<number | null | undefined>(n);
  // Hourly overlaps the boundary point (dashed segment from station-now
  // to forecast-now); daily starts at stationCount, leaving a gap.
  const forecastStart = isHourly ? stationCount - 1 : stationCount;
  for (let i = 0; i < n; i++) {
    station[i] = i < stationCount ? data[i] : null;
    forecast[i] = i >= forecastStart ? data[i] : null;
  }
  return { station, forecast };
}

/** Convert the dataset bag into a uPlot AlignedData tuple (x indices,
 *  then one array per series). With both blocks present, line datasets
 *  become two series (station + forecast) so the forecast can be dashed;
 *  bar datasets stay one-to-one. `getDatasetMeta(i)` still indexes the
 *  original `datasets[i]` order. */
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
  // Bars first, then lines: later series paint on top, and a tall
  // sunshine bar must not hide the temperature line. buildSeries uses
  // the same order so AlignedData and the series array stay aligned.
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

// Integer width: at DPR 1 a 1.5 px stroke has no solid pixel core. The
// long dash keeps the forecast line calm when hourly data wiggles.
const LINE_WIDTH = 2;
const FORECAST_DASH = [10, 6];

/** Build the `series` array uPlot consumes. Bar series route per-bar
 *  fill/stroke arrays through `disp`; line series use the spline path.
 *  Multiple bar series sit side by side in a column via `align`
 *  (-1 left half, 1 right half); a single bar series is centred. */
function buildSeries(
  datasets: BuildChartOpts['datasets'],
  textColor: string,
  hasBothBlocks: boolean,
): uPlot.Series[] {
  const series: uPlot.Series[] = [{}]; // index 0 = x

  const barCount = datasets.filter((d) => d.type === 'bar').length;
  let barIdx = 0;

  // Bars first, lines last (see toAlignedData).
  const orderedDatasets: typeof datasets = [
    ...datasets.filter((d) => d.type === 'bar'),
    ...datasets.filter((d) => d.type === 'line'),
  ];

  for (const ds of orderedDatasets) {
    if (ds.type === 'line') {
      const stroke = typeof ds.borderColor === 'string' ? ds.borderColor : textColor;
      const splineFactory = uPlot.paths.spline as () => uPlot.Series.PathBuilder;
      // With both blocks each line dataset emits two series (see
      // toAlignedData); only the forecast portion is dashed. Single-block
      // modes emit one undashed series.
      if (hasBothBlocks) {
        series.push({
          label: String(ds.label ?? ''),
          scale: ds.yAxisID,
          show: !ds.hidden,
          stroke,
          width: LINE_WIDTH,
          paths: splineFactory?.() ?? null,
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
          points: { show: true, size: 4, fill: stroke, stroke },
          spanGaps: false,
        });
      }
    } else {
      const fillArr = Array.isArray(ds.backgroundColor) ? ds.backgroundColor : null;
      const strokeArr = Array.isArray(ds.borderColor) ? ds.borderColor : null;
      const singleFill = typeof ds.backgroundColor === 'string' ? ds.backgroundColor : textColor;
      const singleStroke = typeof ds.borderColor === 'string' ? ds.borderColor : singleFill;
      const grouped = barCount > 1;
      const rawPct = typeof ds.barPercentage === 'number' ? ds.barPercentage : 0.8;
      // Grouped: precip takes the left half of the column, sunshine the
      // right; `barPercentage` shrinks a half (0.8 → 40 %). Standalone
      // bars use the full `barPercentage`, centred.
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
        // the ABSOLUTE data index (`fillColors[i]` for i in idx0..idx1),
        // not relative to idx0. Return the full per-index arrays: a
        // window-relative slice shifts every colour once the virtual
        // canvas pans.
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

/** Mutable x-window state shared between the scale's range function
 *  and `setScrollWindow`. Non-virtual charts keep min=-0.5 and
 *  span=columnCount for the chart's whole life; virtual charts pan
 *  `min` as the user scrolls. */
interface XWindow {
  min: number;
  span: number;
}

/** Mutable y-scale ceilings, shared by reference between the scale range
 *  closures, the per-draw plugin shim and `update()`. uPlot re-invokes
 *  the range functions on setData, so mutating this right before it
 *  rescales in place. Build-time scalars would leave the ceiling stale
 *  after an in-place data update. */
export interface YScaleState {
  precipMax: number;
  tempMin: number;
  tempMax: number;
}

/** Precipitation y-axis ceiling: max(floor, tallest finite bucket). The
 *  floor keeps a drizzle day from blowing the axis up; the data max
 *  stops heavy rain from clipping. */
export function precipCeiling(
  floor: number,
  precip: ReadonlyArray<number | null | undefined> = [],
): number {
  let dataMax = 0;
  for (const v of precip) {
    if (typeof v === 'number' && Number.isFinite(v) && v > dataMax) dataMax = v;
  }
  return Math.max(floor, dataMax);
}

/** TempAxis min/max from the current temperatures plus the reserve
 *  fractions (see buildChart): the slices of the y-range kept free below
 *  the lowest and above the highest point for the style2 "X°" labels.
 *  Solved from (lowest - min) / (max - min) = bottomReserve, mirrored
 *  at the top. */
function tempAxisBounds(
  temps: ReadonlyArray<number | null | undefined>,
  bottomReserve: number,
  topReserve: number,
): { min: number; max: number } {
  const finite = temps.filter((v): v is number => Number.isFinite(v as number));
  const rawMin = finite.length ? Math.min(...finite) : 0;
  const rawMax = finite.length ? Math.max(...finite) : 30;
  const rawRange = Math.max(1, rawMax - rawMin);
  const denom = 1 - bottomReserve - topReserve;
  return {
    min: rawMin - (rawRange + 3) * (bottomReserve / denom),
    max: rawMax + (rawRange + 3) * (topReserve / denom),
  };
}

/** Re-derive the y-scale ceilings from the per-series data into `state`.
 *  Build and `update()` share this path, so an in-place refresh lands on
 *  the ceiling a rebuild would compute. Exported for unit tests. */
export function refreshYScaleState(
  state: YScaleState,
  series: ReadonlyArray<{ yAxisID: string; data: ReadonlyArray<number | null | undefined> }>,
  precipFloor: number,
  bottomReserve: number,
  topReserve: number,
): void {
  const byAxis = (axisId: string): Array<number | null | undefined> => {
    const out: Array<number | null | undefined> = [];
    for (const s of series) {
      if (s.yAxisID === axisId) out.push(...s.data);
    }
    return out;
  };
  state.precipMax = precipCeiling(precipFloor, byAxis('PrecipAxis'));
  const bounds = tempAxisBounds(byAxis('TempAxis'), bottomReserve, topReserve);
  state.tempMin = bounds.min;
  state.tempMax = bounds.max;
}

/** Scale definitions. Temperature and precipitation ranges read the
 *  shared YScaleState live; sunshine is a fixed 0..1 fraction. */
function buildScales(
  scaleState: YScaleState,
  win: XWindow,
): uPlot.Scales {
  return {
    // Window starts at -0.5 so data values land at column centers, where
    // the plugins position their labels. Virtual charts pan by mutating
    // `win.min` + setScale.
    x: { time: false, range: () => [win.min, win.min + win.span] },
    TempAxis: {
      range: () => [scaleState.tempMin, scaleState.tempMax],
    },
    PrecipAxis: {
      range: () => [0, scaleState.precipMax],
    },
    SunshineAxis: {
      range: () => [0, 1],
    },
  };
}

/** Axes config. The x-axis is a strip at the TOP (side: 0) that only
 *  reserves height (two label rows, the sunshine band, a 10 px gap); the
 *  plugins paint the labels into it. The plugins' `xScale.bottom - N`
 *  math relies on that position. Y-axes are hidden. */
function buildAxes(sunshineLabelBand: number, labelsBaseSize: number): uPlot.Axis[] {
  const baseSize = labelsBaseSize || 11;
  const lineH = Math.ceil(baseSize * 1.3);
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

/** Per-frame shim: a ChartLike wrapping the uPlot instance. Coordinates
 *  are CSS pixels (the draw hook scales the ctx by pxRatio).
 *  `getDatasetMeta(idx).data` holds (x, y, borderColor) per data point of
 *  any dataset; the plugins only read it for bars. */
function buildChartLikeShim(
  u: uPlot,
  columnCount: number,
  datasets: BuildChartOpts['datasets'],
  scaleState: YScaleState,
): ChartLike {
  // Rebuilt per draw, after any re-range, so plugin pixel math agrees
  // with uPlot's scale.
  const { tempMin: tempMinForShim, tempMax: tempMaxForShim, precipMax } = scaleState;
  const chartArea = {
    left: u.bbox.left / uPlot.pxRatio,
    top: u.bbox.top / uPlot.pxRatio,
    right: (u.bbox.left + u.bbox.width) / uPlot.pxRatio,
    bottom: (u.bbox.top + u.bbox.height) / uPlot.pxRatio,
  };
  // X mapping derives from the live x-scale window, so one formula covers
  // full-width and virtualized canvases. `xScale.width` is the virtual
  // full width (columnCount × px-per-column): plugins divide it by
  // ticks.length for a scroll-invariant column width.
  const plotW = u.bbox.width / uPlot.pxRatio;
  const sx = u.scales['x'];
  const scaleMin = (sx && typeof sx.min === 'number' && Number.isFinite(sx.min)) ? sx.min : -0.5;
  const scaleMax = (sx && typeof sx.max === 'number' && Number.isFinite(sx.max)) ? sx.max : (Math.max(0.5, columnCount - 0.5));
  const span = Math.max(0.001, scaleMax - scaleMin);
  const pxPerCol = plotW / span;
  const xToPx = (v: number): number => chartArea.left + (v - scaleMin) * pxPerCol;
  // The x-axis sits above the plot: `bottom` is the boundary between the
  // label band and the plot area (chartArea.top).
  const xScale: ChartScaleLike = {
    ticks: Array.from({ length: columnCount }, (_, i) => ({ value: i })),
    top: 0,
    bottom: chartArea.top,
    width: columnCount * pxPerCol,
    getPixelForTick: xToPx,
    getPixelForValue: xToPx,
  };
  // Pure arithmetic against the known scale ranges rather than
  // u.valToPos, which returns NaN when a split-line series leaves a
  // scale unranged.
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
    // The precip-label plugin centres its boxes on the PrecipAxis baseline.
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

/** Chart pixel size: height from config, width from the wrapper or the
 *  parent `.chart-container`, falling back to the target's own width. */
function measureContainer(
  target: HTMLElement,
  chartHeight: number,
  wrapperEl: HTMLElement | null = null,
): { width: number; height: number } {
  // Virtualized: the canvas is viewport-sized, so measure the wrapper.
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
    precipFloor,
    sunshineLabelBand,
  } = opts;

  const labels = data.dateTime ?? [];
  const columnCount = labels.length;
  const stationCount = opts.stationCount;
  const lineCount = datasets.filter((d) => d.type === 'line').length;
  const hasBothBlocks = stationCount > 0 && stationCount < columnCount && lineCount > 0;

  while (target.firstChild) target.removeChild(target.firstChild);

  // Scrolling modes: viewport-wide sticky canvas whose x-window pans via
  // setScrollWindow (ADR-0019). Alignment with the DOM rows holds because
  // px-per-column is the same on both sides.
  const wrapperEl = target.closest('.forecast-scroll.scrolling') as HTMLElement | null;
  const visibleBars = opts.visibleBars;
  const virtual = !!wrapperEl && visibleBars > 0 && columnCount > visibleBars;

  const labelsBaseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  const { width, height } = measureContainer(target, opts.chartHeight, virtual ? wrapperEl : null);

  // A non-virtual build resets inline styles left by a previous virtual
  // build into the same div.
  if (virtual) {
    target.style.position = 'sticky';
    target.style.left = '0';
    target.style.width = `${width}px`;
  } else {
    target.style.position = '';
    target.style.left = '';
    target.style.width = '';
  }

  // Virtual charts start at the wrapper's scroll offset so a mid-scroll
  // rebuild does not snap the view.
  let colWpx = virtual ? width / visibleBars : 0;
  const win: XWindow = virtual
    ? { min: (wrapperEl ? wrapperEl.scrollLeft : 0) / colWpx - 0.5, span: visibleBars }
    : { min: -0.5, span: Math.max(1, columnCount) };

  // TempAxis reserve fractions (see tempAxisBounds). Pixel-aware floor:
  // the style2 label needs a fixed pixel height while the proportional
  // reserve shrinks with chart_height, so raise the fractions until it
  // fits (clamped 24-40 % bottom, 18-35 % top). Only the TempAxis is
  // padded. Layout-static, so update() reuses them.
  const labelFontPx = labelsBaseSize + 1;
  const labelNeedPx = labelFontPx + 4 + Math.ceil(labelFontPx / 2) + 2;
  const xAxisBandPx = Math.ceil(labelsBaseSize * 1.3) * 2 + sunshineLabelBand + 10;
  const plotHeightPx = Math.max(40, height - xAxisBandPx);
  const bottomReserve = Math.min(0.4, Math.max(0.24, labelNeedPx / plotHeightPx));
  const topReserve = Math.min(0.35, Math.max(0.18, labelNeedPx / plotHeightPx));

  const scaleState: YScaleState = { precipMax: precipFloor, tempMin: 0, tempMax: 1 };
  refreshYScaleState(scaleState, datasets, precipFloor, bottomReserve, topReserve);

  const series = buildSeries(datasets, opts.textColor, hasBothBlocks);
  const scales = buildScales(scaleState, win);
  const axes = buildAxes(sunshineLabelBand, labelsBaseSize);

  // DPR < 1.5: render into a 2x buffer (CSS size unchanged) to avoid
  // stair-stepped strokes. uPlot 1.6 has no per-instance pxRatio, so grow
  // the buffer and pre-scale the ctx after every uPlot (re)size
  // (ADR-0019).
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

  // Runs the plugins against a fresh ChartLike on every uPlot draw: all
  // afterDatasetsDraw hooks first, then all afterDraw hooks.
  const uplotPlugin: uPlot.Plugin = {
    hooks: {
      // Ensure the supersampled buffer before anything paints; setSize
      // covers the resize path, where uPlot resets the buffer.
      setSize: (u) => { applySuperSample(u); },
      drawClear: (u) => { applySuperSample(u); },
      draw: (u) => {
        const shim = buildChartLikeShim(u, columnCount, datasets, scaleState);
        // uPlot draws in device px without ctx.scale(); plugins draw in
        // CSS px, so scale by pxRatio around the plugin calls.
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
    // [top, right, bottom, left] in CSS px. The precip-label boxes are
    // centred on the PrecipAxis-0 line, so the bottom pad keeps their
    // lower half inside the canvas; the two-line box (#288) adds
    // `extraBottomPad`.
    padding: [4, 0, 14 + (opts.extraBottomPad ?? 0), 0],
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
    renderData: data,
    update(): void {
      // Must run BEFORE setData: the range closures read scaleState live,
      // so the fresh ceiling applies on that redraw. Reads
      // dataBag.datasets, the arrays toAlignedData feeds to uPlot.
      refreshYScaleState(
        scaleState,
        datasets.map((ds, i) => ({ yAxisID: ds.yAxisID, data: dataBag.datasets[i]?.data ?? [] })),
        precipFloor,
        bottomReserve,
        topReserve,
      );
      const splitDatasets = dataBag.datasets.map((d, i) => ({
        data: d.data,
        type: datasets[i].type,
      }));
      const aligned = toAlignedData(dataBag.labels, splitDatasets, stationCount, hasBothBlocks, opts.isHourly);
      uplot.setData(aligned);
    },
    reset(): void {
      // No-op: uPlot has no animation to reset; main.ts still calls it.
    },
    destroy(): void {
      try { uplot.destroy(); } catch { /* already gone */ }
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
      // Scroll events can repeat the same position (momentum end, clamps).
      if (Math.abs(min - win.min) < 1e-3) return;
      win.min = min;
      uplot.setScale('x', { min, max: min + win.span });
    },
  };

  return instance;
}
