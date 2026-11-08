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
// stays fixed, Δt grows, rate → 0. No min-span guard, no walk-back — the
// `now`-driven denominator does the work both guards used to do (suppress
// noise on short windows and decay stale bursts).
//
// All functions here are pure data → number. No I/O, no timers, no
// localStorage — that wiring lives in `main.ts`.

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

// Rate-intensity thresholds (mm/h). Three icon buckets, mapped onto
// MDI icons HA's frontend already ships:
//
//   rate ≤ 0       water-off       (dry / pre-onset)
//   rate < 2.5     weather-rainy   (drizzle → light)
//   rate ≥ 2.5     weather-pouring (moderate → heavy)
//
// We deliberately do NOT use `weather-partly-rainy` for drizzle: the
// sun-behind-cloud glyph contradicts the "it's raining" context, so
// drizzle and light rain share the plain `weather-rainy` icon and the
// numeric mm/h carries the intensity nuance.
//
// Boundary is half-open on the upper side so the mapping is monotonic
// non-decreasing: rate === 2.5 → pouring, not rainy.
const PRECIP_RATE_LIGHT_MAX = 2.5;

/** Map a mm/h rate to a Home Assistant `ha-icon` name. Returns one of
 *  the `hass:` / MDI icons that HA's frontend ships out of the box —
 *  no custom icon pack needed.
 *
 *  Negative or non-finite inputs collapse to the "dry" icon; the
 *  caller already defends against this (`computeRate` clamps Δv<0 to
 *  0), but the icon function is the user-facing surface and we want
 *  it total. */
export function precipIcon(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return 'hass:water-off';
  if (rate < PRECIP_RATE_LIGHT_MAX) return 'hass:weather-rainy';
  return 'hass:weather-pouring';
}

// LocalStorage key prefix. Per-entity so a dashboard with two cards
// pointed at different cumulative sensors maintains two independent
// buffers; Issue #117 documents this as the accepted multi-instance
// convergence model.
const STORAGE_PREFIX = 'weather-station-card.precipSamples.';

/** Subset of the Web Storage API the load/save helpers use. Same shape
 *  as `openmeteo-source.ts`'s `StorageLike` — tests and unsupported
 *  environments (private mode, locked-down iframes) inject their own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Persisted payload shape. Wrapping `samples` in an object (instead of
 *  serialising the array directly) leaves room for a schema-version
 *  field in slice 3 without breaking the load path. */
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

/** Append `sample` to `buffer` in chronological order. Returns a new array;
 *  callers can replace their field reference without aliasing. Drops the
 *  sample if `v` or `t` aren't finite — the cumulative-detection gate in
 *  `set hass` is paranoid about HA's `unavailable` / `unknown` states
 *  bleeding numerics. */
export function appendSample(buffer: Sample[], sample: Sample): Sample[] {
  if (!Number.isFinite(sample.t) || !Number.isFinite(sample.v)) return buffer;
  // Same-timestamp re-renders happen because `set hass` fires on any
  // entity update, not just our precip sensor. Skip duplicates to keep
  // the buffer tight.
  const last = buffer.length > 0 ? buffer[buffer.length - 1] : null;
  if (last?.t === sample.t && last?.v === sample.v) return buffer;
  return [...buffer, sample];
}

/** Drop samples older than `maxAgeMs`. Used both to prune in-memory state
 *  and (in slice 2) to filter localStorage on load. */
export function pruneOlderThan(
  buffer: Sample[],
  maxAgeMs: number,
  now: number = Date.now(),
): Sample[] {
  if (buffer.length === 0) return buffer;
  const cutoff = now - maxAgeMs;
  // Buffer is chronological — find the first surviving index and slice.
  let i = 0;
  while (i < buffer.length && buffer[i].t < cutoff) i += 1;
  return i === 0 ? buffer : buffer.slice(i);
}

/** Return the largest tail-suffix of `buffer` that contains no
 *  counter-reset boundary. A reset is any index `i` where
 *  `buffer[i].v < buffer[i-1].v` — daily `*_rain_today` rollover at
 *  midnight, utility-meter reset, device reboot. We use *only* the
 *  samples after the latest reset, so `computeRate` never divides a
 *  positive Δt into a negative Δv and emits a phantom negative rate.
 *
 *  Within a 15-min buffer (DEFAULT_MAX_AGE_MS) at most one reset can
 *  occur, so a single forward scan is sufficient. Pre-reset samples
 *  are discarded — they'll age out of the buffer on subsequent
 *  prunes; we don't mutate the input. */
export function findUsableSlice(buffer: Sample[]): Sample[] {
  let cut = 0;
  for (let i = 1; i < buffer.length; i++) {
    if (buffer[i].v < buffer[i - 1].v) cut = i;
  }
  return cut === 0 ? buffer : buffer.slice(cut);
}

/** Derive a mm/h rate from the buffer.
 *
 *  Strategy:
 *  1. Trim the buffer at the latest counter-reset boundary
 *     (`findUsableSlice`) so a midnight rollover doesn't poison Δv.
 *  2. Pick `anchor = usable[usable.length - targetN]` (clamped to 0).
 *  3. `rate = (latest.v - anchor.v) / (now - anchor.t)`.
 *
 *  Note the `now - anchor.t` denominator — NOT `latest.t - anchor.t`.
 *  As wall-clock advances without new ticks, the denominator grows and
 *  the rate decays to 0. This is what lets the card "breathe" after a
 *  rain burst ends instead of cliffing from the burst rate to ⋯ when
 *  the buffer ages out.
 *
 *  Edge cases:
 *  - Empty buffer → rate 0.
 *  - Single sample, age ≤ freshThresholdMs → rate `floor` (default 0.1).
 *    We know the sensor just ticked but can't quantify until a second
 *    sample lands.
 *  - Single sample, age > freshThresholdMs → rate 0.
 *  - Δv < 0 (reset findUsableSlice missed) → rate 0 (defensive).
 *
 *  `sampleCount` in the result reflects the full input buffer (what
 *  the caller stored), not the post-reset slice. */
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

/** Pull the raw `samples` array out of localStorage for one entity.
 *  Returns `[]` on any failure path — storage blocked, key absent,
 *  JSON corrupt, schema mismatch. Caller is responsible for filtering
 *  and sorting; the split keeps `loadBuffer`'s cyclomatic complexity
 *  below the project's 15-branch threshold. */
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

/** Best-effort persisted-buffer read. Drops over-age entries inline so
 *  the caller never has to remember to prune the loaded buffer before
 *  appending. Returns `[]` on any failure path (no storage, key absent,
 *  JSON corrupt, schema mismatch, every entry expired) — never throws.
 *
 *  Storage is the `localStorage`-shaped Web Storage subset. `now`
 *  defaults to `Date.now()` so tests can pin a deterministic clock. */
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
  // Defensive: persisted buffer might be out-of-order if a future
  // writer mishandles it. Sort ascending so `computeRate`'s
  // chronological assumption holds.
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Best-effort persisted-buffer write. Silent on quota / private-mode
 *  failure, matching `saveToStorage` in `openmeteo-source.ts`. */
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
