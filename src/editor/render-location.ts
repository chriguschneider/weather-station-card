// Location panel (#357, ADR-0023): the place the card is for, and
// whether its times are shown in the server's or that place's zone.
// An IANA name in `time_zone` stays YAML-only; the editor only offers
// it back as an option while it is set, so the form never drops it.

import { html, type TemplateResult } from 'lit';
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

  const locationSchema = [
    { name: 'latitude', selector: { number: { min: -90, max: 90, step: 'any', mode: 'box' } } },
    { name: 'longitude', selector: { number: { min: -180, max: 180, step: 'any', mode: 'box' } } },
    { name: 'time_zone', selector: zoneSelector },
  ];

  const rawMode = typeof cfg.time_zone === 'string' && cfg.time_zone !== '' ? cfg.time_zone : 'server';
  const modeOptions = [
    { value: 'server', label: t('time_zone_server') },
    { value: 'location', label: t('time_zone_location') },
  ];
  if (!modeOptions.some((o) => o.value === rawMode)) {
    modeOptions.push({ value: rawMode, label: rawMode });
  }
  const modeSchema = [{
    name: 'time_zone',
    selector: { select: { mode: 'dropdown', options: modeOptions } },
  }];

  const labels: Record<string, string> = {
    latitude: t('location_latitude'),
    longitude: t('location_longitude'),
  };
  const locationLabel = (schema: { name: string }): string =>
    schema.name === 'time_zone' ? t('location_time_zone') : labels[schema.name];

  const hasCoords = typeof loc.latitude === 'number' && typeof loc.longitude === 'number';
  const summary = hasCoords || locZone
    ? [hasCoords ? `${loc.latitude}, ${loc.longitude}` : '', locZone].filter(Boolean).join(' · ')
    : t('location_summary_home');

  const body = html`
    <div class="textfield-container">
      <ha-form
        .data=${{ latitude: loc.latitude, longitude: loc.longitude, time_zone: locZone || undefined }}
        .schema=${locationSchema}
        .hass=${editor.hass}
        .computeLabel=${locationLabel}
        @value-changed=${editor._locationChanged}
      ></ha-form>
      <ha-form
        .data=${{ time_zone: rawMode }}
        .schema=${modeSchema}
        .hass=${editor.hass}
        .computeLabel=${() => t('time_zone_label')}
        @value-changed=${editor._timeZoneModeChanged}
      ></ha-form>
      <div class="hint">${t('location_hint')}</div>
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
