import type { DiffSide, FileDiff, FileMode } from "../commands/api";

const modes: Record<FileMode, string> = {
  file: "a file",
  executable: "an executable file",
  symlink: "a symbolic link",
  submodule: "a submodule",
};

/**
 * What a diff says in words that its lines can't: that the file was added,
 * deleted, renamed or copied, that its mode changed, or what it is instead of
 * lines, for a binary file or a submodule. One sentence each, in that order.
 */
export function describeDiff(diff: FileDiff, copied: boolean): string[] {
  const { old, new: next, content } = diff;
  const said: string[] = [];
  if (old === null && next !== null) said.push(`Added as ${modes[next.mode]}.`);
  if (old !== null && next === null) said.push(`Deleted: it was ${modes[old.mode]}.`);
  if (old !== null && next !== null) {
    if (old.path !== next.path) said.push(`${copied ? "Copied" : "Renamed"} from ${old.path}.`);
    if (old.mode !== next.mode) said.push(modeChange(old, next));
  }

  if (content.kind === "binary") {
    said.push(`A binary file, so its changes aren't shown as lines. ${sizes(content.oldSize, content.newSize)}`);
  } else if (content.kind === "submodule") {
    said.push(submodule(content.old, content.new));
  } else if (content.kind === "text" && content.hunks.length === 0) {
    said.push(old === null || next === null ? "It is empty." : "Its content didn't change.");
  }
  return said;
}

function modeChange(old: DiffSide, next: DiffSide): string {
  if (old.mode === "file" && next.mode === "executable") return "Made executable.";
  if (old.mode === "executable" && next.mode === "file") return "No longer executable.";
  return `Changed from ${modes[old.mode]} to ${modes[next.mode]}.`;
}

function sizes(old: number | null, next: number | null): string {
  if (old === null && next !== null) return `It is ${size(next)}.`;
  if (old !== null && next === null) return `It was ${size(old)}.`;
  if (old !== null && next !== null) {
    return old === next ? `It is still ${size(next)}.` : `It was ${size(old)} and is now ${size(next)}.`;
  }
  return "";
}

/** A size in bytes, in words: `1 byte`, `980 bytes`, `1.2 KB`, `3.4 MB`. */
export function size(bytes: number): string {
  if (bytes === 1) return "1 byte";
  if (bytes < 1000) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 999.95 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(1).replace(/\.0$/, "")} ${units[unit]}`;
}

function short(id: string): string {
  return id.slice(0, 7);
}

function submodule(old: string | null, next: string | null): string {
  if (old !== null && next !== null) {
    return `A submodule, moved from commit ${short(old)} to commit ${short(next)}.`;
  }
  if (next !== null) return `A submodule, at commit ${short(next)}.`;
  if (old !== null) return `A submodule, which was at commit ${short(old)}.`;
  return "A submodule.";
}
