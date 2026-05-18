// Shared types for the Chart.js plugin factories under chart/plugins/.
// Each plugin sits in its own file (#57 split — was previously the
// 600-line monolith chart/plugins.ts with dailyTickLabels at cog 46).
//
// Why the types live in one file rather than per-plugin: every plugin
// reads from the same Chart.js context (the per-tick scale, the
// canvas, chartArea). Inlining the shapes per plugin would duplicate
// ~50 lines × 4 plugins. The shared file keeps the structural
// inheritance (ChartLike → afterDraw) legible and lets the unit
// tests mock once.

/** Subset of the Chart.js Scale we touch. Avoids a chart.js type
 *  import (Chart 4 has its own typings but they require resolving the
 *  whole `Chart<...>` generic, which is unnecessary noise for plugin
 *  authoring at this layer). */
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

/** Subset of the Chart instance we use from inside plugins. The
 *  generic `data` field is intentionally untyped — the `data` prop our
 *  plugins read from is the per-render bag we passed in from the
 *  factory, not Chart.js's internal data. */
export interface ChartLike {
  scales: { x?: ChartScaleLike; PrecipAxis?: ChartScaleLike } & Record<string, ChartScaleLike | undefined>;
  ctx: CanvasRenderingContext2D;
  chartArea: { top: number; bottom: number; left: number; right: number };
  /** The DOM canvas the chart renders into. Plugins use it to walk up
   *  to the horizontal-scroll wrapper (`.forecast-scroll.scrolling`)
   *  for hourly mode so they can react to the user's scroll position. */
  canvas?: HTMLCanvasElement | null;
  getDatasetMeta(idx: number): ChartMetaLike | null;
}

/** A Chart.js plugin object — a subset that matches the four plugins
 *  exported from this module. Chart.js will accept extra fields like
 *  `id`, but the typed surface here is only what we use. */
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
