import { useState } from "react";

import { BASE_FOLDER_KEY, FETCH_ON_SHOW_KEY, readLocal, writeLocal } from "./localSettings";

export interface RepositorySettings {
  /** The folder Open repository's and Clone's folder dialogs open in, and Clone clones into, or `null` for the OS's own choice. */
  baseFolder: string | null;
  chooseBaseFolder(folder: string | null): void;
  /** Whether a fetch starts as a repository's Tab is shown: on, unless turned off. */
  fetchOnShow: boolean;
  chooseFetchOnShow(on: boolean): void;
}

/**
 * Settings for working with repositories, kept on this machine: the base
 * folder the user keeps them in, such as `C:\projects`, which is set in
 * Settings, and whether switching to a repository's Tab fetches, as
 * GitKraken does, which is on unless turned off.
 */
export function useRepositorySettings(): RepositorySettings {
  const [baseFolder, setBaseFolder] = useState(() => {
    const kept = readLocal(BASE_FOLDER_KEY)?.trim();
    return kept ? kept : null;
  });
  const [fetchOnShow, setFetchOnShow] = useState(() => readLocal(FETCH_ON_SHOW_KEY) !== "off");
  return {
    baseFolder,
    chooseBaseFolder(folder) {
      const chosen = folder?.trim() ? folder.trim() : null;
      writeLocal(BASE_FOLDER_KEY, chosen ?? "");
      setBaseFolder(chosen);
    },
    fetchOnShow,
    chooseFetchOnShow(on) {
      writeLocal(FETCH_ON_SHOW_KEY, on ? "on" : "off");
      setFetchOnShow(on);
    },
  };
}
