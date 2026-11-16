// Shared types for the plugin factories under chart/plugins/: the
// Chart.js-shaped context that `chart/draw.ts` builds around uPlot
// (ADR-0012). One file so every plugin and its unit-test mocks use the
// same shapes.

/** Subset of a Chart.js-style scale: tick geometry and value-to-pixel
 *  lookup, as synthesised by the shim in `chart/draw.ts`. */
export interface ChartScaleLike {
  ticks: Array<{ value?: number; label?: string }>;
  top: number;
  bottom: number;
  width: number;
  getPixelForTick(idx: number): number;
  getPixelForValue?(value: number): number;
}

/** Subset of a Chart.js dataset bar element. */
export interface ChartBarLike {
  x: number;
  y: number;
  options?: { borderColor?: string };
}

/** Subset of a Chart.js dataset metadata object. */
export interface ChartMetaLike {
  data?: ChartBarLike[];
}

/** The chart surface plugins draw on: scales, 2D context, plot-area
 *  rectangle and per-dataset geometry. */
export interface ChartLike {
  scales: { x?: ChartScaleLike; PrecipAxis?: ChartScaleLike } & Record<string, ChartScaleLike | undefined>;
  ctx: CanvasRenderingContext2D;
  chartArea: { top: number; bottom: number; left: number; right: number };
  /** The DOM canvas the chart renders into. */
  canvas?: HTMLCanvasElement | null;
  getDatasetMeta(idx: number): ChartMetaLike | null;
}

/** A plugin: an id plus the draw hooks `chart/draw.ts` calls. */
export interface ChartPlugin {
  id: string;
  afterDraw?(chart: ChartLike): void;
  afterDatasetsDraw?(chart: ChartLike): void;
}

/** CSS-style accessor — typically a `getComputedStyle()` result, but
 *  any object with a `getPropertyValue` works. */
export interface CssStyleLike {
  getPropertyValue(name: string): string;
}

/** Per-render data bag the plugins read column-aligned values from.
 *  All arrays are positional (one entry per chart x-tick). */
export interface PluginRenderData {
  dateTime?: ReadonlyArray<string | undefined>;
  precip?: ReadonlyArray<number | null | undefined>;
  sunshine?: ReadonlyArray<number | null | undefined> | null;
  /** Chance of rain per column, 0..100. `null`/absent when the
   *  `show_precip_probability` row is off — the precip pill then keeps
   *  its one-line amount-only form. */
  precipProb?: ReadonlyArray<number | null | undefined> | null;
}

/** Subset of the card config the plugins read. Loosely typed because
 *  the full card-config typing (which has the editor's hierarchical
 *  shape) is out of scope at this layer. */
export interface PluginCardConfig {
  forecast: {
    type?: 'daily' | 'hourly' | 'today';
    show_date?: boolean;
    labels_font_size?: number | string;
    chart_datetime_color?: string;
  };
  [k: string]: unknown;
}
