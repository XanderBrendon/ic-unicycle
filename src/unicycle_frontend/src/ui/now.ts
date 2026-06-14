// One shared client-side clock that keeps relative-time displays (fmtAgo /
// fmtUntil) current. A single module-level interval ticks once a minute and
// drives every consumer through useSyncExternalStore — display-only, no network.
// The interval runs only while at least one relative-time component is mounted.
import { useSyncExternalStore } from 'react';

let current = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (timer === null) {
    current = Date.now(); // refresh when (re)starting so the first paint is accurate
    timer = setInterval(() => {
      current = Date.now();
      for (const l of listeners) l();
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Milliseconds since epoch, refreshed every minute. Subscribing components
// re-render together on each tick so their relative-time text stays current.
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current);
}
