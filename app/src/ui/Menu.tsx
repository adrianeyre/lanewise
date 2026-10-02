import { Check, ChevronDown, ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | {
      kind: "action";
      id: string;
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      /** What its shortcut is, shown at its end, and named to screen readers. */
      shortcut?: { label: string; aria: string };
    }
  | {
      kind: "checkbox";
      id: string;
      label: string;
      checked: boolean;
      onToggle: () => void;
      /** Said beside it, and read out with it: why ticking it shows nothing yet, such as "empty". */
      note?: string;
    }
  /** Says something, such as the version, and does nothing when chosen: read out as unavailable, and still reached by the arrow keys. */
  | { kind: "note"; id: string; label: string }
  /** Opens a menu of its own, to the right of it. */
  | { kind: "submenu"; id: string; label: string; icon?: ReactNode; items: readonly MenuItem[] }
  | { kind: "separator"; id: string };

export interface MenuProps {
  /** What the button says. */
  label: ReactNode;
  /** What the button and its menu are to a screen reader, such as "Grid". */
  ariaLabel: string;
  items: readonly MenuItem[];
  /** Whether the button ends in a chevron: `true` unless it's said otherwise. */
  chevron?: boolean;
  /** The button's class, `button` unless it's given. */
  buttonClassName?: string;
  /** Which of the button's edges the menu lines up with: its end, unless it's said otherwise. */
  align?: "start" | "end";
}

/**
 * Where menus are drawn: over the page, outside every Widget that scrolls
 * or clips, so no Widget beside one hides it. In a modal dialog, inside it,
 * since the page behind is inert.
 */
function menuLayer(near: Element | null): Element {
  return near?.closest("dialog[open]") ?? document.body;
}

/** Calls `move` as the page scrolls or the window resizes, while `open`, but not for the menu's own scrolling. */
function useOnMove(open: boolean, list: RefObject<HTMLElement | null>, move: () => void) {
  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  }, [move]);
  useEffect(() => {
    if (!open) return;
    const scrolled = (event: Event) => {
      if (event.target instanceof Node && list.current?.contains(event.target)) return;
      moveRef.current();
    };
    const resized = () => moveRef.current();
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
    };
  }, [open, list]);
}

/**
 * A menu button (WAI-ARIA APG): Enter, Space or the down arrow open it on
 * its first item, the up arrow on its last; the arrows, Home and End move
 * between items; Escape and Tab close it, and Escape hands focus back to
 * the button. A click outside closes it too. Its checkboxes toggle without
 * closing it, so several can be changed in one visit. A submenu opens to the
 * right on Enter, Space, the right arrow, a click or the pointer resting on
 * it, and the left arrow or Escape close it back to its item. The list is
 * drawn over the page, under its button, so a Widget that scrolls or clips,
 * such as the sidebar, never hides it, and it keeps to its button as the
 * page scrolls. Carried over from soundcheck's `Menu`.
 */
export function Menu({
  label,
  ariaLabel,
  items,
  chevron = true,
  buttonClassName = "button",
  align = "end",
}: MenuProps) {
  const [open, setOpen] = useState<"first" | "last" | null>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  // Where the list is drawn, found as it opens.
  const [layer, setLayer] = useState<Element | null>(null);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !layerRef.current?.contains(target)) setOpen(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  // Under the button, lined up with its start or end edge, in the window's CSS pixels.
  const place = () => {
    const box = buttonRef.current?.getBoundingClientRect();
    if (!box) return;
    const width = document.documentElement.clientWidth;
    setAt(align === "start" ? { top: box.bottom + 4, left: box.left } : { top: box.bottom + 4, right: width - box.right });
  };
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  });
  useLayoutEffect(() => {
    if (!open) return;
    setLayer(menuLayer(rootRef.current));
    placeRef.current();
  }, [open]);
  useOnMove(open !== null, layerRef, place);

  const close = (returnFocus: boolean) => {
    setOpen(null);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen("last");
    }
  };

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen("first"))}
        onKeyDown={onButtonKey}
      >
        {label}
        {chevron && <ChevronDown aria-hidden="true" className="button-icon menu-chevron" />}
      </button>
      {open &&
        at !== null &&
        layer !== null &&
        createPortal(
          <div ref={layerRef} className={`menu menu-layer menu-layer-${align}`} style={at}>
            <MenuList id={menuId} ariaLabel={ariaLabel} items={items} focusFirst={open} onClose={close} />
          </div>,
          layer,
        )}
    </div>
  );
}

export interface ContextMenuProps {
  /** What the menu is to a screen reader, such as "Actions for commit abc1234". */
  ariaLabel: string;
  items: readonly MenuItem[];
  /** Where it opens, in the window's CSS pixels: at the pointer, or beside what has focus. */
  at: { x: number; y: number };
  /** Closes it, handing focus back to what it was opened on or not. */
  onClose: (returnFocus: boolean) => void;
}

/**
 * A menu opened on something by a right click, Shift+F10 or the Menu key,
 * at the pointer, with focus on its first item. It works as {@link Menu}'s
 * list does, and a click outside it closes it.
 */
export function ContextMenu({ ariaLabel, items, at, onClose }: ContextMenuProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeRef.current(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  // Drawn over the page, so a Widget that scrolls or clips never hides it.
  const [layer] = useState(() => menuLayer(document.activeElement));
  return createPortal(
    <div ref={rootRef} className="menu context-menu" style={{ left: at.x, top: at.y }}>
      <MenuList id={id} ariaLabel={ariaLabel} items={items} focusFirst="first" onClose={onClose} />
    </div>,
    layer,
  );
}

interface MenuListProps {
  id: string;
  ariaLabel: string;
  items: readonly MenuItem[];
  /** Which item has focus when it opens. */
  focusFirst: "first" | "last";
  /** Close the menu, handing focus back to its button or not. */
  onClose: (returnFocus: boolean) => void;
  /** For a submenu: close it alone, handing focus back to the item that opened it. */
  onBack?: () => void;
  /** Whether an item takes focus as it opens: not for a submenu the pointer opened. */
  autoFocus?: boolean;
}

function MenuList({ id, ariaLabel, items, focusFirst, onClose, onBack, autoFocus = true }: MenuListProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const actionable = items.flatMap((item, index) => (item.kind === "separator" ? [] : [index]));
  const [focusAt, setFocusAt] = useState(
    !autoFocus ? undefined : focusFirst === "first" ? actionable[0] : actionable.at(-1),
  );
  // The submenu open, by its item's index, and whether it takes focus as it opens.
  const [openSub, setOpenSub] = useState<{ index: number; focus: boolean } | null>(null);
  const subId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  // Kept inside the window: a submenu with no room at the right opens at the
  // left of its item, and any other menu is moved in from the edge it would
  // cross, such as a menu opened near the window's left edge.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const margin = 4;
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    let box = list.getBoundingClientRect();
    if (box.width === 0) return;
    if (onBack && box.right > width - margin) {
      list.classList.add("menu-list-flipped");
      box = list.getBoundingClientRect();
    }
    const x = box.left < margin ? margin - box.left : box.right > width - margin ? width - margin - box.right : 0;
    const y = box.bottom > height - margin ? Math.max(height - margin - box.bottom, margin - box.top) : 0;
    if (x !== 0 || y !== 0) list.style.translate = `${x}px ${y}px`;
  }, [onBack]);

  useEffect(() => {
    if (focusAt !== undefined) itemRefs.current[focusAt]?.focus();
  }, [focusAt]);

  const openSubmenu = (index: number, focus: boolean) => {
    setFocusAt(index);
    setOpenSub({ index, focus });
  };

  const onKey = (event: KeyboardEvent) => {
    const current = itemRefs.current.indexOf(event.target as HTMLButtonElement);
    if (current === -1) return;
    const at = actionable.indexOf(current);
    const to =
      event.key === "ArrowDown"
        ? actionable[(at + 1) % actionable.length]
        : event.key === "ArrowUp"
          ? actionable[(at - 1 + actionable.length) % actionable.length]
          : event.key === "Home"
            ? actionable[0]
            : event.key === "End"
              ? actionable.at(-1)
              : undefined;
    if (to !== undefined) {
      event.preventDefault();
      setOpenSub(null);
      setFocusAt(to);
    } else if (event.key === "ArrowRight" && items[current]?.kind === "submenu") {
      event.preventDefault();
      openSubmenu(current, true);
    } else if (event.key === "ArrowLeft" && onBack) {
      event.preventDefault();
      onBack();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (onBack) onBack();
      else onClose(true);
    } else if (event.key === "Tab") {
      onClose(false);
    }
  };

  return (
    <div ref={listRef} role="menu" id={id} aria-label={ariaLabel} className="menu-list">
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return <div key={item.id} role="separator" className="menu-separator" />;
        }
        const ref = (element: HTMLButtonElement | null) => {
          itemRefs.current[index] = element;
        };
        const checkbox = item.kind === "checkbox";
        const submenu = item.kind === "submenu";
        const expanded = submenu && openSub?.index === index;
        return (
          <div key={item.id} className="menu-entry" role="none">
            <button
              ref={ref}
              type="button"
              role={checkbox ? "menuitemcheckbox" : "menuitem"}
              aria-checked={checkbox ? item.checked : undefined}
              aria-haspopup={submenu ? "menu" : undefined}
              aria-expanded={submenu ? expanded : undefined}
              aria-controls={expanded ? subId : undefined}
              aria-keyshortcuts={item.kind === "action" ? item.shortcut?.aria : undefined}
              aria-disabled={item.kind === "note" || undefined}
              tabIndex={-1}
              className={item.kind === "note" ? "menu-item menu-item-note" : "menu-item"}
              onKeyDown={(event) => {
                // Enter and Space open a submenu on its first item; the other keys move through this one.
                if (submenu && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  openSubmenu(index, true);
                  return;
                }
                onKey(event);
              }}
              onPointerEnter={() => {
                if (submenu) openSubmenu(index, false);
                else if (openSub !== null) setOpenSub(null);
              }}
              onClick={() => {
                if (item.kind === "submenu") {
                  openSubmenu(index, true);
                  return;
                }
                if (item.kind === "checkbox") {
                  setFocusAt(index);
                  item.onToggle();
                  return;
                }
                if (item.kind === "note") return;
                // Focus goes back to the button, so whatever the item changes, focus isn't lost.
                onClose(true);
                item.onSelect();
              }}
            >
              {/* Kept for every item, so the labels line up whether or not an item is ticked. */}
              <span className="menu-icon" aria-hidden="true">
                {checkbox ? item.checked && <Check className="menu-icon-glyph" /> : item.kind === "note" ? null : item.icon}
              </span>
              <span className="menu-label">
                {item.label}
                {checkbox && item.note && (
                  <>
                    {" "}
                    <span className="menu-note">({item.note})</span>
                  </>
                )}
              </span>
              {item.kind === "action" && item.shortcut && (
                <kbd className="menu-shortcut" aria-hidden="true">
                  {item.shortcut.label}
                </kbd>
              )}
              {submenu && <ChevronRight aria-hidden="true" className="menu-icon-glyph menu-submenu-chevron" />}
            </button>
            {expanded && (
              <MenuList
                key={`${index}:${openSub.focus}`}
                id={subId}
                ariaLabel={item.label}
                items={item.items}
                focusFirst="first"
                autoFocus={openSub.focus}
                onClose={onClose}
                onBack={() => {
                  setOpenSub(null);
                  itemRefs.current[index]?.focus();
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
