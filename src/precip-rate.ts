// Live precipitation-rate derivation from a cumulative rain counter.
//
// Cumulative sensors (e.g. Ecowitt `*_precipitation`, 0.1 mm tipping bucket)
// only expose a monotonically-rising total; HA's `weather.*` card slot
// expects a mm/h rate. This module turns the cumulative stream into a rate
// without an HA-side helper by keeping a 15-min mini-buffer of recent
// samples and dividing Δvalue by Δtime over a last-N window.
//
// Rate formula:
//   anchor = buffer[buffer.length - targetN]   (or [0] if buffer < targetN)
//   rate   = (latest.v - anchor.v) / (now - anchor.t)
//
// The denominator is wall-clock `now`, NOT `latest.t`. That makes the rate
// decay automatically as wall-clock advances without new sensor ticks: Δv
// stays fixed, Δt grows, rate → 0. No min-span guard, no walk-back.
//
// The derivation is pure; only loadBuffer / saveBuffer touch localStorage.
// The tick and buffer wiring lives in PrecipRateController (ADR-0034).

import { safeLocalStorage } from './utils/safe-storage.js';

/** A single cumulative-counter reading at a wall-clock instant.
 *  `v` is the raw cumulative value in the sensor's native unit (mm).
 *  `t` is `Date.now()` at the moment the reading was captured. */
export interface Sample {
  t: number;
  v: number;
}

export interface ComputeRateOptions {
  /** Anchor index = `buffer.length - targetN` (clamped to 0). */
  targetN?: number;
  /** A buffer of exactly one sample with age ≤ this is treated as a
   *  "we just saw a tick, but can't quantify yet" state and reported
   *  as `floor`. Older single samples report 0. */
  freshThresholdMs?: number;
  /** Floor rate returned for the single-sample-fresh case. Keeps the
   *  cell from flashing `0.0` when the sensor JUST ticked but a
   *  second sample hasn't landed yet. */
  floor?: number;
}

export interface ComputeRateResult {
  /** mm/h. Always finite — empty buffer / stale single sample → 0. */
  rate: number;
  /** Samples in the buffer at compute time. */
  sampleCount: number;
}

const DEFAULT_TARGET_N = 3;
const DEFAULT_FRESH_THRESHOLD_MS = 120_000;
const DEFAULT_RATE_FLOOR = 0.1;
export const DEFAULT_MAX_AGE_MS = 900_000;

// Rate-intensity icon buckets (mm/h): ≤ 0 water-off, < 2.5 weather-rainy,
// ≥ 2.5 weather-pouring. Not weather-partly-rainy: its sun glyph
// contradicts "it's raining". The upper boundary is half-open: 2.5 → pouring.
const PRECIP_RATE_LIGHT_MAX = 2.5;

/** Map a mm/h rate to an MDI icon HA ships. Negative or non-finite
 *  input maps to the "dry" icon. */
export function precipIcon(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return 'hass:water-off';
  if (rate < PRECIP_RATE_LIGHT_MAX) return 'hass:weather-rainy';
  return 'hass:weather-pouring';
}

// Per-entity key, so cards on different cumulative sensors keep independent
// buffers (#117).
const STORAGE_PREFIX = 'weather-station-card.precipSamples.';

/** Subset of the Web Storage API the load/save helpers use; tests inject their own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Persisted payload shape: `samples` wrapped in an object. */
interface PersistedBuffer {
  samples?: unknown;
}

function storageKey(entityId: string): string {
  return `${STORAGE_PREFIX}${entityId}`;
}

function isSample(x: unknown): x is Sample {
  if (!x || typeof x !== 'object') return false;
  const s = x as { t?: unknown; v?: unknown };
  return typeof s.t === 'number' && Number.isFinite(s.t) &&
         typeof s.v === 'number' && Number.isFinite(s.v);
}

/** Append `sample`, returning a new array (the same array for a duplicate
 *  or a non-finite sample). */
export function appendSample(buffer: Sample[], sample: Sample): Sample[] {
  if (!Number.isFinite(sample.t) || !Number.isFinite(sample.v)) return buffer;
  // `set hass` fires on any entity update, so the same sample can arrive repeatedly.
  const last = buffer.length > 0 ? buffer[buffer.length - 1] : null;
  if (last?.t === sample.t && last?.v === sample.v) return buffer;
  return [...buffer, sample];
}

/** Drop samples older than `maxAgeMs`. */
export function pruneOlderThan(
  buffer: Sample[],
  maxAgeMs: number,
  now: number = Date.now(),
): Sample[] {
  if (buffer.length === 0) return buffer;
  const cutoff = now - maxAgeMs;
  let i = 0;
  while (i < buffer.length && buffer[i].t < cutoff) i += 1;
  return i === 0 ? buffer : buffer.slice(i);
}

/** Largest tail of `buffer` without a counter reset (an index where v
 *  drops: midnight `*_rain_today` rollover, utility-meter reset, reboot),
 *  so computeRate never emits a negative rate. Doesn't mutate the input. */
export function findUsableSlice(buffer: Sample[]): Sample[] {
  let cut = 0;
  for (let i = 1; i < buffer.length; i++) {
    if (buffer[i].v < buffer[i - 1].v) cut = i;
  }
  return cut === 0 ? buffer : buffer.slice(cut);
}

/** mm/h from the buffer: trim at the last counter reset, then
 *  (latest.v - anchor.v) / (now - anchor.t), anchor being the targetN-th
 *  last sample. The denominator is wall-clock now, not latest.t, so the
 *  rate decays between ticks. One fresh sample returns `floor`, otherwise
 *  0. `sampleCount` counts the full input buffer. */
export function computeRate(
  buffer: Sample[],
  now: number = Date.now(),
  opts: ComputeRateOptions = {},
): ComputeRateResult {
  const targetN = opts.targetN ?? DEFAULT_TARGET_N;
  const freshThresholdMs = opts.freshThresholdMs ?? DEFAULT_FRESH_THRESHOLD_MS;
  const floor = opts.floor ?? DEFAULT_RATE_FLOOR;
  const sampleCount = buffer.length;

  const usable = findUsableSlice(buffer);
  if (usable.length === 0) return { rate: 0, sampleCount };

  if (usable.length === 1) {
    const age = now - usable[0].t;
    return { rate: age <= freshThresholdMs ? floor : 0, sampleCount };
  }

  const anchorIdx = Math.max(0, usable.length - targetN);
  const anchor = usable[anchorIdx];
  const latest = usable[usable.length - 1];
  const deltaV = latest.v - anchor.v;
  const deltaT = now - anchor.t;
  if (deltaT <= 0 || deltaV < 0) return { rate: 0, sampleCount };

  return { rate: (deltaV * 3_600_000) / deltaT, sampleCount };
}

/** Raw `samples` array from localStorage; `[]` on any failure. The caller
 *  filters and sorts. */
function readPersistedSamples(store: StorageLike, entityId: string): unknown[] {
  try {
    const raw = store.getItem(storageKey(entityId));
    if (!raw) return [];
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return [];
    const samples = (obj as PersistedBuffer).samples;
    return Array.isArray(samples) ? samples : [];
  } catch (err) {
    // Storage access blocked or JSON corrupted — fall through to an
    // empty buffer so the live sampler can warm up from scratch.
    void err;
    return [];
  }
}

/** Best-effort persisted-buffer read. Drops over-age entries inline.
 *  Returns `[]` on any failure path and never throws. */
export function loadBuffer(
  entityId: string,
  storage?: StorageLike | null,
  now: number = Date.now(),
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Sample[] {
  const store = storage !== undefined ? storage : safeLocalStorage();
  if (!store || !entityId) return [];

  const cutoff = now - maxAgeMs;
  const out: Sample[] = [];
  for (const s of readPersistedSamples(store, entityId)) {
    if (!isSample(s) || s.t < cutoff) continue;
    out.push({ t: s.t, v: s.v });
  }
  // computeRate assumes chronological order; don't trust the stored order.
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Best-effort persisted-buffer write; silent on quota / private-mode failure. */
export function saveBuffer(
  entityId: string,
  buffer: Sample[],
  storage?: StorageLike | null,
): void {
  const store = storage !== undefined ? storage : safeLocalStorage();
  if (!store) return;
  if (!entityId) return;
  try {
    const payload: PersistedBuffer = { samples: buffer };
    store.setItem(storageKey(entityId), JSON.stringify(payload));
  } catch (err) {
    void err;
  }
}
