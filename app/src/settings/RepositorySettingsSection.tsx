import { FolderOpen, X } from "lucide-react";
import { useId, useState } from "react";

import type { Platform } from "../platform/platform";
import { describeFailure } from "../repository/problems";
import type { RepositorySettings } from "./repositorySettings";

interface Props {
  settings: RepositorySettings;
  /** Asks for the base folder with the platform's own folder dialog. */
  chooseFolder: Platform["chooseFolder"];
}

/**
 * Settings for working with repositories: the base folder the user keeps
 * them in, such as `C:\projects`, which Open repository's and Clone's
 * folder dialogs open in and Clone clones into, typed or chosen, and
 * whether switching to a repository's Tab fetches from its remotes. Each is
 * kept as it changes, a typed folder once the field is left.
 */
export function RepositorySettingsSection({ settings, chooseFolder }: Props) {
  const headingId = useId();
  const folderId = useId();
  const folderNoteId = useId();
  const fetchNoteId = useId();
  const problemId = useId();
  const [typed, setTyped] = useState(settings.baseFolder ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function keep(folder: string | null) {
    const chosen = folder?.trim() ? folder.trim() : null;
    setTyped(chosen ?? "");
    setProblem(null);
    if (chosen === settings.baseFolder) return;
    settings.chooseBaseFolder(chosen);
    setAnnouncement(chosen === null ? "The base folder was cleared." : `The base folder is ${chosen}.`);
  }

  async function browse() {
    try {
      const folder = await chooseFolder("Choose the base folder", settings.baseFolder);
      if (folder !== null) keep(folder);
    } catch (failure) {
      setProblem(describeFailure(failure));
    }
  }

  return (
    <section className="settings-group" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-legend">
        Repositories
      </h3>
      <div className="branch-field">
        <label htmlFor={folderId}>Base folder</label>
        <div className="clone-folder">
          <input
            id={folderId}
            type="text"
            value={typed}
            placeholder="None"
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => keep(typed)}
            onKeyDown={(event) => {
              if (event.key === "Enter") keep(typed);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby={[folderNoteId, problem === null ? undefined : problemId].filter(Boolean).join(" ")}
          />
          <button type="button" className="button" onClick={() => void browse()}>
            <FolderOpen aria-hidden="true" className="button-icon" />
            Choose…
          </button>
          {settings.baseFolder !== null && (
            <button type="button" className="button" aria-label="Clear the base folder" onClick={() => keep(null)}>
              <X aria-hidden="true" className="button-icon" />
              Clear
            </button>
          )}
        </div>
        <p id={folderNoteId} className="settings-choice-note">
          The folder you keep your repositories in, such as C:\projects or ~/projects. Opening a repository starts
          there, and Clone clones into it unless you choose another folder.
        </p>
        {problem !== null && (
          <p id={problemId} role="alert" className="problem">
            {problem}
          </p>
        )}
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.fetchOnShow}
          aria-describedby={fetchNoteId}
          onChange={(event) => {
            settings.chooseFetchOnShow(event.target.checked);
            setAnnouncement(
              event.target.checked
                ? "Lanewise fetches as you switch to a repository's tab, and as you come back to Lanewise."
                : "Lanewise no longer fetches as you switch tabs or come back to it.",
            );
          }}
        />
        Fetch when you switch to a repository&apos;s tab or come back to Lanewise
      </label>
      <p id={fetchNoteId} className="settings-choice-note">
        Brings in every remote&apos;s new commits as a repository&apos;s tab is shown, and as you click back into
        Lanewise&apos;s window, at most every 30 seconds, so its Commit graph and its Upstream&apos;s ahead and
        behind counts are up to date. It never changes your branches or working tree.
      </p>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </section>
  );
}
