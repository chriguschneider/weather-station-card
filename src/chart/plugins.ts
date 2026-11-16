// Barrel for the plugin factories under chart/plugins/. They draw
// against the `ChartLike` shim that `chart/draw.ts` builds around uPlot
// (ADR-0012).

export type {
  ChartScaleLike,
  ChartBarLike,
  ChartMetaLike,
  ChartLike,
  ChartPlugin,
  CssStyleLike,
  PluginRenderData,
  PluginCardConfig,
} from './plugins/_shared.js';

export {
  createSeparatorPlugin,
  type SeparatorPluginOpts,
} from './plugins/separator.js';

export {
  createDailyTickLabelsPlugin,
  type DailyTickLabelsPluginOpts,
} from './plugins/daily-tick-labels.js';

export {
  createPrecipLabelPlugin,
  PROBABILITY_ONLY_MIN,
  PROBABILITY_EXTRA_BOTTOM_PAD,
  type PrecipLabelPluginOpts,
} from './plugins/precip-label.js';

export {
  createSunshineLabelPlugin,
  type SunshineLabelPluginOpts,
} from './plugins/sunshine-label.js';

export {
  createTempLabelsPlugin,
  type TempLabelsPluginOpts,
} from './plugins/temp-labels.js';
