import { useCallback, useState } from "react";

import { MODEL_PROVIDER_KEY, readLocal, writeLocal } from "../settings/localSettings";
import { type AiSettings, parseAiSettings } from "./aiSettings";

export interface AiSettingsState {
  settings: AiSettings;
  /** Changes the AI settings, and keeps them for the next launch. */
  change(change: (settings: AiSettings) => AiSettings): void;
}

/**
 * The AI settings, kept by the App so Settings and the Conflicts page share
 * them, and kept in local storage for the next launch. Never an API key.
 */
export function useAiSettings(): AiSettingsState {
  const [settings, setSettings] = useState<AiSettings>(() => parseAiSettings(readLocal(MODEL_PROVIDER_KEY)));

  const change = useCallback((next: (settings: AiSettings) => AiSettings) => {
    setSettings((previous) => {
      const changed = next(previous);
      writeLocal(MODEL_PROVIDER_KEY, JSON.stringify(changed));
      return changed;
    });
  }, []);

  return { settings, change };
}
