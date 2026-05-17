// Returns the CSS string for the card's <style> block. Pulled out of the
// main render() template so render() stays readable. The handful of
// values that depend on config (icon sizes, font sizes, chart height) are
// passed in explicitly — the function is otherwise pure.
//
// Adding a new style rule that *only* references CSS variables (no
// JS-side values) is fine to add inline here. Adding one that needs a new
// runtime value means adding it to the parameter list.
export interface CardStylesOpts {
  iconsSize: number;
  currentTempSize: number;
  timeSize: number;
  dayDateSize: number;
  chartHeight: number;
  titlePresent: boolean;
  labelsSmallSize: number;
  labelsBaseSize: number;
}

export function cardStyles({
  iconsSize,
  currentTempSize,
  timeSize,
  dayDateSize,
  chartHeight,
  titlePresent,
  labelsSmallSize,
  labelsBaseSize,
}: CardStylesOpts): string {
  return `
    ha-icon {
      color: var(--paper-item-icon-color);
    }
    img {
      width: ${iconsSize}px;
      height: ${iconsSize}px;
    }
    .card {
      padding-top: ${titlePresent ? '0px' : '16px'};
      padding-right: 16px;
      padding-bottom: 16px;
      padding-left: 16px;
    }
    .main {
      display: flex;
      align-items: center;
      font-size: ${currentTempSize}px;
      margin-bottom: 10px;
    }
    .main ha-icon {
      --mdc-icon-size: 50px;
      margin-right: 14px;
      margin-inline-start: initial;
      margin-inline-end: 14px;
    }
    .main img {
      width: ${iconsSize * 2}px;
      height: ${iconsSize * 2}px;
      margin-right: 14px;
      margin-inline-start: initial;
      margin-inline-end: 14px;
    }
    .main div {
      line-height: 0.9;
    }
    .main span {
      font-size: 18px;
      color: var(--secondary-text-color);
    }
    .attributes {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-weight: 300;
      direction: ltr;
    }
    /* Scroll block — .forecast-scroll-block is the relative parent that
     * positions the side indicators; .forecast-scroll inside it is the
     * actual overflow:auto viewport. Native scrollbars are hidden across
     * desktop and mobile; navigation happens via the indicator buttons,
     * mouse drag on the graph (desktop), or native touch swipe (mobile). */
    .forecast-scroll-block {
      position: relative;
      width: 100%;
    }
    .forecast-scroll {
      width: 100%;
    }
    .forecast-scroll.scrolling {
      overflow-x: auto;
      overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none; /* Firefox */
      cursor: grab;
    }
    .forecast-scroll.scrolling::-webkit-scrollbar {
      display: none; /* WebKit / Blink */
    }
    .forecast-scroll.scrolling.dragging {
      cursor: grabbing;
      user-select: none;
    }
    .scroll-indicator {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      color: var(--primary-text-color);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 2;
      opacity: 0.9;
      padding: 0;
      transition: opacity 120ms ease;
    }
    .scroll-indicator:hover {
      opacity: 1;
    }
    .scroll-indicator[hidden] {
      display: none;
    }
    /* Negative inset shifts the indicator about half its diameter past
     * the chart edge, into the .card's horizontal padding. That keeps
     * the temperature / date labels at the leftmost/rightmost bars
     * uncovered while still having the indicator sit visually on the
     * card. -16px would land flush with the ha-card outer edge. */
    .scroll-indicator-left { left: -14px; }
    .scroll-indicator-right { right: -14px; }
    /* Mode-toggle (daily↔hourly) and jump-to-now — overlaid on the
     * forecast-scroll-block at the precipitation-baseline level (near
     * the chart's bottom edge). Out of the way of the .scroll-date
     * overlays at the top of the chart, and visually aligned with the
     * precip labels. Vertical centring uses chartHeight - 15 so the
     * 30 px button sits centred on Chart.js's precip-axis 0-line
     * (chartArea.bottom ≈ chartHeight - 10 due to layout.padding.bottom). */
    .mode-toggle, .jump-to-now {
      position: absolute;
      top: ${chartHeight - 30}px;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      color: var(--primary-text-color);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 3;
      opacity: 0.9;
      padding: 0;
      transition: opacity 120ms ease;
    }
    .mode-toggle:hover, .jump-to-now:hover { opacity: 1; }
    .mode-toggle ha-icon, .jump-to-now ha-icon { --mdc-icon-size: 18px; }
    .mode-toggle { left: -14px; }
    .jump-to-now {
      left: 50%;
      transform: translateX(-50%);
    }
    .jump-to-now[hidden] { display: none; }
    /* Edge date stamps at hourly: which day are the leftmost / rightmost
     * visible bars on. Styled to match the chart's own midnight-tick
     * date marker (plain text in --secondary-text-color, no pill or
     * background) so an edge "May 5" reads as the same kind of label
     * as the "May 6" over the 00:00 tick mid-chart. pointer-events:none
     * keeps clicks falling through to the chart. */
    .scroll-date {
      position: absolute;
      top: 2px;
      font-size: ${labelsBaseSize || 11}px;
      color: var(--secondary-text-color);
      z-index: 1;
      pointer-events: none;
      white-space: nowrap;
      /* JS sets the inline left style per element to the pixel centre
       * of the leftmost (or rightmost) visible tick; translateX centres
       * the text on that point so the overlay reads as the same kind
       * of label as the chart's "May 6" sitting above its 00:00 tick. */
      transform: translateX(-50%);
    }
    .scroll-date[hidden] { display: none; }
    .scroll-indicator ha-icon {
      --mdc-icon-size: 22px;
    }
    .chart-container {
      position: relative;
      height: ${chartHeight}px;
      width: 100%;
      direction: ltr;
    }
    /* Placeholder rendered while the data sources are still firing
     * their first callbacks. Keeps the chart-row height stable so the
     * page doesn't reflow when data lands. Inner <svg> draws a static
     * axis-frame (top baseline + N evenly-spaced vertical gridlines)
     * so the user reads "chart on the way" rather than "card broken".
     * The grid is non-interactive and disappears the moment the real
     * chart commits — single swap, no fade. */
    .forecast-loading {
      width: 100%;
    }
    .forecast-skeleton {
      display: block;
      width: 100%;
    }
    .forecast-skeleton-axis,
    .forecast-skeleton-grid {
      stroke: var(--divider-color, rgba(127, 127, 127, 0.3));
      stroke-width: 1;
      shape-rendering: crispEdges;
    }
    .conditions {
      display: flex;
      justify-content: space-around;
      align-items: center;
      margin: 0px 5px 0px 5px;
      cursor: pointer;
    }
    .forecast-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 1px;
    }
    .wind-details {
      display: flex;
      justify-content: space-around;
      align-items: flex-start;
      font-weight: 300;
    }
    /* Each per-day wind cell. flex-wrap lets the speed (.wind-value) drop
     * onto a second line when the column is too narrow to fit it next to
     * the arrow — keeps narrow charts readable without truncating. */
    .wind-detail {
      display: flex;
      flex: 1 1 0;
      min-width: 0;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 2px;
      margin: 1px;
    }
    .wind-detail ha-icon {
      --mdc-icon-size: 15px;
    }
    .wind-icon {
      position: relative;
      bottom: 1px;
    }
    /* Speed + unit travel together as one wrap unit so the unit doesn't
     * split off from its number on narrow columns. */
    .wind-value {
      display: inline-flex;
      align-items: center;
      gap: 1px;
      white-space: nowrap;
    }
    .wind-speed {
      font-size: 11px;
    }
    .wind-unit {
      font-size: ${labelsSmallSize}px;
    }
    .current-time {
      position: absolute;
      top: 20px;
      right: 16px;
      inset-inline-start: initial;
      inset-inline-end: 16px;
      font-size: ${timeSize}px;
    }
    .date-text {
      font-size: ${dayDateSize}px;
      color: var(--secondary-text-color);
    }
  `;
}
