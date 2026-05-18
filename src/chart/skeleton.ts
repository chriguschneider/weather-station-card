// Loading placeholder rendered in place of the chart while data
// sources are still firing their first callbacks. Reserves the same
// vertical space as the eventual chart so the swap doesn't reflow.
// Visual content is a moving shimmer sweep (CSS, on the wrapper's
// ::after pseudo) — no gridline / axis structure, since that mental
// model didn't match the real chart's geometry and made the swap
// visually jarring. The motion alone is enough of a "loading" signal.

import { html, type TemplateResult } from 'lit';

export interface SkeletonOpts {
  chartHeight: number;
  /** Kept on the public surface for backwards compatibility with the
   *  axis-frame variant; the shimmer placeholder ignores it (no
   *  per-column structure to mirror). */
  visibleBars?: number;
}

export function renderChartSkeleton({ chartHeight }: SkeletonOpts): TemplateResult {
  return html`
    <div
      class="forecast-skeleton-wrapper"
      style="height: ${chartHeight}px"
      role="presentation"
      aria-hidden="true"
    ></div>
  `;
}
