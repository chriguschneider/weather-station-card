// Barrel re-export for the Chart.js plugin factories. The factories
// themselves live one file per plugin under chart/plugins/ — see
// the header comment in each file for the rendering contract.

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
