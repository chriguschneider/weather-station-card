import { describe, it, expect } from 'vitest';
import { buildChartLegend } from '../src/chart-legend.js';

const base = {
  showStation: true,
  showForecast: true,
  pastFromOpenMeteo: false,
  showSunshine: true,
  sunshineParts: { station: 'sensor', forecast: 'openmeteo' },
  showTempLow: true,
  colors: { high: 'orange', low: 'blue', precip: 'skyblue', sunshine: 'gold' },
  text: {
    high: 'High', low: 'Low', precip: 'Precipitation', sunshine: 'Sunshine',
    measured: 'Measured', forecast: 'Forecast',
    measuredNote: 'measured', forecastNote: 'forecast',
    stationSource: 'Netatmo', forecastSource: 'met.no', openMeteo: 'Open-Meteo',
    sunshineTitleOpenMeteo: 'OM fills in',
  },
};

describe('buildChartLegend', () => {
  it('names every encoding of a combination chart with its source', () => {
    expect(buildChartLegend(base)).toEqual([
      { swatch: 'line', colors: ['orange', 'blue'], text: 'High / Low' },
      { swatch: 'line', colors: [], text: 'Measured: Netatmo' },
      { swatch: 'dash', colors: [], text: 'Forecast: met.no' },
      { swatch: 'bar', colors: ['skyblue'], text: 'Precipitation' },
      { swatch: 'bar', colors: ['gold'], text: 'Sunshine: Netatmo (measured) · Open-Meteo (forecast)', title: 'OM fills in' },
    ]);
  });

  it('drops the station entry in forecast-only mode and the forecast entry in station-only mode', () => {
    const fcOnly = buildChartLegend({ ...base, showStation: false }).map((i) => i.text);
    expect(fcOnly).not.toContain('Measured: Netatmo');
    expect(fcOnly).toContain('Forecast: met.no');
    const stOnly = buildChartLegend({ ...base, showForecast: false }).map((i) => i.text);
    expect(stOnly).toContain('Measured: Netatmo');
    expect(stOnly).not.toContain('Forecast: met.no');
  });

  it('credits Open-Meteo for the past block when it replaces the recorder (ADR-0015)', () => {
    const items = buildChartLegend({ ...base, pastFromOpenMeteo: true });
    expect(items.find((i) => i.text.startsWith('Measured'))?.text).toBe('Measured: Open-Meteo');
  });

  it('names the weather entity for forecast sunshine it covers', () => {
    const sun = buildChartLegend({ ...base, sunshineParts: { station: 'sensor', forecast: 'entity' } })
      .find((i) => i.text.startsWith('Sunshine'));
    expect(sun).toEqual({ swatch: 'bar', colors: ['gold'], text: 'Sunshine: Netatmo (measured) · met.no (forecast)' });
  });

  it('names a single source when both sunshine parts share it', () => {
    const sun = buildChartLegend({ ...base, sunshineParts: { station: 'openmeteo', forecast: 'openmeteo' } })
      .find((i) => i.text.startsWith('Sunshine'));
    expect(sun?.text).toBe('Sunshine: Open-Meteo');
    expect(sun?.title).toBe('OM fills in');
  });

  it('shows just "Sunshine" when no part is drawn', () => {
    const sun = buildChartLegend({ ...base, sunshineParts: { station: null, forecast: null } })
      .find((i) => i.text.startsWith('Sunshine'));
    expect(sun).toEqual({ swatch: 'bar', colors: ['gold'], text: 'Sunshine' });
  });

  it('names both sources when the entity covers only some forecast columns', () => {
    const sun = buildChartLegend({ ...base, sunshineParts: { station: null, forecast: 'mixed' } })
      .find((i) => i.text.startsWith('Sunshine'));
    expect(sun?.text).toBe('Sunshine: met.no + Open-Meteo (forecast)');
    expect(sun?.title).toBe('OM fills in');
  });

  it('omits sunshine when hidden and the low line in hourly mode', () => {
    const items = buildChartLegend({ ...base, showSunshine: false, showTempLow: false });
    expect(items[0]).toEqual({ swatch: 'line', colors: ['orange'], text: 'High' });
    expect(items.some((i) => i.text.startsWith('Sunshine'))).toBe(false);
  });
});
