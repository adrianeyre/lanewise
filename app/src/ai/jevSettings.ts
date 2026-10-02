import { useState } from "react";

import { JEV_KEY, readLocal, writeLocal } from "../settings/localSettings";

/**
 * Which decisions Jev makes (ADR 0036), kept under `lanewise.jev`: none
 * until the user turns Jev on and agrees to what each sends.
 */
export interface JevSettings {
  /** Jev is on, and the user agreed to what it's sent. */
  enabled: boolean;
  /** It checks each Suggestion, its verdict joining the Confidence. */
  suggestions: boolean;
  /** It says which side a Conflict Hunk likely takes, as a hint. */
  triage: boolean;
  /** It checks staged changes before a commit. */
  commits: boolean;
}

export const JEV_OFF: JevSettings = { enabled: false, suggestions: true, triage: true, commits: true };

export function readJevSettings(): JevSettings {
  try {
    const kept = JSON.parse(readLocal(JEV_KEY) ?? "null") as Partial<JevSettings> | null;
    if (kept === null || typeof kept !== "object") return JEV_OFF;
    return {
      enabled: kept.enabled === true,
      suggestions: kept.suggestions !== false,
      triage: kept.triage !== false,
      commits: kept.commits !== false,
    };
  } catch {
    return JEV_OFF;
  }
}

export function useJevSettings(): { jev: JevSettings; change(change: Partial<JevSettings>): void } {
  const [jev, setJev] = useState(readJevSettings);
  function change(changed: Partial<JevSettings>) {
    setJev((current) => {
      const next = { ...current, ...changed };
      writeLocal(JEV_KEY, JSON.stringify(next));
      return next;
    });
  }
  return { jev, change };
}
