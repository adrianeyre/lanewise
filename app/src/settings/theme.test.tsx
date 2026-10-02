// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fakeOsTheme } from "../test/osTheme";
import { THEME_KEY } from "./localSettings";
import { readThemePreference, resolveTheme, type Theme, type ThemePreference, useTheme } from "./theme";

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root.removeAttribute("data-theme");
  root.removeAttribute("style");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the saved Theme", () => {
  test("is System until one is chosen", () => {
    expect(readThemePreference()).toBe("system");
  });

  test.each(["light", "dark", "system"] as const)("%s is read back", (preference) => {
    localStorage.setItem(THEME_KEY, preference);
    expect(readThemePreference()).toBe(preference);
  });

  test("one this version doesn't know is System", () => {
    localStorage.setItem(THEME_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
  });
});

test.each([
  ["system", false, "light"],
  ["system", true, "dark"],
  ["light", true, "light"],
  ["dark", false, "dark"],
] as const)("%s with the OS dark: %s is shown %s", (preference, dark, theme) => {
  fakeOsTheme(dark);
  expect(resolveTheme(preference)).toBe(theme);
});

test("with no way to read the OS's setting, System is light, as styles.css's :root is", () => {
  expect(resolveTheme("system")).toBe("light");
});

function shown(): { theme: string | undefined; colorScheme: string } {
  return { theme: root.dataset.theme, colorScheme: root.style.colorScheme };
}

describe("useTheme", () => {
  const onChosen = vi.fn<(theme: Theme | null) => void>();
  beforeEach(() => onChosen.mockClear());

  test("System follows the OS as it changes, and tells the window to", () => {
    const os = fakeOsTheme(false);
    renderHook(() => useTheme({ onChosen }));

    expect(shown()).toEqual({ theme: "light", colorScheme: "light" });
    act(() => os.set(true));
    expect(shown()).toEqual({ theme: "dark", colorScheme: "dark" });
    act(() => os.set(false));
    expect(shown()).toEqual({ theme: "light", colorScheme: "light" });
    expect(onChosen.mock.calls).toEqual([[null]]);
  });

  test("a Theme chosen is shown at once, kept, and no longer follows the OS", () => {
    const os = fakeOsTheme(false);
    const { result } = renderHook(() => useTheme({ onChosen }));

    act(() => result.current.choose("dark"));
    expect(result.current.preference).toBe("dark");
    expect(shown()).toEqual({ theme: "dark", colorScheme: "dark" });
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(onChosen).toHaveBeenLastCalledWith("dark");

    act(() => os.set(true));
    act(() => os.set(false));
    expect(shown().theme).toBe("dark");

    act(() => result.current.choose("system"));
    expect(shown().theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("system");
    expect(onChosen).toHaveBeenLastCalledWith(null);
    act(() => os.set(true));
    expect(shown().theme).toBe("dark");
  });

  test("the saved Theme is the one shown on launch", () => {
    fakeOsTheme(true);
    localStorage.setItem(THEME_KEY, "light");
    const { result } = renderHook(() => useTheme({ onChosen }));

    expect(result.current.preference).toBe("light");
    expect(shown().theme).toBe("light");
    expect(onChosen.mock.calls).toEqual([["light"]]);
  });
});

describe("index.html's script, before first paint", () => {
  const html = readFileSync(join(import.meta.dirname, "../../index.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) => script!);
  const firstPaint = () => new Function(scripts[0]!)() as void;

  test("runs in the head, before the stylesheet and the app load", () => {
    expect(scripts).toHaveLength(1);
    expect(html.indexOf(scripts[0]!)).toBeLessThan(html.indexOf("</head>"));
    expect(html.indexOf(scripts[0]!)).toBeLessThan(html.indexOf('<script type="module"'));
  });

  test("reads the Theme where the app keeps it", () => {
    expect(scripts[0]).toContain(`"${THEME_KEY}"`);
  });

  test.each(
    (["system", "light", "dark", "sepia", null] as const).flatMap((saved) =>
      [false, true].map((dark): [ThemePreference | "sepia" | null, boolean] => [saved, dark]),
    ),
  )("saved as %s with the OS dark: %s, it shows what the app will", (saved, dark) => {
    fakeOsTheme(dark);
    if (saved !== null) localStorage.setItem(THEME_KEY, saved);

    firstPaint();

    const theme = resolveTheme(readThemePreference());
    expect(shown()).toEqual({ theme, colorScheme: theme });
  });

  test("with local storage refused, it shows the OS's theme", () => {
    fakeOsTheme(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Refused", "SecurityError");
    });

    firstPaint();

    expect(shown().theme).toBe("dark");
    vi.restoreAllMocks();
  });
});
