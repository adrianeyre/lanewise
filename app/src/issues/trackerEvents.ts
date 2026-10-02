import { useEffect, useRef } from "react";

/** The window event Settings sends once an Issue Tracker account is saved or forgotten. */
const CHANGED = "lanewise:issue-trackers-changed";

/** Tells every Issues Widget open that the saved Issue Tracker accounts changed, to read them again. */
export function announceIssueTrackersChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** Calls `onChange` each time the saved Issue Tracker accounts change in Settings. */
export function useIssueTrackersChanged(onChange: () => void): void {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const changed = () => callback.current();
    window.addEventListener(CHANGED, changed);
    return () => window.removeEventListener(CHANGED, changed);
  }, []);
}
