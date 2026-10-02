import { useState } from "react";

import { HOST_PAGES_KEY, readLocal, writeLocal } from "./localSettings";

/**
 * Whether a Host's pages, such as a repository or a Pull Request on GitHub,
 * open in Tabs of Lanewise's own where the shell can show them (ADR 0042):
 * on, unless turned off in Settings, when `lanewise.hostPages` is `off`.
 */
export function useHostPagesSetting(): { on: boolean; choose(on: boolean): void } {
  const [on, setOn] = useState(() => readLocal(HOST_PAGES_KEY) !== "off");
  function choose(wanted: boolean) {
    writeLocal(HOST_PAGES_KEY, wanted ? "on" : "off");
    setOn(wanted);
  }
  return { on, choose };
}
