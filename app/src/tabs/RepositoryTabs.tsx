import { ArrowLeft, ArrowRight, Ellipsis, FolderGit2, House, Plus, X } from "lucide-react";
import { HostLogo } from "../hosts/OpenOnHost";
import { webPageOf } from "../hosts/webPage";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Menu, type MenuItem } from "../ui/Menu";
import type { Tab, Tabs } from "./tabs";

interface Props {
  state: Tabs;
  onActivate(key: number): void;
  onClose(key: number): void;
  onMove(key: number, index: number): void;
  /** Shows the Welcome screen in a Tab, to open another repository. */
  onNewTab(): void;
}

/** The id of the Tab keyed `key`: there is one tablist in the window. */
export function tabElementId(key: number): string {
  return `tab-${key}`;
}

/** The id of the tabpanel, which shows the Tab that's selected. */
export const TAB_PANEL_ID = "tab-panel";

/** What a Tab is called: a Host page by its title, or where it is until it has one. */
export function tabName(tab: Tab): string {
  if (tab.kind === "welcome") return "Welcome";
  if (tab.kind === "repository") return tab.repository.name;
  return tab.title || new URL(tab.url).host;
}

/**
 * The window's Tabs (PRD §7.1), as the WAI-ARIA APG's tabs with automatic
 * activation: Tab reaches the selected one, the arrow keys, Home and End
 * select another, Shift and an arrow key move it, and Delete closes it,
 * each move announced. By pointer, a Tab is chosen by clicking, closed by
 * its ×, or a middle click, and moved by dragging, and the Tab actions menu
 * moves or closes the selected one without dragging (WCAG 2.5.7). The ×
 * isn't a button of its own, since a tab can't hold one; Delete and the menu
 * are its keyboard alternatives.
 */
export function RepositoryTabs({ state, onActivate, onClose, onMove, onNewTab }: Props) {
  const { tabs, active } = state;
  const hintId = useId();
  const [announcement, setAnnouncement] = useState("");
  const dragging = useRef<number | null>(null);
  // The Tab the keyboard moved to, moved or left focus for, so focus follows once it's drawn.
  const [focusTarget, setFocusTarget] = useState<{ key: number } | null>(null);

  useEffect(() => {
    if (focusTarget !== null) document.getElementById(tabElementId(focusTarget.key))?.focus();
  }, [focusTarget]);

  useEffect(() => {
    const stop = () => {
      dragging.current = null;
    };
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
    return () => {
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
    };
  }, []);

  function move(tab: Tab, index: number) {
    const to = Math.max(0, Math.min(index, tabs.length - 1));
    if (to === tabs.indexOf(tab)) return;
    onMove(tab.key, to);
    setAnnouncement(`${tabName(tab)} moved to tab ${to + 1} of ${tabs.length}.`);
  }

  function select(key: number) {
    setFocusTarget({ key });
    onActivate(key);
  }

  function onKeyDown(event: KeyboardEvent, tab: Tab, index: number) {
    const last = tabs.length - 1;
    const neighbour = (step: number) => tabs[(index + step + tabs.length) % tabs.length]!;
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      move(tab, index + (event.key === "ArrowLeft" ? -1 : 1));
      setFocusTarget({ key: tab.key });
    } else if (event.key === "ArrowLeft") {
      select(neighbour(-1).key);
    } else if (event.key === "ArrowRight") {
      select(neighbour(1).key);
    } else if (event.key === "Home") {
      select(tabs[0]!.key);
    } else if (event.key === "End") {
      select(tabs[last]!.key);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      // Closing it shows the Tab after it, or before it, as `closeTab` does.
      const next = tabs[index + 1] ?? tabs[index - 1];
      if (next !== undefined) setFocusTarget({ key: next.key });
      onClose(tab.key);
      setAnnouncement(`${tabName(tab)} closed.`);
    } else {
      return;
    }
    event.preventDefault();
  }

  const selectedIndex = tabs.findIndex((tab) => tab.key === active);
  const selected = tabs[selectedIndex];
  const actions: MenuItem[] =
    selected === undefined
      ? []
      : [
          ...(selectedIndex > 0
            ? [
                {
                  kind: "action" as const,
                  id: "left",
                  label: "Move tab left",
                  icon: <ArrowLeft className="menu-icon-glyph" />,
                  onSelect: () => move(selected, selectedIndex - 1),
                },
              ]
            : []),
          ...(selectedIndex < tabs.length - 1
            ? [
                {
                  kind: "action" as const,
                  id: "right",
                  label: "Move tab right",
                  icon: <ArrowRight className="menu-icon-glyph" />,
                  onSelect: () => move(selected, selectedIndex + 1),
                },
              ]
            : []),
          {
            kind: "action",
            id: "close",
            label: "Close tab",
            icon: <X className="menu-icon-glyph" />,
            onSelect: () => {
              onClose(selected.key);
              setAnnouncement(`${tabName(selected)} closed.`);
            },
          },
        ];

  return (
    <div className="tab-strip">
      <div role="tablist" aria-label="Open repositories" className="tab-list">
        {tabs.map((tab, index) => {
          const isSelected = tab.key === active;
          const rootId = `${tabElementId(tab.key)}-root`;
          return (
            <button
              key={tab.key}
              id={tabElementId(tab.key)}
              type="button"
              role="tab"
              className="tab"
              aria-selected={isSelected}
              aria-controls={isSelected ? TAB_PANEL_ID : undefined}
              aria-describedby={tab.kind === "repository" ? `${rootId} ${hintId}` : hintId}
              tabIndex={isSelected ? 0 : -1}
              title={tab.kind === "repository" ? tab.repository.root : tab.kind === "hostPage" ? tab.url : undefined}
              onClick={() => onActivate(tab.key)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab.key);
              }}
              onKeyDown={(event) => onKeyDown(event, tab, index)}
              onPointerDown={(event) => {
                if (event.button === 0) dragging.current = tab.key;
              }}
              onPointerEnter={() => {
                const dragged = tabs.find((each) => each.key === dragging.current);
                if (dragged !== undefined && dragged !== tab) move(dragged, index);
              }}
            >
              {tab.kind === "welcome" ? (
                <House aria-hidden="true" className="tab-icon" />
              ) : tab.kind === "hostPage" ? (
                <span className="tab-icon">
                  <HostLogo integration={webPageOf(tab.url)?.integration ?? "generic"} />
                </span>
              ) : (
                <FolderGit2 aria-hidden="true" className="tab-icon" />
              )}
              <span className="tab-name">{tabName(tab)}</span>
              {tab.kind === "repository" && (
                <span id={rootId} hidden>
                  {tab.repository.root}
                </span>
              )}
              <span
                aria-hidden="true"
                className="tab-close"
                title="Close tab"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.key);
                }}
              >
                <X className="tab-close-icon" />
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className="button tab-new" aria-label="New tab" title="New tab" onClick={onNewTab}>
        <Plus aria-hidden="true" className="button-icon" />
      </button>
      <Menu ariaLabel="Tab actions" label={<Ellipsis aria-hidden="true" className="button-icon" />} items={actions} />
      <p id={hintId} hidden>
        Arrow keys choose another tab, Shift and an arrow key move this one, and Delete closes it.
      </p>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </div>
  );
}
