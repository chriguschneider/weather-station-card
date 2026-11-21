// CSS string for the card's <style> block. Pure: config-dependent values
// (icon / font sizes, chart height) arrive through CardStylesOpts.
export interface CardStylesOpts {
  iconsSize: number;
  currentTempSize: number;
  timeSize: number;
  dayDateSize: number;
  chartHeight: number;
  titlePresent: boolean;
  labelsSmallSize: number;
  labelsBaseSize: number;
  /** Extra chart bottom padding the two-line precip box adds (#288);
   *  the mode-toggle / jump-to-now buttons follow the baseline up. */
  extraBottomPad?: number;
}

// render() calls this on every pass while the nine inputs only change on a
// config edit, so memoize per input combination. The cap is a leak guard
// for long editor sessions.
const styleCache = new Map<string, string>();
const STYLE_CACHE_MAX = 8;

export function cardStyles(opts: CardStylesOpts): string {
  const key = [
    opts.iconsSize, opts.currentTempSize, opts.timeSize, opts.dayDateSize,
    opts.chartHeight, opts.titlePresent, opts.labelsSmallSize, opts.labelsBaseSize,
    opts.extraBottomPad ?? 0,
  ].join('|');
  const hit = styleCache.get(key);
  if (hit !== undefined) return hit;
  const css = buildCardStyles(opts);
  if (styleCache.size >= STYLE_CACHE_MAX) {
    styleCache.delete(styleCache.keys().next().value as string);
  }
  styleCache.set(key, css);
  return css;
}

function buildCardStyles({
  iconsSize,
  currentTempSize,
  timeSize,
  dayDateSize,
  chartHeight,
  titlePresent,
  labelsSmallSize,
  labelsBaseSize,
  extraBottomPad = 0,
}: CardStylesOpts): string {
  return `
    ha-icon {
      /* Not --paper-item-icon-color / --state-icon-color: they resolve to
       * a muted blue on HA's default theme. */
      color: var(--primary-text-color, #212121);
    }
    .conditions .wsc-icon,
    .conditions ha-icon {
      --mdc-icon-size: ${iconsSize}px;
    }
    /* .card is the query container for the @container rules at the end
     * of this sheet: a narrow HA grid slot (Companion app, mobile
     * summary card) sits in a wide viewport, so the responsive rules
     * must key off the card's own width. */
    .card {
      container-type: inline-size;
      container-name: wsc-card;
      padding-top: ${titlePresent ? '0px' : '16px'};
      padding-right: 16px;
      padding-bottom: 16px;
      padding-left: 16px;
    }
    .main {
      position: relative;
      display: flex;
      align-items: center;
      font-size: ${currentTempSize}px;
      margin-bottom: 10px;
    }
    .main ha-icon {
      --mdc-icon-size: ${iconsSize * 2}px;
      margin-right: 14px;
      margin-inline-start: initial;
      margin-inline-end: 14px;
    }
    .main div {
      line-height: 0.9;
    }
    .main span:not(.wsc-entity-link) {
      font-size: 18px;
      color: var(--secondary-text-color, #727272);
    }
    .attributes {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-weight: 300;
      direction: ltr;
    }
    /* Availability hint (#213): one slim neutral row; the overdue variant
     * tints the icon with the warning colour. .wsc-stale dims the live
     * panel while values come from the last-known-good fallback. */
    .wsc-availability {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 2px 8px 4px 8px;
      font-size: 12px;
      color: var(--secondary-text-color, #727272);
    }
    .wsc-availability ha-icon {
      --mdc-icon-size: 16px;
      color: var(--secondary-text-color, #727272);
    }
    .wsc-availability-overdue ha-icon {
      color: var(--warning-color, #ffa600);
    }
    .wsc-stale {
      opacity: 0.65;
      transition: opacity 0.3s ease;
    }
    /* Clickable entity values open the sensor's more-info dialog.
     * color:inherit lets icons follow the hover colour (the base ha-icon
     * rule pins them otherwise). role="button" keeps these spans out of
     * the card-level tap_action (isCardControl in action-handler.ts). */
    .wsc-entity-link {
      cursor: pointer;
    }
    .wsc-entity-link:hover {
      color: var(--primary-color, #03a9f4);
    }
    .wsc-entity-link:hover ha-icon {
      color: inherit;
    }
    .wsc-entity-link:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
      border-radius: 4px;
    }
    /* Info button (show_sources, ADR-0031): warning colour when a
     * configured sensor is down. The .main selectors outrank the 50 px
     * condition-glyph rule above. */
    .wsc-sources-info {
      display: inline-flex;
      vertical-align: middle;
      margin-inline-start: 6px;
      line-height: 1;
    }
    .main .wsc-sources-info ha-icon,
    .wsc-sources-info ha-icon {
      --mdc-icon-size: 20px;
      margin: 0;
      color: var(--secondary-text-color, #727272);
    }
    .main .wsc-sources-info.wsc-sources-alert ha-icon,
    .wsc-sources-info.wsc-sources-alert ha-icon {
      color: var(--warning-color, #ff9800);
    }
    .wsc-sources-info .wsc-entity-link:hover ha-icon,
    .wsc-sources-info .wsc-entity-link:focus-visible ha-icon {
      color: var(--primary-text-color, #212121);
    }
    .wsc-sources-info .wsc-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    /* Live panel: top-right corner of .main's inner block, the clock's
     * containing block; the clock moves left by one icon width. */
    .wsc-sources-corner {
      position: absolute;
      top: 4px;
      inset-inline-end: 0;
      margin: 0;
      z-index: 2;
    }
    .wsc-sources-corner ~ .current-time {
      inset-inline-end: 28px;
    }
    /* Live block hidden: sit right of the mode toggle on its baseline,
     * or in its place when the toggle is off. */
    .wsc-sources-chart {
      position: absolute;
      top: ${chartHeight - 30 - extraBottomPad}px;
      left: 20px;
      height: 30px;
      align-items: center;
      margin: 0;
      z-index: 3;
    }
    .wsc-sources-chart-alone { left: -10px; }
    /* .forecast-scroll-block positions the side indicators;
     * .forecast-scroll inside it is the overflow:auto viewport with its
     * native scrollbar hidden. */
    .forecast-scroll-block {
      position: relative;
      width: 100%;
    }
    /* Start animation: plays once per session, guarded by
     * _chartMountAnimationPlayed so a remount after a data refetch does
     * not replay it. */
    .forecast-scroll-block.first-mount {
      animation: ws-chart-fadein 420ms ease-out both;
    }
    @keyframes ws-chart-fadein {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    /* Cross-fade on a forecast.type toggle. Opacity hits 0 at 50% so
     * the chart redraws while invisible. */
    .forecast-scroll-block.view-changing {
      animation: ws-view-change 360ms ease-in-out both;
    }
    @keyframes ws-view-change {
      0%   { opacity: 1; }
      50%  { opacity: 0; }
      100% { opacity: 1; }
    }
    .forecast-scroll-block.no-animation,
    .forecast-scroll-block.no-animation.first-mount,
    .forecast-scroll-block.no-animation.view-changing {
      animation: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .forecast-scroll-block.first-mount,
      .forecast-scroll-block.view-changing { animation: none; }
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
      background: var(--card-background-color, #fff);
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      color: var(--primary-text-color, #212121);
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
    /* Touch target: a transparent ::before grows the 30 px circle's hit
     * area to 44 px without changing what is painted. */
    .scroll-indicator::before,
    .mode-toggle::before,
    .jump-to-now::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 44px;
      height: 44px;
      transform: translate(-50%, -50%);
    }
    .scroll-indicator[hidden] {
      display: none;
    }
    /* The negative inset pushes the indicator into the .card padding so
     * it does not cover the labels at the outermost bars. */
    .scroll-indicator-left { left: -14px; }
    .scroll-indicator-right { right: -14px; }
    /* Mode-toggle and jump-to-now sit on the precip baseline, centred on
     * it: the plot's bottom padding is 14 px (draw.ts), and the
     * two-line precip box raises the baseline by extraBottomPad. */
    .mode-toggle, .jump-to-now {
      position: absolute;
      top: ${chartHeight - 30 - extraBottomPad}px;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--card-background-color, #fff);
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      color: var(--primary-text-color, #212121);
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
    /* Scroll timeline: one segment per calendar day, a translucent thumb
     * marks the visible section (positioned from scroll-ux).
     * touch-action:none so a drag never becomes a page scroll. */
    .scroll-timeline {
      position: relative;
      height: 18px;
      margin: 6px 2px 0 2px;
      border-radius: 4px;
      background: transparent;
      overflow: hidden;
      cursor: pointer;
      touch-action: none;
      user-select: none;
    }
    .scroll-timeline .tl-seg {
      position: absolute;
      top: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-left: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      pointer-events: none;
    }
    .scroll-timeline .tl-seg:first-child {
      border-left: none;
    }
    .scroll-timeline .tl-seg-label {
      font-size: 9px;
      line-height: 1;
      color: var(--secondary-text-color, #727272);
      white-space: nowrap;
    }
    .scroll-timeline .tl-seg.tl-today .tl-seg-label {
      font-weight: 700;
      color: var(--primary-text-color, #212121);
    }
    .scroll-timeline .tl-thumb {
      position: absolute;
      top: 0;
      bottom: 0;
      border-radius: 4px;
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 22%, transparent);
      box-sizing: border-box;
      pointer-events: none;
    }
    .scroll-indicator ha-icon {
      --mdc-icon-size: 22px;
    }
    .chart-container {
      position: relative;
      height: ${chartHeight}px;
      width: 100%;
      direction: ltr;
    }
    /* uPlot chart target (ADR-0012): uPlot measures it at construction,
     * so it must fill .chart-container. The bare layout rules below stack
     * uPlot's layers; uPlot.min.css is deliberately not imported because
     * its .uplot min-content width collapses our flex container. */
    #forecastChart {
      width: 100%;
      height: 100%;
      position: relative;
    }
    #forecastChart .u-wrap {
      position: relative;
    }
    #forecastChart .u-over,
    #forecastChart .u-under {
      position: absolute;
    }
    #forecastChart .u-under {
      overflow: hidden;
    }
    #forecastChart .u-axis {
      position: absolute;
    }
    /* uPlot sets the canvas width/height attributes (pxRatio x size) but
     * no CSS size, so pin it to the container. */
    #forecastChart canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    /* Placeholder until the first data arrives; keeps the chart row at
     * its final height so the page does not reflow. */
    .forecast-loading {
      width: 100%;
    }
    .forecast-skeleton-wrapper {
      position: relative;
      width: 100%;
      overflow: hidden;
    }
    /* Shimmer sweep; animates only background-position so it stays
     * compositor-only. The 50% stop is a theme-agnostic mid-grey at 0.04
     * alpha (a faint lighten on dark, darken on light); no HA token is
     * that faint (--divider-color is far too opaque), hence the literal. */
    .forecast-skeleton-wrapper::after {
      content: '';
      position: absolute;
      inset: 0;
      background-image: linear-gradient(
        0deg,
        transparent 0%,
        rgba(127, 127, 127, 0.04) 50%,
        transparent 100%
      );
      background-size: 100% 40%;
      background-repeat: no-repeat;
      background-position: 0 130%;
      animation: ws-skeleton-shimmer 2.4s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes ws-skeleton-shimmer {
      0%   { background-position: 0 130%; }
      100% { background-position: 0 -40%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .forecast-skeleton-wrapper::after { animation: none; }
    }
    /* In-bundle icon sprite (ADR-0018). .wsc-icon mirrors ha-icon's box
     * and colour rule so sprite icons match the remaining ha-icons. */
    .wsc-sprite {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
    }
    .wsc-icon {
      display: inline-flex;
      width: var(--mdc-icon-size, 24px);
      height: var(--mdc-icon-size, 24px);
      vertical-align: middle;
      fill: currentColor;
      color: var(--primary-text-color, #212121);
    }
    /* Computed moon disc (ADR-0022), same box as .wsc-icon. The disc is
     * white/black in both themes; only the outline follows the colour
     * below, so the edge stays visible on any background. */
    .wsc-moon {
      display: inline-flex;
      width: var(--mdc-icon-size, 24px);
      height: var(--mdc-icon-size, 24px);
      vertical-align: middle;
      color: var(--primary-text-color, #212121);
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
      flex: 1 1 0;
      min-width: 0;
      margin: 1px;
    }
    .wind-details {
      display: flex;
      justify-content: space-around;
      align-items: flex-start;
      font-weight: 300;
    }
    /* flex-wrap lets .wind-value drop below the arrow on a narrow column. */
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
    .wind-detail ha-icon,
    .wind-detail .wsc-icon {
      --mdc-icon-size: 15px;
    }
    .wind-icon {
      position: relative;
      bottom: 1px;
    }
    /* Speed and unit wrap as one unit. */
    .wind-value {
      display: inline-flex;
      align-items: center;
      gap: 1px;
      white-space: nowrap;
    }
    .wind-speed {
      font-size: 11px;
      text-align: end;
      font-variant-numeric: tabular-nums;
    }
    .wind-unit {
      font-size: ${labelsSmallSize}px;
    }
    .current-time {
      position: absolute;
      top: 4px;
      inset-inline-start: initial;
      inset-inline-end: 0;
      font-size: ${timeSize}px;
    }
    .date-text {
      font-size: ${dayDateSize}px;
      color: var(--secondary-text-color, #727272);
    }

    /* Narrow-width reflow. Additive: it applies only when .card is
     * narrower than the breakpoint, so the wide layout is unchanged.
     *   <=360px: phone-width slot; tighter padding, smaller live panel,
     *            attribute groups wrap.
     *   <=280px: very tight slot; the clock stacks under the temperature. */
    @container wsc-card (max-width: 360px) {
      /* Halved side padding; the -14px indicator insets still land
       * inside the card edge. */
      .card {
        padding-right: 8px;
        padding-left: 8px;
      }
      /* Scale the glyph and temperature down ~15% so the temperature
       * keeps its space. */
      .main {
        font-size: ${Math.round(currentTempSize * 0.85)}px;
      }
      .main ha-icon {
        --mdc-icon-size: ${Math.round(iconsSize * 1.5)}px;
        margin-inline-end: 10px;
      }
      .main span:not(.wsc-entity-link) {
        font-size: 15px;
      }
      /* Only shrink the clock so it clears the condition text; the base
       * right:0 already lines up with the content edge. */
      .current-time {
        font-size: ${Math.round(timeSize * 0.8)}px;
      }
      .date-text {
        font-size: ${Math.max(10, Math.round(dayDateSize * 0.85))}px;
      }
      /* Wrap the attribute groups instead of squeezing them. */
      .attributes {
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 13px;
      }
      /* The zero-degree trend row keeps the time of its target and
       * drops the weekday (#333). */
      .wsc-zd-day {
        display: none;
      }
      /* Smaller timeline labels and wind units fit narrow columns. */
      .scroll-timeline .tl-seg-label {
        font-size: ${Math.max(8, (labelsBaseSize || 11) - 3)}px;
      }
      .wind-speed {
        font-size: 10px;
      }
    }

    @container wsc-card (max-width: 280px) {
      /* The absolute clock would overlap the temperature here, so put it
       * in normal flow beneath it. */
      .current-time {
        position: static;
        margin-top: 4px;
        text-align: left;
      }
      .attributes {
        /* Start-aligned so wrapped groups do not spread across the row. */
        justify-content: flex-start;
      }
    }
  `;
}
