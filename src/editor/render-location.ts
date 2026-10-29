// Location panel (#357, #372, ADR-0023): the Home Assistant home until
// "Use another location" is switched on; then a place search, a map, a
// button for elevation and zone, and the zone the card shows times in.
// An IANA name in `time_zone` stays YAML-only; the editor only offers
// it back as an option while it is set, so the form never drops it.

import { html, type TemplateResult } from 'lit';
import { placeLabel } from './location-lookup.js';
import { renderEditorPanel } from './expansion-panel.js';
import type { EditorContext, EditorLike } from './types.js';

type SupportedValuesOf = (key: string) => string[];

/** The browser's IANA zones; null where `Intl.supportedValuesOf` is
 *  missing (older Safari / Firefox). */
export function supportedTimeZones(): string[] | null {
  const fn = (Intl as unknown as { supportedValuesOf?: SupportedValuesOf }).supportedValuesOf;
  if (typeof fn !== 'function') return null;
  try {
    return fn.call(Intl, 'timeZone');
  } catch {
    return null;
  }
}

export function renderLocationSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg } = ctx;
  const loc = (typeof cfg.location === 'object' && cfg.location !== null
    ? cfg.location : {}) as Record<string, unknown>;
  const locZone = typeof loc.time_zone === 'string' ? loc.time_zone : '';
  const hasCoords = typeof loc.latitude === 'number' && typeof loc.longitude === 'number';
  const elevation = typeof loc.elevation === 'number' ? loc.elevation : undefined;
  const home = editor.hass?.config;
  const ui = editor._locUi;

  const zones = supportedTimeZones();
  const zoneSelector = zones
    ? {
      select: {
        mode: 'dropdown',
        custom_value: false,
        options: (locZone && !zones.includes(locZone) ? [locZone, ...zones] : zones)
          .map((value) => ({ value, label: value })),
      },
    }
    : { text: {} };

  // The bounds only frame the input box (Dead Sea shore to above Everest).
  const fieldsSchema = [
    { name: 'elevation', selector: { number: { min: -500, max: 9000, step: 1, mode: 'box' } } },
    { name: 'time_zone', selector: zoneSelector },
  ];
  const fieldLabel = (schema: { name: string }): string =>
    schema.name === 'elevation' ? t('elevation') : t('location_time_zone');

  const rawMode = typeof cfg.time_zone === 'string' && cfg.time_zone !== '' ? cfg.time_zone : 'server';
  const modeOptions = [
    { value: 'location', label: t('time_zone_location') },
    { value: 'server', label: t('time_zone_server') },
  ];
  if (!modeOptions.some((o) => o.value === rawMode)) {
    modeOptions.push({ value: rawMode, label: rawMode });
  }
  const modeSchema = [{
    name: 'time_zone',
    selector: { select: { mode: 'dropdown', options: modeOptions } },
  }];
  const modeLabel = modeOptions.find((o) => o.value === rawMode)?.label ?? rawMode;

  const fmt = (n: unknown): string => (typeof n === 'number' ? n.toFixed(2) : '');
  const homeParts = [
    home?.location_name,
    home?.latitude != null && home?.longitude != null ? `${fmt(home.latitude)}, ${fmt(home.longitude)}` : '',
    typeof home?.elevation === 'number' ? `${home.elevation} m` : '',
    home?.time_zone,
  ].filter(Boolean);

  const summary = hasCoords
    ? [
      `${fmt(loc.latitude)}, ${fmt(loc.longitude)}`,
      elevation !== undefined ? `${elevation} m` : '',
      modeLabel,
    ].filter(Boolean).join(' · ')
    : [t('location_summary_home'), home?.location_name].filter(Boolean).join(' · ');

  const otherFields = hasCoords ? html`
    <div class="loc-search">
      <ha-form
        .data=${{ query: ui.query }}
        .schema=${[{ name: 'query', selector: { text: {} } }]}
        .hass=${editor.hass}
        .computeLabel=${() => t('location_search_label')}
        @value-changed=${editor._locationQueryChanged}
      ></ha-form>
      <ha-button class="loc-search-button" @click=${() => { void editor._locationSearch(); }}>
        ${t('location_search_button')}
      </ha-button>
    </div>
    ${ui.results.length ? html`
      <div class="loc-results">
        ${ui.results.map((hit) => html`
          <button type="button" class="loc-hit" @click=${() => editor._locationPick(hit)}>
            ${placeLabel(hit)}
          </button>
        `)}
      </div>
    ` : ''}
    <ha-form
      .data=${{ location: { latitude: loc.latitude, longitude: loc.longitude } }}
      .schema=${[{ name: 'location', selector: { location: {} } }]}
      .hass=${editor.hass}
      .computeLabel=${() => t('location_map_label')}
      @value-changed=${editor._locationMapChanged}
    ></ha-form>
    <div class="loc-determine">
      <ha-button @click=${() => { void editor._locationDetermine(); }}>
        ${t('location_determine_button')}
      </ha-button>
      ${ui.status ? html`<span class="loc-status ${ui.status.kind}">${ui.status.text}</span>` : ''}
    </div>
    <ha-form
      .data=${{ elevation, time_zone: locZone || undefined }}
      .schema=${fieldsSchema}
      .hass=${editor.hass}
      .computeLabel=${fieldLabel}
      @value-changed=${editor._locationChanged}
    ></ha-form>
    <ha-form
      .data=${{ time_zone: rawMode }}
      .schema=${modeSchema}
      .hass=${editor.hass}
      .computeLabel=${() => t('time_zone_label')}
      @value-changed=${editor._timeZoneModeChanged}
    ></ha-form>
    <div class="hint">${t('location_attribution')}</div>
  ` : '';

  const body = html`
    <div class="textfield-container">
      <div class="hint loc-home">
        ${t('location_home_label')}: ${homeParts.join(' · ')}
      </div>
      <ha-form
        .data=${{ use_location: hasCoords }}
        .schema=${[{ name: 'use_location', selector: { boolean: {} } }]}
        .hass=${editor.hass}
        .computeLabel=${() => t('location_use_other')}
        @value-changed=${editor._locationSwitchChanged}
      ></ha-form>
      ${otherFields}
    </div>
  `;

  return renderEditorPanel({
    editor,
    sectionKey: 'location',
    icon: 'mdi:map-marker',
    title: t('location_heading'),
    summary,
    resetLabel: t('reset_section'),
    body,
  });
}

