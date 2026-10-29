"use client";
import { useSyncExternalStore } from "react";

/** One shared ticking clock per interval, so a page full of countdowns runs one timer. */
interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
  subscribe: (cb: () => void) => () => void;
  get: () => number;
}

const clocks = new Map<number, Clock>();

function clock(intervalMs: number): Clock {
  let c = clocks.get(intervalMs);
  if (c) return c;
  const self: Clock = {
    now: Date.now(),
    listeners: new Set(),
    subscribe(cb) {
      self.listeners.add(cb);
      if (!self.timer) {
        self.timer = setInterval(() => {
          self.now = Date.now();
          self.listeners.forEach((l) => l());
        }, intervalMs);
      }
      return () => {
        self.listeners.delete(cb);
        if (!self.listeners.size) {
          clearInterval(self.timer);
          self.timer = undefined;
        }
      };
    },
    get() {
      // Refresh a stale reading (e.g. the first render after idle).
      if (Date.now() - self.now >= intervalMs) self.now = Date.now();
      return self.now;
    },
  };
  clocks.set(intervalMs, self);
  return (c = self);
}

/**
 * Current time in ms, ticking every `intervalMs`. Null on the server and
 * during hydration: reading the clock during prerender is a build error with
 * Cache Components, and it keeps server and client HTML identical.
 */
export function useNow(intervalMs = 1000): number | null {
  const c = clock(intervalMs);
  return useSyncExternalStore(c.subscribe, c.get, () => null);
}
