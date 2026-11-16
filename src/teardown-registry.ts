// Push-on-setup / drain-on-disconnect registry for the card's listeners,
// timers and observers: `add(() => observer.disconnect())` at setup,
// `drain()` in disconnectedCallback. drain() runs in registration order; a
// throwing fn is logged and does not stop the rest. Reusable after drain.

/** A teardown callback, invoked once on drain. */
export type TeardownFn = () => void;

export class TeardownRegistry {
  private _fns: TeardownFn[] = [];

  /** Register a teardown function. Non-function input is ignored, so callers
   *  can pass an optional unsubscribe without a guard. */
  add(fn: unknown): unknown {
    if (typeof fn === 'function') this._fns.push(fn as TeardownFn);
    return fn;
  }

  /** Run and clear every registered fn; a second call is a no-op. */
  drain(): void {
    const fns = this._fns;
    this._fns = [];
    for (const fn of fns) {
      try {
        fn();
      } catch (err) {
        console.error('[teardown-registry]', err);
      }
    }
  }

  /** Number of registered teardown functions. */
  get size(): number {
    return this._fns.length;
  }
}
