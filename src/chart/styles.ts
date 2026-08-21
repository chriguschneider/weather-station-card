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

// The generated sheet is ~10 KB of string concatenation and render()
// calls this on every pass, while the eight inputs only change on a
// config edit. Memoize per input-combination; the map stays tiny (one
// entry per distinct card config on the dashboard) but is capped as a
// leak guard for pathological editor sessions.
const styleCache = new Map<string, string>();
const STYLE_CACHE_MAX = 8;

export function cardStyles(opts: CardStylesOpts): string {
  const key = [
    opts.iconsSize, opts.currentTempSize, opts.timeSize, opts.dayDateSize,
    opts.chartHeight, opts.titlePresent, opts.labelsSmallSize, opts.labelsBaseSize,
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
}: CardStylesOpts): string {
  return `
    ha-icon {
      /* Icons follow the card's primary text colour. The legacy
       * --paper-item-icon-color / --state-icon-color tokens resolve to a
       * muted blue (#44739e) on HA's default theme — chaining through
       * them (as v2.0.0 did) painted every icon blue. --primary-text-color
       * keeps the icons consistent with the card text and the rest of
       * the HA UI, and still follows a custom theme. */
      color: var(--primary-text-color, #212121);
    }
    img {
      width: ${iconsSize}px;
      height: ${iconsSize}px;
    }
    /* container-type: inline-size makes .card itself the query
     * container for the @container rules at the end of this sheet.
     * The card lives inside HA's grid — in a Companion-app column or
     * the 2026.1 mobile summary-card slot its host can be ~280-360px
     * wide while the viewport is a wide desktop, so the responsive
     * rules must key off the card's OWN width, not the viewport.
     * inline-size containment only contains the inline (width) axis;
     * height is untouched, and a block-level element filling its
     * parent already takes its width from that parent — so this has
     * no standalone visual effect on the wide layout. */
    .card {
      container-type: inline-size;
      container-name: wsc-card;
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
    /* Clickable entity values (live panel + attribute rows): each
     * opens the backing sensor's more-info dialog. Cursor + hover tint
     * mirror the affordance of HA's entities card; icons follow the
     * hover colour via color:inherit (the base ha-icon rule above pins
     * them to --primary-text-color otherwise). role="button" on these
     * spans also excludes them from the card-level tap_action — see
     * isCardControl in action-handler.ts. */
    /* Availability hint (issue #213): one slim neutral row instead of
     * the former red banner when sensors are unavailable. The overdue
     * variant tints the icon with the warning colour; the in-grace
     * variant stays secondary-text neutral. .wsc-stale dims the live
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
    /* Scroll block — .forecast-scroll-block is the relative parent that
     * positions the side indicators; .forecast-scroll inside it is the
     * actual overflow:auto viewport. Native scrollbars are hidden across
     * desktop and mobile; navigation happens via the indicator buttons,
     * mouse drag on the graph (desktop), or native touch swipe (mobile). */
    .forecast-scroll-block {
      position: relative;
      width: 100%;
    }
    /* Start animation — fires once on the very first time the chart
     * block reaches the DOM in this session. Class is added by the
     * render() template based on _chartMountAnimationPlayed. Without
     * this guard, a view-change that triggers a data refetch
     * (daily↔hourly cache miss) would unmount and remount the block,
     * replaying the start animation every time the user toggles. */
    .forecast-scroll-block.first-mount {
      animation: ws-chart-fadein 420ms ease-out both;
    }
    @keyframes ws-chart-fadein {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    /* View-change cross-fade: applied when the user toggles
     * forecast.type (daily ↔ today ↔ hourly). For the cached case
     * (no refetch, block stays in DOM) main.ts.updated() restarts
     * this via a classList remove → reflow → add. For the remount
     * case (cache miss, block tore down) the template applies it on
     * the fresh mount via the animation-class field, so the new chart
     * fades in instead of replaying the start animation. Opacity dips
     * to 0 at 50% so the chart redraws during the invisible window. */
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
    /* Touch-target expansion. The visible control stays a 30 px circle
     * (unchanged design language), but a transparent ::before stretches
     * the clickable area to ~44 px square — the platform-recommended
     * minimum for a comfortable finger tap. Centred on the button,
     * non-painting, so it adds hit area without shifting any pixel of
     * the rendered card. */
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
    /* Negative inset shifts the indicator about half its diameter past
     * the chart edge, into the .card's horizontal padding. That keeps
     * the temperature / date labels at the leftmost/rightmost bars
     * uncovered while still having the indicator sit visually on the
     * card. -16px would land flush with the ha-card outer edge. */
    .scroll-indicator-left { left: -14px; }
    .scroll-indicator-right { right: -14px; }
    /* Mode-toggle (daily↔hourly) and jump-to-now — overlaid on the
     * forecast-scroll-block at the precipitation-baseline level (near
     * the chart's bottom edge). Out of the way of the chart's own
     * date labels at the top, and visually aligned with the
     * precip labels. Vertical centring uses chartHeight - 15 so the
     * 30 px button sits centred on Chart.js's precip-axis 0-line
     * (chartArea.bottom ≈ chartHeight - 10 due to layout.padding.bottom). */
    .mode-toggle, .jump-to-now {
      position: absolute;
      top: ${chartHeight - 30}px;
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
    /* NOTE (2026-08): the former .scroll-date edge stamps were removed
     * — the scroll timeline below the chart carries the day context
     * now, and the stamps collided visually with the canvas's own
     * midnight boundary dates. */
    /* Scroll timeline / minimap (2026-08): slim track below the chart
     * in the scrolling hourly-ish modes. One segment per calendar day,
     * a translucent thumb marks the visible section (positioned
     * imperatively from scroll-ux on every scroll frame). Click /
     * scrub navigates; touch-action:none so a drag on the track never
     * turns into a page scroll on mobile. */
    .scroll-timeline {
      position: relative;
      height: 18px;
      margin: 6px 2px 0 2px;
      border-radius: 4px;
      /* Transparent track — the day labels float on the card
       * background; only the thin day separators and the thumb give
       * the axis its shape. */
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
      /* Borderless highlight — just a soft primary-tinted lens over
       * the visible section. */
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
    /* The uPlot chart target (per ADR-0012) — uPlot reads the
     * target's getBoundingClientRect() at construction time to size
     * its canvas, so a bare <div> with no dimensions would render at
     * 0×0. Pin it to fill its .chart-container parent. uPlot then
     * sizes its own canvas to the constructor-passed width/height,
     * which we feed from measureContainer(target). The bare layout
     * rules below let uPlot's absolute-positioned axis/over/under
     * layers stack correctly without pulling in uPlot's full
     * uPlot.min.css (which sets the .uplot root to width:min-content —
     * that collapses our flex container). */
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
    /* uPlot writes the high-DPR pixel buffer size onto the canvas's
     * width/height ATTRIBUTES (e.g. 2769x540 on a DPR=3 device for a
     * logical 923x180 chart) but does not set CSS dimensions. Without
     * an explicit CSS size, the canvas displays at its attribute size
     * (pxRatio times the intended size) so the data area renders far
     * below the chart container's 180 px bound.
     * The official uPlot.min.css carries this rule; we deliberately
     * don't import that file (its .uplot width:min-content collapses
     * our flex container) and were missing the canvas rule until now.
     * Symptom this fixes: on the Android Companion App (Chromium
     * WebView, DPR usually 2-3) the temperature lines and precip /
     * sunshine bars rendered below the wind row instead of inside
     * the chart area. */
    #forecastChart canvas {
      display: block;
      width: 100%;
      height: 100%;
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
    .forecast-skeleton-wrapper {
      position: relative;
      width: 100%;
      overflow: hidden;
    }
    /* Soft highlight sweeps bottom-to-top across the loading area —
     * subtle "something is happening" cue without redrawing anything.
     * Compositor-only (animates only background-position) so it stays
     * smooth on Pi-class GPUs. Honors the system reduced-motion
     * setting so users with the OS preference don't see the sweep.
     *
     * The 50%-stop colour is a deliberately theme-AGNOSTIC mid-grey at
     * 0.04 alpha: it reads as a barely-there lighten on dark themes and
     * a barely-there darken on light themes, so a single literal works
     * for every theme. No HA token expresses "near-invisible neutral
     * tint" — --divider-color is far too opaque — so this stays a
     * literal on purpose rather than a var() (Slice 6 theme audit). */
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
    /* In-bundle icon sprite (ADR-0018). The hidden <svg> holds one
     * <symbol> per icon the per-column rows can emit; each column
     * renders a cheap <use> reference instead of an <ha-icon>
     * custom-element upgrade. .wsc-icon mirrors ha-icon's box
     * (--mdc-icon-size driven, 24px default) and colour rule so the
     * sprite icons sit pixel-compatible next to remaining ha-icons. */
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
    /* Computed moon disc (ADR-0022) — same box contract as .wsc-icon
     * so it sits pixel-compatible beside the ha-icons of the sun cell.
     * The disc paints true-to-nature in BOTH themes (lit = white,
     * shadow = black); only the thin outline reads currentColor via
     * the color below, keeping the edge visible on any background. */
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
    .wind-detail ha-icon,
    .wind-detail .wsc-icon {
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
      color: var(--secondary-text-color, #727272);
    }

    /* ----------------------------------------------------------------
     * Narrow-width reflow (Slice 7).
     *
     * Everything below is ADDITIVE: it only takes effect when the
     * card's own container (.card, established above via
     * container-type) is narrower than the breakpoint. The wide-view
     * layout — the dominant case on a desktop dashboard — is left
     * exactly as the rules above define it.
     *
     * Two tiers:
     *   <=360px — a phone-width Companion-app column or the HA 2026.1
     *             mobile-first summary-card slot. Pull in the card
     *             padding, shrink the heavy live-panel icon + clock,
     *             and let the attribute groups wrap instead of being
     *             crushed by justify-content:space-between.
     *   <=280px — a very tight slot (two cards side-by-side on a
     *             phone). Same direction, more aggressive: the live
     *             panel stacks the clock under the temperature so the
     *             absolutely-positioned clock can never overlap it.
     * ---------------------------------------------------------------- */
    @container wsc-card (max-width: 360px) {
      /* Reclaim ~16px of width by halving the side padding. The
       * scroll-indicator / mode-toggle negative insets are -14px, so
       * 8px of padding still leaves them inside the card edge. */
      .card {
        padding-right: 8px;
        padding-left: 8px;
      }
      /* The 50px weather glyph + 14px margin eats a third of a 320px
       * row. Scale icon + temperature down ~15% so the temperature
       * keeps its space; fixed values (not fluid clamp) so the
       * layout stays predictable and easy to baseline-review. */
      .main {
        font-size: ${Math.round(currentTempSize * 0.85)}px;
      }
      .main ha-icon {
        --mdc-icon-size: 38px;
        margin-inline-end: 10px;
      }
      .main img {
        width: ${Math.round(iconsSize * 1.5)}px;
        height: ${Math.round(iconsSize * 1.5)}px;
        margin-inline-end: 10px;
      }
      .main span {
        font-size: 15px;
      }
      /* Clock is position:absolute — at this width keep it pinned but
       * tighten the inset and shrink it so it clears the condition
       * text. The full stacking happens in the <=280px tier. */
      .current-time {
        right: 8px;
        inset-inline-end: 8px;
        font-size: ${Math.round(timeSize * 0.8)}px;
      }
      .date-text {
        font-size: ${Math.max(10, Math.round(dayDateSize * 0.85))}px;
      }
      /* Let the three attribute groups wrap onto a second line rather
       * than being squeezed past readability. space-between still
       * spreads whatever fits on each line. */
      .attributes {
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 13px;
      }
      /* Tighten the chart-chrome typography so timeline labels and
       * wind units don't overflow their narrow columns. */
      .scroll-timeline .tl-seg-label {
        font-size: ${Math.max(8, (labelsBaseSize || 11) - 3)}px;
      }
      .wind-speed {
        font-size: 10px;
      }
    }

    @container wsc-card (max-width: 280px) {
      /* Stack the clock under the temperature. Below ~280px the
       * absolutely-positioned clock cannot share the top row with
       * the temperature + condition without overlapping, so drop it
       * into normal flow beneath them. .current-time is a block
       * inside .main's inner text <div>, so static positioning lets
       * it flow directly under the temperature/condition. */
      .current-time {
        position: static;
        margin-top: 4px;
        text-align: left;
      }
      .attributes {
        /* One group per line keeps each icon+value pair on its own
         * row — no mid-value wrap, no horizontal overflow. */
        justify-content: flex-start;
      }
    }
  `;
}
