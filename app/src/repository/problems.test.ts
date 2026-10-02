import { expect, test } from "vitest";

import { CommandRejectedError } from "../commands/reply";
import { describeFailure, describeRepositoryError } from "./problems";

test("each way a folder fails to open says what went wrong", () => {
  expect(describeRepositoryError({ kind: "notARepository", path: "/tmp" })).toBe(
    "“/tmp” isn't in a Git repository. Choose a repository's folder, or a folder inside one.",
  );
  expect(describeRepositoryError({ kind: "notAFolder", path: "/gone" })).toBe(
    "“/gone” isn't a folder, or is no longer there.",
  );
  expect(describeRepositoryError({ kind: "noWorkingTree", path: "/srv/lanewise.git" })).toBe(
    "“/srv/lanewise.git” is a bare repository, with no working tree to show. Choose a repository that has one.",
  );
  expect(
    describeRepositoryError({ kind: "unreadable", path: "/work/x", message: "bad index" }),
  ).toBe("Lanewise couldn't read the repository at “/work/x”: bad index");
});

test("a failure to run a command says something went wrong, and what", () => {
  const rejected = new CommandRejectedError({ kind: "internal", message: "It stopped." });

  expect(describeFailure(rejected)).toBe("Something went wrong in Lanewise. It stopped.");
  expect(describeFailure("no reply")).toBe("Something went wrong in Lanewise. no reply");
});
