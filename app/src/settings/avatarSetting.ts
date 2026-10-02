import { useState } from "react";

import { AVATARS_KEY, readLocal, writeLocal } from "./localSettings";

/**
 * Whether authors' pictures come from GitHub for a repository there
 * (ADR 0035): on, unless turned off in Settings, when `lanewise.avatars` is `off`.
 */
export function useAvatarSetting(): { on: boolean; choose(on: boolean): void } {
  const [on, setOn] = useState(() => readLocal(AVATARS_KEY) !== "off");
  function choose(wanted: boolean) {
    writeLocal(AVATARS_KEY, wanted ? "on" : "off");
    setOn(wanted);
  }
  return { on, choose };
}
