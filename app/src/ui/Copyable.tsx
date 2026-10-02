import { createContext, type ReactNode, useContext } from "react";

/** Copies `text`, and says so: `what` names it, such as “commit ID” or “branch name”. */
export type Copy = (text: string, what: string) => void;

/** What copies a commit ID or a name clicked, where the platform can copy; `null` where it can't. */
export const Copying = createContext<Copy | null>(null);

/** What copies a commit ID or name clicked, or `null` where nothing can. */
export function useCopy(): Copy | null {
  return useContext(Copying);
}

interface Props {
  /** What's copied, such as a commit's full ID. */
  text: string;
  /** What it is, such as “commit ID”. */
  what: string;
  /** What shows, such as the commit's short ID. */
  children: ReactNode;
  className?: string;
}

/**
 * A commit ID or a name a click copies, as a button, so the keyboard copies
 * it too: plain text where nothing can copy.
 */
export function Copyable({ text, what, children, className }: Props) {
  const copy = useCopy();
  if (copy === null) return <code className={className}>{children}</code>;
  return (
    <button
      type="button"
      className={`copyable${className === undefined ? "" : ` ${className}`}`}
      title={`${text}: click to copy the ${what}`}
      aria-label={`${text}, copy the ${what}`}
      onClick={() => copy(text, what)}
    >
      {children}
    </button>
  );
}
