// querySelector that tolerates a missing root: `set hass` and timers can fire
// before Lit's first render has built the shadow tree.
export function safeQuery<T extends Element = Element>(
  root: ParentNode | null | undefined,
  selector: string,
): T | null {
  return root ? root.querySelector<T>(selector) : null;
}
