/**
 * The app's keyboard shortcuts, each with Ctrl, or ⌘ on a Mac, as each
 * platform's own apps have them. The title bar's menus show them beside
 * their items, and Help lists them all.
 */
export interface Shortcut {
  /** `KeyboardEvent.key`, as typed with no Shift: `o`, `,` or `Tab`. */
  key: string;
  shift?: boolean;
  /** Control on a Mac too, not ⌘, as ⌘Tab is the Mac's own app switcher. */
  control?: boolean;
}

export const SHORTCUTS = {
  openRepository: { key: "o" },
  cloneRepository: { key: "o", shift: true },
  newTab: { key: "t" },
  closeTab: { key: "w" },
  nextTab: { key: "Tab", control: true },
  previousTab: { key: "Tab", shift: true, control: true },
  settings: { key: "," },
  shortcuts: { key: "/" },
} as const satisfies Record<string, Shortcut>;

export type ShortcutName = keyof typeof SHORTCUTS;

/** Whether this is a Mac, where ⌘ stands in for Ctrl. */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Whether `event` is `shortcut`, pressed with Ctrl, or ⌘ on a Mac, and nothing else. */
export function matches(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, shortcut: Shortcut, mac = isMac()): boolean {
  const command = mac && !shortcut.control ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return (
    command &&
    !event.altKey &&
    event.shiftKey === (shortcut.shift ?? false) &&
    event.key.toLowerCase() === shortcut.key.toLowerCase()
  );
}

const KEY_NAMES: Record<string, string> = { ",": ",", "/": "/", Tab: "Tab" };

/** What a menu shows for `shortcut`: `Ctrl+Shift+O`, or `⇧⌘O` on a Mac. */
export function shortcutLabel(shortcut: Shortcut, mac = isMac()): string {
  const key = KEY_NAMES[shortcut.key] ?? shortcut.key.toUpperCase();
  if (!mac) return `Ctrl+${shortcut.shift ? "Shift+" : ""}${key}`;
  return `${shortcut.shift ? "⇧" : ""}${shortcut.control ? "⌃" : "⌘"}${key}`;
}

/** The same, as `aria-keyshortcuts` names it: `Control+Shift+O`, or `Meta+Shift+O`. */
export function ariaShortcut(shortcut: Shortcut, mac = isMac()): string {
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return [mac && !shortcut.control ? "Meta" : "Control", ...(shortcut.shift ? ["Shift"] : []), key].join("+");
}
