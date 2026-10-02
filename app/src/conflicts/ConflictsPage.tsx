import { useEffect, useState } from "react";

import type { AiAccess } from "../ai/requests";

import type { CommandClient, InProgressOperation, OpenedRepository } from "../commands/api";
import { ConflictedFilesWidget } from "./ConflictedFilesWidget";
import { conflictsEmpty } from "./conflictsWidgets";
import { OperationWidget } from "./OperationWidget";
import { type HunkPlace, type ResolutionHandle, ResolutionWidget } from "./ResolutionWidget";
import { SuggestionWidget } from "./SuggestionWidget";
import { ThreeWayWidget } from "./ThreeWayWidget";
import { useConflictedFile } from "./useConflictedFile";

interface Props {
  commands: CommandClient;
  repository: OpenedRepository;
  operation: InProgressOperation;
  /** What the AI Suggestion Widget asks for a Suggestion through. */
  ai: AiAccess;
  /** Whether the In-Progress Operation Widget takes focus as it's drawn: when the page has just changed to this one. */
  focusOnShow: boolean;
  /** The conflicted file chosen in Conflicted files, to resolve in the Three-way view and the Resolution, or `null`. */
  chosen: string | null;
  /** Called with the conflicted file chosen. */
  onChoose: (path: string) => void;
  /** Called with the In-Progress Operation as continuing or skipping left it, or `null` once it finished or was aborted. */
  onDone: (operation: InProgressOperation | null) => void;
  /** Called to have the In-Progress Operation read again. */
  onChanged: () => void;
  /** Says what was done, where it's still heard once the page has changed back. */
  onSay: (said: string) => void;
}

/**
 * The Conflicts page (PRD §7.7, §7.10), shown in place of the Repository
 * page while an In-Progress Operation is, laid out as GitKraken's is (ADR
 * 0032): the In-Progress Operation Widget, its Continue, Skip and Abort,
 * along the top, Conflicted files down the left, the Three-way view over
 * the Resolution in the middle, and the AI Suggestion Widget down the
 * right. A Widget with nothing to show is hidden, still mounted, until it
 * has something. The file chosen in Conflicted
 * files is shown in the Three-way view and resolved in the Resolution,
 * whose edits are kept, file by file, while the page is, and the AI
 * Suggestion Widget asks for a Suggestion for the Conflict Hunk the
 * Resolution is at, which only the user's Accept or Edit puts in it.
 */
export function ConflictsPage({
  commands,
  repository,
  operation,
  ai,
  focusOnShow,
  chosen,
  onChoose,
  onDone,
  onChanged,
  onSay,
}: Props) {
  const { conflicts } = operation;
  const shown = chosen !== null && conflicts.includes(chosen) ? chosen : null;
  const read = useConflictedFile(commands, repository.root, shown);
  const [drafts] = useState(() => new Map<string, string>());
  // A file resolved in the Resolution, for Conflicted files to move focus on from once it's read as resolved.
  const [resolved, setResolved] = useState<{ path: string } | null>(null);
  // The Resolution being edited, and where its Conflict Hunk is, for the AI Suggestion Widget.
  const [editor, setEditor] = useState<ResolutionHandle | null>(null);
  const [place, setPlace] = useState<HunkPlace | null>(null);

  // A file no longer conflicted is read afresh if it's conflicted again.
  useEffect(() => {
    for (const path of drafts.keys()) if (!conflicts.includes(path)) drafts.delete(path);
  }, [drafts, conflicts]);

  const empty = new Set(conflictsEmpty(operation, chosen));
  return (
    <div className="conflicts-layout">
      <div className="conflicts-operation">
        <OperationWidget
          commands={commands}
          repository={repository}
          operation={operation}
          focusOnShow={focusOnShow}
          onDone={onDone}
          onChanged={onChanged}
          onSay={onSay}
        />
      </div>
      <div className="conflicts-files" hidden={empty.has("conflictedFiles")}>
        <ConflictedFilesWidget
          commands={commands}
          repository={repository}
          operation={operation}
          chosen={shown}
          resolvedElsewhere={resolved}
          onChoose={onChoose}
          onChanged={onChanged}
        />
      </div>
      <div className="conflicts-centre">
        {empty.has("threeWay") && (
          <p className="surface-note conflicts-choose">
            {operation.conflicts.length > 0
              ? "Choose a conflicted file to resolve it."
              : "No files are conflicted. Continue, or abort, above."}
          </p>
        )}
        <div className="conflicts-three-way" hidden={empty.has("threeWay")}>
          <ThreeWayWidget operation={operation} path={shown} read={read} />
        </div>
        <div className="conflicts-resolution" hidden={empty.has("resolution")}>
          <ResolutionWidget
            commands={commands}
            repository={repository}
            operation={operation}
            path={shown}
            read={shown === null ? null : read}
            drafts={drafts}
            onResolved={(path) => {
              setResolved({ path });
              onChanged();
            }}
            onSay={onSay}
            onEditor={setEditor}
            onHunk={setPlace}
          />
        </div>
      </div>
      <div className="conflicts-suggestion" hidden={empty.has("suggestion")}>
        <SuggestionWidget
          ai={ai}
          repository={repository}
          path={shown}
          read={shown === null ? null : read}
          editor={editor}
          place={place}
        />
      </div>
    </div>
  );
}
