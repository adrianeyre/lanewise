import { expect, test } from "vitest";

import { forgetRecent, MAX_RECENT, parseRecent, rememberRecent, serialiseRecent } from "./recent";

const lanewise = { root: "/work/lanewise", name: "lanewise" };
const soundcheck = { root: "/work/soundcheck", name: "soundcheck" };

test("the repository opened last comes first, and only once", () => {
  const recent = rememberRecent(rememberRecent([], lanewise), soundcheck);
  expect(recent).toEqual([soundcheck, lanewise]);

  expect(rememberRecent(recent, lanewise)).toEqual([lanewise, soundcheck]);
});

test("only the most recent are kept", () => {
  const many = Array.from({ length: MAX_RECENT }, (_, n) => ({ root: `/work/${n}`, name: `${n}` }));

  const recent = rememberRecent(many, lanewise);

  expect(recent).toHaveLength(MAX_RECENT);
  expect(recent[0]).toEqual(lanewise);
  expect(recent.at(-1)).toEqual(many.at(-2));
});

test("a repository can be forgotten", () => {
  expect(forgetRecent([lanewise, soundcheck], "/work/lanewise")).toEqual([soundcheck]);
});

test("the list reads back as it was kept, and what's broken in it is left out", () => {
  expect(parseRecent(serialiseRecent([soundcheck, lanewise]))).toEqual([soundcheck, lanewise]);
  expect(parseRecent(null)).toEqual([]);
  expect(parseRecent("not json")).toEqual([]);
  expect(parseRecent('{"root":"/work"}')).toEqual([]);
  expect(
    parseRecent(
      JSON.stringify([lanewise, { root: "/work/x" }, null, { root: "", name: "empty" }, lanewise, soundcheck]),
    ),
  ).toEqual([lanewise, soundcheck]);
});
