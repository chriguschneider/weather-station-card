// Loading placeholder shown until the first data arrives. Reserves the
// chart's height so the swap doesn't reflow; the shimmer sweep is CSS
// on the wrapper's ::after.

import { html, type TemplateResult } from 'lit';

export interface SkeletonOpts {
  chartHeight: number;
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
