import { vi } from "vitest";

/**
 * Stands in for the OS's light or dark setting, which jsdom has no
 * `matchMedia` for: `prefers-color-scheme: dark` matches while it is dark,
 * and `set` changes it as the OS would, telling each listener.
 */
export function fakeOsTheme(dark = false): { set(dark: boolean): void } {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = (media: string) => ({
    media,
    get matches() {
      return media === "(prefers-color-scheme: dark)" ? dark : false;
    },
    addEventListener: (_: "change", listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: "change", listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  });
  vi.stubGlobal("matchMedia", query);
  return {
    set(now) {
      dark = now;
      for (const listener of listeners) listener({ matches: now } as MediaQueryListEvent);
    },
  };
}
