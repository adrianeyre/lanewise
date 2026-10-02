import type { CommandClient, Cursor, FileStatusEntry, Outcome, Path } from "../commands/api";
import { MAX_STATE } from "./jev";

/** The most staged files read for a check: enough to tell what a commit is. */
const MAX_FILES = 40;

/**
 * The staged changes as one unified diff, file by file, as Jev's commit
 * check reads them: at most {@link MAX_FILES} files, and no more than Jev
 * takes. A file whose diff can't be read, or isn't text, is named alone.
 */
export async function stagedDiff(commands: CommandClient, repository: Path): Promise<string> {
  const staged: { path: string; from: string | null }[] = [];
  let cursor: Cursor | null = null;
  do {
    const page: Outcome<"fileStatus"> = await commands.call("fileStatus", { repository, page: { cursor } });
    if (!page.ok) break;
    for (const entry of page.value.items as FileStatusEntry[]) {
      if (entry.staged) staged.push({ path: entry.path, from: entry.change.kind === "renamed" ? entry.change.from : null });
    }
    cursor = page.value.nextCursor;
  } while (cursor !== null && staged.length < MAX_FILES);
  const parts: string[] = [];
  let length = 0;
  for (const { path, from } of staged.slice(0, MAX_FILES)) {
    const read = await commands.call("workingTreeFileDiff", { repository, path, from, staged: true, limit: 2000 });
    const content = read.ok ? read.value.content : null;
    const text =
      content?.kind === "text"
        ? content.hunks.flatMap((hunk) => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines]).join("\n")
        : "(not shown)";
    const part = `--- ${path}\n${text}`;
    parts.push(part);
    length += part.length;
    if (length > MAX_STATE) break;
  }
  return parts.join("\n");
}
