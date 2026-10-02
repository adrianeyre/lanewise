import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";

import { readLocal, SIDEBAR_SECTIONS_KEY, writeLocal } from "../settings/localSettings";

/** A section of the Repository page's left column, its accordion, by name. */
export type SidebarSection = "localBranches" | "remotes" | "tags" | "pullRequests" | "stashes" | "issues";

/** Open unless closed: but Tags, which a repository can have thousands of, starts closed (ADR 0043). */
const OPEN_AT_FIRST: Record<SidebarSection, boolean> = {
  localBranches: true,
  remotes: true,
  tags: false,
  pullRequests: true,
  stashes: true,
  issues: true,
};

const listeners = new Set<() => void>();

function stored(): Partial<Record<SidebarSection, boolean>> {
  try {
    const read: unknown = JSON.parse(readLocal(SIDEBAR_SECTIONS_KEY) ?? "{}");
    return typeof read === "object" && read !== null ? (read as Partial<Record<SidebarSection, boolean>>) : {};
  } catch {
    return {};
  }
}

/**
 * Whether the left column's section `name` is open, kept for every
 * repository and every launch, and what opens or closes it.
 */
export function useSectionOpen(name: SidebarSection): [boolean, () => void] {
  const open = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => stored()[name] ?? OPEN_AT_FIRST[name],
  );
  const toggle = useCallback(() => {
    writeLocal(SIDEBAR_SECTIONS_KEY, JSON.stringify({ ...stored(), [name]: !(stored()[name] ?? OPEN_AT_FIRST[name]) }));
    for (const listener of listeners) listener();
  }, [name]);
  return [open, toggle];
}

interface Props {
  /** The heading's level: a Widget's `h3`, or a group's `h4` inside one. */
  level: 3 | 4;
  open: boolean;
  onToggle: () => void;
  /** The ID of what it opens and closes, there only while it's open. */
  controls: string;
  /** The ID for its name, which the section is labelled by. */
  labelId: string;
  /** Its name, such as “Stashes”. */
  children: ReactNode;
  /** Beside its name, such as how many tags there are. */
  count?: ReactNode;
}

/**
 * The heading of an accordion's section: a button, with a chevron, that opens
 * and closes it, saying which it is with `aria-expanded`, by click, Enter or
 * Space.
 */
export function SectionHeading({ level, open, onToggle, controls, labelId, children, count }: Props) {
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <Heading className={level === 3 ? "surface-heading" : "surface-subheading"}>
      <button
        type="button"
        className="group-toggle"
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="button-icon" />
        ) : (
          <ChevronRight aria-hidden="true" className="button-icon" />
        )}
        <span id={labelId}>{children}</span>
        {count !== undefined && count !== null && (
          <>
            {" "}
            <span className="group-count">{count}</span>
          </>
        )}
      </button>
    </Heading>
  );
}
