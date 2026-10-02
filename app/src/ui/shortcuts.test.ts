import { expect, test } from "vitest";

import { ariaShortcut, matches, SHORTCUTS, shortcutLabel } from "./shortcuts";

const press = (key: string, modifiers: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

test("a shortcut is Ctrl and its key, or ⌘ on a Mac, and nothing else", () => {
  expect(matches(press("o", { ctrlKey: true }), SHORTCUTS.openRepository, false)).toBe(true);
  expect(matches(press("O", { ctrlKey: true, shiftKey: true }), SHORTCUTS.openRepository, false)).toBe(false);
  expect(matches(press("O", { ctrlKey: true, shiftKey: true }), SHORTCUTS.cloneRepository, false)).toBe(true);
  expect(matches(press("o", { metaKey: true }), SHORTCUTS.openRepository, true)).toBe(true);
  expect(matches(press("o", { ctrlKey: true }), SHORTCUTS.openRepository, true)).toBe(false);
  expect(matches(press("o", { ctrlKey: true, altKey: true }), SHORTCUTS.openRepository, false)).toBe(false);
  expect(matches(press("o"), SHORTCUTS.openRepository, false)).toBe(false);
});

test("menus show each as its platform writes it, and name it for screen readers", () => {
  expect(shortcutLabel(SHORTCUTS.cloneRepository, false)).toBe("Ctrl+Shift+O");
  expect(shortcutLabel(SHORTCUTS.cloneRepository, true)).toBe("⇧⌘O");
  expect(shortcutLabel(SHORTCUTS.settings, false)).toBe("Ctrl+,");
  expect(ariaShortcut(SHORTCUTS.cloneRepository, false)).toBe("Control+Shift+O");
  // Control on a Mac too, since ⌘Tab switches apps there.
  expect(ariaShortcut(SHORTCUTS.nextTab, true)).toBe("Control+Tab");
  expect(shortcutLabel(SHORTCUTS.previousTab, true)).toBe("⇧⌃Tab");
  expect(matches(press("Tab", { ctrlKey: true }), SHORTCUTS.nextTab, true)).toBe(true);
});
