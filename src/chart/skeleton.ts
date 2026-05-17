// Axis-frame placeholder rendered in place of the chart canvas while
// the data sources are still firing their first callbacks. The
// previous loading state was an empty div (height-reserved, no
// content) — this one shows gridline structure so the user reads
// "chart is on the way" rather than "card is broken". Sized from
// `chart_height` + `forecast.number_of_forecasts` so the dimensions
// match the eventual chart and the swap doesn't reflow.

import { html, svg, type TemplateResult, type SVGTemplateResult } from 'lit';

export interface SkeletonOpts {
  chartHeight: number;
  visibleBars: number;
}

// `visibleBars` is `forecast.number_of_forecasts`; when 0 (auto-fit
// from container width) we don't yet know the real count, so fall
// back to 8 — close to a typical week's forecast and visually
// recognisable as gridlines regardless of the eventual width.
const FALLBACK_COLUMNS = 8;

// Top band reserved for axis tick labels (weekday/date). Chart.js
// renders its x-axis at `position: 'top'` (see src/chart/draw.ts);
// the band keeps the skeleton's data-area aligned with where the
// real chart's columns will sit.
const LABEL_BAND_PX = 28;

export function renderChartSkeleton({ chartHeight, visibleBars }: SkeletonOpts): TemplateResult {
  const cols = visibleBars > 0 ? visibleBars : FALLBACK_COLUMNS;
  // Nested templates MUST use the `svg` tag (not `html`) so Lit
  // creates elements in the SVG namespace. With `html`, the <line>
  // is parsed as an unknown HTML element and renders nothing —
  // exactly what bit us between v1.13 + Slice 1's first deploy:
  // the inline axis line (in the outer html`<svg>...</svg>`)
  // showed up because HTML5 parser handles foreign content for
  // inline <svg>, but the array of `${gridlines}` was created with
  // html`` outside that context and lost the namespace.
  const gridlines: SVGTemplateResult[] = [];
  for (let i = 1; i < cols; i++) {
    const xPct = (i / cols) * 100;
    gridlines.push(svg`<line
      class="forecast-skeleton-grid"
      x1="${xPct}%" y1="${LABEL_BAND_PX}"
      x2="${xPct}%" y2="${chartHeight}"
    ></line>`);
  }
  return html`
    <svg
      class="forecast-skeleton"
      width="100%"
      height="${chartHeight}"
      role="presentation"
      aria-hidden="true"
    >
      <line
        class="forecast-skeleton-axis"
        x1="0" y1="${LABEL_BAND_PX}"
        x2="100%" y2="${LABEL_BAND_PX}"
      ></line>
      ${gridlines}
    </svg>
  `;
}
