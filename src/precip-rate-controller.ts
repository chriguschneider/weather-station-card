// Live rate derived from a cumulative rain counter (#472), as a Lit
// ReactiveController next to the data sources (ADR-0034).
//
// When `sensors.precipitation` reports a total instead of a rate (a depth
// unit, e.g. an Ecowitt counter in mm), the card keeps a
// sliding-anchor buffer of recent samples and shows the rate from it.
// The buffer is persisted per entity in localStorage, so a hard reload
// doesn't restart the 2–15 min warm-up. A 30-s wall-clock tick re-derives
// the rate without new samples: `computeRate` divides by `now`, so the
// rate decays during dry spells and snaps to 0 once the buffer empties.
//
// The controller owns the buffer, its entity and the tick; the card
// keeps the reading fields and decides which precipitation path runs.

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  appendSample,
  pruneOlderThan,
  computeRate,
  loadBuffer,
  saveBuffer,
  DEFAULT_MAX_AGE_MS,
  type Sample,
} from './precip-rate.js';
import { parseNumericSafe } from './utils/numeric.js';

/** What the controller needs from the card. */
export interface PrecipRateHost extends ReactiveControllerHost {
  /** Show the derived rate, in the counter's own unit per hour; true
   *  when the shown text changed. */
  applyDerivedRate(ratePerHour: number): boolean;
  /** The tick changed the shown rate outside a hass pass. */
  onDerivedPrecipTick(): void;
}

export interface CounterState {
  state: string;
  last_updated?: string;
}

const TICK_MS = 30_000;

export class PrecipRateController implements ReactiveController {
  buffer: Sample[] = [];
  /** Entity the buffer was hydrated for; a repoint re-seeds from that
   *  entity's own slot. */
  bufferEntity: string | undefined;
  /** Armed lazily on the first counter sample, so configs without a
   *  cumulative sensor never run a timer. */
  timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly host: PrecipRateHost) {
    host.addController(this);
  }

  hostDisconnected(): void {
    this._clearTimer();
  }

  /** Append the counter's current state and show the rate. Ignores a
   *  missing entity or a non-numeric / undated state. */
  derive(entityId: string | undefined, state: CounterState | undefined): void {
    if (!entityId || !state) return;
    const v = parseNumericSafe(state.state);
    if (v == null) return;
    const t = state.last_updated ? Date.parse(state.last_updated) : Date.now();
    if (!Number.isFinite(t)) return;

    // loadBuffer drops over-age entries inline, so the buffer starts pruned.
    if (this.bufferEntity !== entityId) {
      this.buffer = loadBuffer(entityId);
      this.bufferEntity = entityId;
    }
    const beforeAppend = this.buffer;
    this.buffer = appendSample(this.buffer, { t, v });
    // appendSample returns the SAME array for a duplicate (same t+v);
    // only a new sample needs the synchronous localStorage write.
    this.host.applyDerivedRate(this.recompute(entityId, this.buffer !== beforeAppend));
    this._scheduleTick();
  }

  /** Prune, persist when the buffer changed, and return the rate. The
   *  buffer holds raw values, so the rate is in the counter's own unit
   *  per hour; the card converts it. */
  recompute(entityId: string, bufferDirty = false): number {
    const beforePrune = this.buffer;
    this.buffer = pruneOlderThan(this.buffer, DEFAULT_MAX_AGE_MS);
    if (bufferDirty || this.buffer !== beforePrune) saveBuffer(entityId, this.buffer);
    return computeRate(this.buffer, Date.now()).rate;
  }

  /** Release the tick and the buffer identity. localStorage stays: going
   *  back to the counter rehydrates from it (loadBuffer prunes by age),
   *  so a temporary reconfiguration costs no warm-up. */
  stop(): void {
    this._clearTimer();
    this.buffer = [];
    this.bufferEntity = undefined;
  }

  private _scheduleTick(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      // Read at fire time, so an entity repoint needs no re-arm.
      const eid = this.bufferEntity;
      if (!eid) return;
      if (this.host.applyDerivedRate(this.recompute(eid))) {
        this.host.onDerivedPrecipTick();
      }
    }, TICK_MS);
  }

  private _clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
