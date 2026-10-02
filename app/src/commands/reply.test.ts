import { expect, test } from "vitest";

import { CommandRejectedError, outcomeOf } from "./reply";

test("an ok reply is the command's response", () => {
  const reply = { outcome: "ok", value: { root: "/work/lanewise", name: "lanewise" } };

  expect(outcomeOf("openRepository", reply)).toEqual({
    ok: true,
    value: { root: "/work/lanewise", name: "lanewise" },
  });
});

test("a failed reply is the command's own error", () => {
  const reply = { outcome: "failed", error: { kind: "notARepository", path: "/tmp" } };

  expect(outcomeOf("openRepository", reply)).toEqual({
    ok: false,
    error: { kind: "notARepository", path: "/tmp" },
  });
});

test("a rejected reply throws, carrying the rejection", () => {
  const rejection = {
    kind: "invalidRequest",
    name: "fileStatus",
    message: "missing field `repository`",
  };

  const thrown = (() => {
    try {
      outcomeOf("fileStatus", { outcome: "rejected", rejection });
    } catch (error) {
      return error;
    }
  })();

  expect(thrown).toBeInstanceOf(CommandRejectedError);
  expect((thrown as CommandRejectedError).rejection).toEqual(rejection);
  expect((thrown as CommandRejectedError).message).toBe(
    "The core couldn't read the fileStatus request: missing field `repository`",
  );
});

test("each rejection explains itself", () => {
  expect(new CommandRejectedError({ kind: "unknownCommand", name: "push" }).message).toBe(
    "The core has no command called push.",
  );
  expect(new CommandRejectedError({ kind: "internal", message: "It stopped." }).message).toBe(
    "It stopped.",
  );
});

test("anything that isn't a reply is a TypeError", () => {
  expect(() => outcomeOf("fileStatus", null)).toThrow(TypeError);
  expect(() => outcomeOf("fileStatus", { outcome: "maybe" })).toThrow(
    'The core\'s reply to fileStatus isn\'t one: {"outcome":"maybe"}',
  );
});
