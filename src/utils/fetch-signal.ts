// Abort-signal helpers for the card's outbound HTTP calls (Open-Meteo).

/** Upper bound for one Open-Meteo request. Without it a stalled
 *  connection keeps `ensureFresh` in flight forever and no refresh is
 *  ever retried. */
export const FETCH_TIMEOUT_MS = 15_000;

/** `signal` combined with a timeout. Falls back to whichever part the
 *  runtime supports (`AbortSignal.timeout` / `AbortSignal.any` are
 *  missing in older browsers and some test environments). */
export function withTimeout(signal: AbortSignal | undefined, ms: number = FETCH_TIMEOUT_MS): AbortSignal | undefined {
  const AS = typeof AbortSignal === 'function' ? AbortSignal : undefined;
  const timeout = typeof AS?.timeout === 'function' ? AS.timeout(ms) : undefined;
  if (!signal) return timeout;
  if (!timeout) return signal;
  return typeof AS?.any === 'function' ? AS.any([signal, timeout]) : signal;
}

function abortError(): Error {
  if (typeof DOMException === 'function') return new DOMException('Aborted', 'AbortError');
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/** Await `promise` unless `signal` aborts first, then reject with an
 *  AbortError. The underlying work keeps running — used for fetches
 *  shared between cards, where one card leaving must not cancel the
 *  request the others are waiting on. */
export function abandonOnAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(abortError());
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}
