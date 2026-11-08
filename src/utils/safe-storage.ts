// Guarded access to `window.localStorage`. Merely reading the property
// throws a SecurityError when storage is blocked (private mode in some
// browsers, enterprise policy, sandboxed iframes), so every cache in the
// card goes through this instead of touching the global directly.

export function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
