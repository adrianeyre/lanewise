import { expect, test } from "vitest";

import type { ConflictedFile, ConflictReport } from "../commands/api";
import { describeWholeFile, resolvedWhole, wholeFileOptions } from "./wholeFile";

const text = (words: string) => ({ kind: "text" as const, text: words });
const notText = { kind: "notText" as const };
const rename: ConflictReport = { kind: "rename/delete", message: "CONFLICT (rename/delete): …", paths: ["moved.txt"] };

const file = (versions: Partial<ConflictedFile>): ConflictedFile => ({
  base: text("a\n"),
  ours: text("b\n"),
  theirs: text("c\n"),
  working: text("<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> feature\n"),
  reports: [],
  oursSubject: null,
  theirsSubject: null,
  ...versions,
});

test("only a file that's text on both sides and in the working tree is resolved Conflict Hunk by Conflict Hunk", () => {
  expect(resolvedWhole(file({}))).toBe(false);
  // Nor does a Base that isn't there, or isn't text, stop it.
  expect(resolvedWhole(file({ base: null }))).toBe(false);
  expect(resolvedWhole(file({ base: notText }))).toBe(false);

  expect(resolvedWhole(file({ ours: notText }))).toBe(true);
  expect(resolvedWhole(file({ theirs: null }))).toBe(true);
  expect(resolvedWhole(file({ working: null }))).toBe(true);
  expect(resolvedWhole(file({ working: notText }))).toBe(true);
});

test("what happened to a file resolved as a whole is said in words", () => {
  expect(describeWholeFile(file({ ours: null }))).toBe("Ours deleted this file, and Theirs changed it.");
  expect(describeWholeFile(file({ theirs: null, reports: [rename] }))).toBe(
    "Theirs deleted this file, and Ours renamed it here.",
  );
  expect(describeWholeFile(file({ base: null, theirs: null }))).toBe("Only Ours has this file. Theirs doesn't.");
  expect(describeWholeFile(file({ base: null, ours: null, reports: [rename] }))).toBe(
    "Only Theirs has this file, having renamed a file to it. Ours doesn't.",
  );
  expect(describeWholeFile(file({ ours: null, theirs: null, working: null }))).toBe(
    "Neither Ours nor Theirs has this file any more: each deleted it or renamed it.",
  );
  expect(describeWholeFile(file({ ours: notText, theirs: notText }))).toBe(
    "Ours and Theirs each changed this file, and neither is text Lanewise can show: it's binary, not UTF-8, a symbolic link or a submodule.",
  );
  expect(describeWholeFile(file({ theirs: notText }))).toMatch(/^Ours and Theirs each changed this file, and Theirs isn't text/);
  expect(describeWholeFile(file({ working: null }))).toMatch(/it's gone from the working tree/);
  expect(describeWholeFile(file({ working: notText }))).toMatch(/in the working tree it isn't text/);
});

test("each side with a version of the file can be kept, and one a side deleted or renamed away can be deleted", () => {
  const named = (versions: Partial<ConflictedFile>) =>
    wholeFileOptions(file(versions)).map(({ choice, name }) => ({ choice, name }));

  expect(named({ ours: notText, theirs: notText })).toEqual([
    { choice: "ours", name: "Keep Ours" },
    { choice: "theirs", name: "Keep Theirs" },
  ]);
  expect(named({ ours: null })).toEqual([
    { choice: "theirs", name: "Keep the file, as Theirs has it" },
    { choice: "delete", name: "Delete the file" },
  ]);
  expect(named({ theirs: null })).toEqual([
    { choice: "ours", name: "Keep the file, as Ours has it" },
    { choice: "delete", name: "Delete the file" },
  ]);
  expect(named({ ours: null, theirs: null })).toEqual([{ choice: "delete", name: "Delete the file" }]);

  const [keep, remove] = wholeFileOptions(file({ ours: null }));
  expect(keep!.said("lanes.txt")).toBe("Kept “lanes.txt” as Theirs has it, and marked it resolved.");
  expect(remove!.said("lanes.txt")).toBe("Deleted “lanes.txt”, and marked it resolved.");
});
