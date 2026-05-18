// Fixture generators for the E2E suite.
//
// These build synthetic recorder + forecast data deterministic enough
// for screenshot-baseline comparison. Real-world data has too much
// natural variation (a single missing reading shifts a min/max bucket)
// to make stable visual baselines from a HA snapshot.
//
// Anchor: every fixture is generated relative to the date pinned in
// `todayAnchor()` below. Each spec calls one of these and feeds the
// result into createHassMock.
//
// Sensor IDs are stable strings ("sensor.test_temperature", etc.) so
// the same fixture set drives every spec in the suite.

import type {
  FixtureBag,
  HassState,
  RecorderStatBucket,
} from '../hass-mock.types.js';

export const SENSORS = {
  temperature: 'sensor.test_temperature',
  humidity: 'sensor.test_humidity',
  pressure: 'sensor.test_pressure',
  illuminance: 'sensor.test_illuminance',
  wind_speed: 'sensor.test_wind_speed',
  gust_speed: 'sensor.test_gust_speed',
  wind_direction: 'sensor.test_wind_direction',
  precipitation: 'sensor.test_precipitation',
  uv_index: 'sensor.test_uv_index',
  dew_point: 'sensor.test_dew_point',
} as const;

export const WEATHER_ENTITY = 'weather.test_forecast';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Anchor "today" at local midnight. The fixture day-of-month gets
 *  baked into Chart.js tick labels, so to keep baselines stable we
 *  pick a fixed anchor independent of `new Date()`. Specs override
 *  by setting `Date.now()` before calling the generators if they
 *  need a different anchor (e.g. cross-midnight tests). */
function todayAnchor(): Date {
  const d = new Date('2026-05-06T00:00:00.000');
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sinusoidal signal. Rounded to one decimal so the fixture
 *  deterministically produces clean numeric values that look
 *  reasonable in baseline screenshots (chart-datalabels otherwise
 *  surface 16-digit floats from JS Math.sin). `phase` shifts the
 *  curve so each metric peaks at a different time, producing
 *  visibly distinct lines on the chart instead of stacked sinusoids.
 *  `period` (in samples per full cycle) defaults to 7 — appropriate
 *  for daily series across a week. Hourly callers should pass
 *  `period: 24` so a single diurnal cycle spans one calendar day
 *  (cold early morning, peak afternoon) rather than the unrealistic
 *  multi-cycles-per-day the default produces at hourly granularity. */
function sineSeries(samples: number, amplitude: number, mean: number, phase = 0, period = 7): number[] {
  const omega = (2 * Math.PI) / period;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    out.push(Math.round((mean + amplitude * Math.sin((i + phase) * omega)) * 10) / 10);
  }
  return out;
}

interface DailyStatsOpts {
  days: number;
  /** Include "today" (rightmost) bucket — defaults to true. Set false
   *  when simulating the midnight transition where today's bucket is
   *  not yet aggregated. */
  includeToday?: boolean;
}

/** Build daily aggregates for every sensor. Each metric uses a
 *  realistic mean + amplitude (matching what a real Pi-side weather
 *  station might emit at 46.91°N in early May). */
function buildDailyStats({ days, includeToday = true }: DailyStatsOpts): Record<string, RecorderStatBucket[]> {
  const today = todayAnchor();
  // The data source fetches `days+1` buckets so the diff-on-precip
  // path has a baseline. We mirror that here.
  const total = days + 1;
  const start = new Date(today.getTime() - days * DAY_MS);
  const tempHigh = sineSeries(total, 5, 18);
  const tempLow = sineSeries(total, 4, 8, 1);
  const humidity = sineSeries(total, 10, 70, 2);
  const pressure = sineSeries(total, 4, 1015, 0.5);
  const wind = sineSeries(total, 2, 4, 1.5);
  const gust = sineSeries(total, 4, 8, 1.2);
  const lux = sineSeries(total, 30000, 50000, 0);
  const dew = sineSeries(total, 3, 9, 1.8);
  const uv = sineSeries(total, 3, 4, 0).map((v) => Math.max(0, Math.round(v)));
  const dirs = sineSeries(total, 90, 180, 0.7);
  // Cumulative precipitation counter — `max` per bucket increases
  // monotonically. Daily-rainfall = max[i] - max[i-1].
  let precipAccum = 0;
  const precipMax: number[] = [];
  const dailyRain = [0, 1.4, 3.9, 6.7, 0.7, 7.4, 0.5, 26]; // mm per day, cycled
  for (let i = 0; i < total; i++) {
    precipAccum += dailyRain[i % dailyRain.length];
    precipMax.push(precipAccum);
  }

  const out: Record<string, RecorderStatBucket[]> = {};
  for (const [key, eid] of Object.entries(SENSORS)) {
    out[eid] = [];
    for (let i = 0; i < total; i++) {
      const bucketStart = new Date(start.getTime() + i * DAY_MS);
      // The data source slices off the leading baseline bucket; we
      // include it so `bucketPrecipitation`'s diff path has data.
      if (!includeToday && i === total - 1) continue;
      const bucket: RecorderStatBucket = { start: bucketStart.toISOString() };
      switch (key) {
        case 'temperature':
          bucket.max = tempHigh[i];
          bucket.min = tempLow[i];
          bucket.mean = (tempHigh[i] + tempLow[i]) / 2;
          break;
        case 'humidity':
          bucket.mean = humidity[i];
          bucket.max = humidity[i] + 5;
          bucket.min = humidity[i] - 5;
          break;
        case 'pressure':
          bucket.mean = pressure[i];
          break;
        case 'illuminance':
          bucket.max = lux[i];
          bucket.mean = lux[i] / 2;
          break;
        case 'wind_speed':
          bucket.mean = wind[i];
          bucket.max = wind[i] + 1;
          break;
        case 'gust_speed':
          bucket.max = gust[i];
          bucket.mean = gust[i] - 1;
          break;
        case 'wind_direction':
          bucket.mean = dirs[i];
          break;
        case 'precipitation':
          bucket.max = precipMax[i];
          break;
        case 'uv_index':
          bucket.max = uv[i];
          break;
        case 'dew_point':
          bucket.mean = dew[i];
          break;
      }
      out[eid].push(bucket);
    }
  }
  return out;
}

interface HourlyStatsOpts {
  hours: number;
}

/** Build hourly aggregates for every sensor. Same metric shapes as
 *  daily but shorter periodicity and a precipitation counter that
 *  jumps at a fixed phase so a few hours have rainfall visible. */
function buildHourlyStats({ hours }: HourlyStatsOpts): Record<string, RecorderStatBucket[]> {
  const today = todayAnchor();
  // Window ends at next-full-hour exclusive. Live HA rounds up; we
  // mirror that here so the data-source's start-time math lines up.
  const end = new Date();
  end.setMinutes(0, 0, 0);
  end.setHours(end.getHours() + 1);
  // For deterministic baselines: align end to fixture-day 18:00
  // (matching the test's mock-now of 17:30 rounded up to next-full-
  // hour). This puts a midnight crossing within the rolling 24-hour
  // 'today' window — 12h forecast forward from 18:00 reaches into
  // tomorrow's 06:00, demonstrating the day-boundary separator.
  end.setTime(today.getTime() + 18 * HOUR_MS);
  const total = hours + 1;
  const start = new Date(end.getTime() - total * HOUR_MS);

  // Hourly metrics computed by HOUR-OF-DAY of each bucket — one
  // diurnal cycle per 24 hours, regardless of the fixture window's
  // start hour. tempMean: cold around 03:00, peak around 15:00.
  // humidity: anti-correlates with temp. lux: noon-peaked, clamped ≥0.
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  const hourly = (mean: number, amplitude: number, offsetHours: number) =>
    (hour: number): number => round1(mean + amplitude * Math.sin((hour - offsetHours) * Math.PI / 12));
  const tempAt = hourly(14, 6, 9);     // min 03:00, max 15:00
  const humidityAt = hourly(65, 12, 21); // anti-phase to temp (max 09:00 — actually min 09:00, max 21:00)
  const pressureAt = hourly(1015, 3, 12);
  const windAt = hourly(5, 3, 0);      // min near midnight
  const gustAt = hourly(9, 5, 0);
  const luxAt = (hour: number): number => round1(Math.max(0, 25000 + 25000 * Math.sin((hour - 6) * Math.PI / 12)));
  const dewAt = hourly(8, 3, 12);
  const uvAt = (hour: number): number => Math.max(0, Math.round(3 + 3 * Math.sin((hour - 6) * Math.PI / 12)));
  const dirsAt = hourly(180, 90, 12);
  // Per-hour precipitation accumulator. A 4 mm shower over hours
  // 12-15 of the window keeps the precip dataset visually present.
  let precipAccum = 0;
  const precipMax: number[] = [];
  const hourlyRain = (i: number): number => {
    const hr = i % 24;
    if (hr >= 12 && hr <= 15) return 1; // mm/h
    if (hr === 18) return 0.3;
    return 0;
  };
  for (let i = 0; i < total; i++) {
    precipAccum += hourlyRain(i);
    precipMax.push(precipAccum);
  }

  const out: Record<string, RecorderStatBucket[]> = {};
  for (const [key, eid] of Object.entries(SENSORS)) {
    out[eid] = [];
    for (let i = 0; i < total; i++) {
      const bucketStart = new Date(start.getTime() + i * HOUR_MS);
      const hour = bucketStart.getHours();
      const bucket: RecorderStatBucket = { start: bucketStart.toISOString() };
      switch (key) {
        case 'temperature': {
          const t = tempAt(hour);
          bucket.mean = t;
          bucket.max = t + 1;
          bucket.min = t - 1;
          break;
        }
        case 'humidity':
          bucket.mean = humidityAt(hour);
          break;
        case 'pressure':
          bucket.mean = pressureAt(hour);
          break;
        case 'illuminance':
          bucket.max = luxAt(hour);
          break;
        case 'wind_speed':
          bucket.mean = windAt(hour);
          break;
        case 'gust_speed':
          bucket.max = gustAt(hour);
          break;
        case 'wind_direction':
          bucket.mean = dirsAt(hour);
          break;
        case 'precipitation':
          bucket.max = precipMax[i];
          break;
        case 'uv_index':
          bucket.max = uvAt(hour);
          break;
        case 'dew_point':
          bucket.mean = dewAt(hour);
          break;
      }
      out[eid].push(bucket);
    }
  }
  return out;
}

/** Build weather/subscribe_forecast daily payload. Weather conditions
 *  cycle through a small palette so the tick-icon row isn't
 *  monotonous. */
function buildDailyForecast(days: number): Array<Record<string, unknown>> {
  const today = todayAnchor();
  const conditions = ['sunny', 'partlycloudy', 'cloudy', 'rainy', 'partlycloudy', 'sunny', 'cloudy'];
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  return Array.from({ length: days }, (_v, i) => {
    const date = new Date(today.getTime() + i * DAY_MS);
    return {
      datetime: date.toISOString(),
      temperature: round1(18 + Math.sin(i * 0.6) * 5),
      templow: round1(8 + Math.sin(i * 0.6 + 1) * 4),
      precipitation: i % 3 === 0 ? 2.5 : 0,
      wind_speed: round1(12 + Math.sin(i * 0.4) * 4),
      wind_bearing: Math.round(180 + Math.sin(i * 0.7) * 90),
      condition: conditions[i % conditions.length],
      humidity: round1(70 + Math.sin(i * 0.5) * 10),
      pressure: 1015,
    };
  });
}

/** Build weather/subscribe_forecast hourly payload. */
function buildHourlyForecast(hours: number, opts: { withTemplow?: boolean } = {}): Array<Record<string, unknown>> {
  const today = todayAnchor();
  // Future hours start at "now" (rounded to hour). For deterministic
  // baselines we anchor at fixture-day 18:00 (matching the test's
  // mock-now of 17:30 rounded up). 12 forecast hours forward then
  // reaches tomorrow-06:00, putting the midnight day-boundary in
  // the middle of the chart for combination 'today' mode.
  const start = new Date(today.getTime() + 18 * HOUR_MS);
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  // Diurnal forecast: same temp curve as the station's hourly fixture
  // (cold around 03:00, peak around 15:00). Forecast values get
  // dashed-rendered by the chart, so the curve blends visually with
  // the station-side curve at the now-boundary instead of jumping.
  const tempAt = (hour: number): number => round1(14 + 6 * Math.sin((hour - 9) * Math.PI / 12));
  const windAt = (hour: number): number => round1(10 + 3 * Math.sin(hour * Math.PI / 12));
  return Array.from({ length: hours }, (_v, i) => {
    const date = new Date(start.getTime() + i * HOUR_MS);
    const hr = date.getHours();
    const isDay = hr >= 7 && hr <= 19;
    const t = tempAt(hr);
    const entry: Record<string, unknown> = {
      datetime: date.toISOString(),
      temperature: t,
      precipitation: (hr >= 14 && hr <= 17) ? 0.5 : 0,
      wind_speed: windAt(hr),
      wind_bearing: 180,
      condition: isDay ? (i % 4 === 0 ? 'rainy' : 'partlycloudy') : 'clear-night',
      humidity: 70,
      pressure: 1015,
    };
    // Some forecast providers (e.g. meteoswiss, openmeteo-hourly mode)
    // emit BOTH `temperature` and `templow` per hourly forecast bucket.
    // The card renders that as two temperature lines instead of one —
    // captured in the today-combination-templow render-modes baseline.
    if (opts.withTemplow) {
      entry.templow = round1(t - 1.2);
    }
    return entry;
  });
}

/** Live state record per sensor. The card reads `hass.states[eid].state`
 *  for the "now" current-condition rendering and for the live-fill in
 *  the last hourly bucket. */
function buildLiveStates(): Record<string, HassState> {
  return {
    [SENSORS.temperature]: { state: '15.2', attributes: { unit_of_measurement: '°C' } },
    [SENSORS.humidity]: { state: '68', attributes: { unit_of_measurement: '%' } },
    [SENSORS.pressure]: { state: '1015', attributes: { unit_of_measurement: 'hPa' } },
    [SENSORS.illuminance]: { state: '32000', attributes: { unit_of_measurement: 'lx' } },
    [SENSORS.wind_speed]: { state: '4.5', attributes: { unit_of_measurement: 'km/h' } },
    [SENSORS.gust_speed]: { state: '8.0', attributes: { unit_of_measurement: 'km/h' } },
    [SENSORS.wind_direction]: { state: '180', attributes: { unit_of_measurement: '°' } },
    [SENSORS.precipitation]: { state: '0', attributes: { unit_of_measurement: 'mm' } },
    [SENSORS.uv_index]: { state: '3', attributes: { unit_of_measurement: 'UV' } },
    [SENSORS.dew_point]: { state: '9.5', attributes: { unit_of_measurement: '°C' } },
    [WEATHER_ENTITY]: {
      state: 'partlycloudy',
      attributes: {
        temperature: 15.2,
        temperature_unit: '°C',
        humidity: 68,
        pressure: 1015,
        pressure_unit: 'hPa',
        wind_speed: 4.5,
        wind_speed_unit: 'km/h',
        wind_bearing: 180,
        precipitation_unit: 'mm',
        visibility_unit: 'km',
        // FORECAST_DAILY = 1, FORECAST_HOURLY = 2 — bitfield with both.
        supported_features: 1 | 2,
        friendly_name: 'Test Forecast',
      },
    },
    // The card reads `hass.states['sun.sun'].state` for day/night icon
    // variants and the `next_rising` / `next_setting` attributes for
    // the sunrise/sunset times shown in the .main panel.
    'sun.sun': {
      state: 'above_horizon',
      attributes: {
        friendly_name: 'Sun',
        next_rising: '2026-05-07T04:02:00+00:00',
        next_setting: '2026-05-06T18:50:00+00:00',
      },
    },
  };
}

interface FullFixtureOpts {
  /** Days of daily station data + days of daily forecast data. */
  days?: number;
  /** Hours of hourly station data. The mock recorder returns ALL of
   *  these on a callWS hit (no time-window filtering on the mock
   *  side), so for tests that configure a shorter horizon — e.g. a
   *  24-hour zoom — pass an explicit `hours` matching the test's
   *  `days × 24` so the chart doesn't see more buckets than it
   *  asked for. */
  hours?: number;
  /** Hours of hourly forecast data. Same reasoning. */
  forecastHours?: number;
  /** True → hourly forecast carries BOTH `temperature` and `templow`
   *  per bucket (mirrors meteoswiss / openmeteo-hourly providers).
   *  The chart then renders two temperature lines instead of one. */
  forecastWithTemplow?: boolean;
}

/** One-call composition for the common case: 7-day daily + 168-hour
 *  hourly window with both station + forecast data. Pass an opts bag
 *  for shorter horizons (e.g. a future days=1 zoom variant). */
export function buildFullFixture(opts: FullFixtureOpts = {}): FixtureBag {
  const days = opts.days ?? 7;
  const hours = opts.hours ?? days * 24;
  const forecastHours = opts.forecastHours ?? hours;
  return {
    config: {
      latitude: 46.91,
      longitude: 7.42,
      language: 'en',
    },
    states: buildLiveStates(),
    recorderDaily: buildDailyStats({ days }),
    recorderHourly: buildHourlyStats({ hours }),
    forecastDaily: buildDailyForecast(days),
    forecastHourly: buildHourlyForecast(forecastHours, { withTemplow: opts.forecastWithTemplow }),
  };
}

/** Default card config for the suite. Specs override individual
 *  fields (mode, forecast.type, sensors subset) but otherwise use
 *  this as the baseline. Animation is disabled so screenshot
 *  baselines aren't flaky on the 500 ms easeOutQuart. */
export function buildBaseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sensors: {
      temperature: SENSORS.temperature,
      humidity: SENSORS.humidity,
      pressure: SENSORS.pressure,
      illuminance: SENSORS.illuminance,
      wind_speed: SENSORS.wind_speed,
      gust_speed: SENSORS.gust_speed,
      wind_direction: SENSORS.wind_direction,
      precipitation: SENSORS.precipitation,
      uv_index: SENSORS.uv_index,
      dew_point: SENSORS.dew_point,
    },
    weather_entity: WEATHER_ENTITY,
    days: 7,
    forecast_days: 7,
    show_station: true,
    show_forecast: true,
    show_main: true,
    show_temperature: true,
    show_current_condition: true,
    show_attributes: true,
    show_humidity: false,
    show_pressure: true,
    show_precipitation: true,
    show_wind_direction: true,
    show_wind_speed: true,
    show_wind_gust_speed: true,
    show_dew_point: true,
    show_sun: true,
    forecast: {
      type: 'daily',
      disable_animation: true,
      condition_icons: true,
      show_wind_forecast: true,
      show_wind_arrow: true,
      show_date: true,
      labels_font_size: 11,
      chart_height: 180,
      precip_bar_size: 100,
      style: 'style2',
      number_of_forecasts: 8,
      // sunshine off by default — specs that test sunshine flip it on.
      show_sunshine: false,
      // Round to integer °C — keeps the chart-datalabels readable in
      // baselines (raw means produce 16-digit floats from sineSeries).
      round_temp: true,
    },
    ...overrides,
  };
}
