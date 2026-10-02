import { expect, test } from "vitest";

import { parsePss } from "./memory.ts";

test("a process's proportional set size is read from its smaps_rollup, in bytes", () => {
  const rollup = `55d0c0a00000-7ffd1b1f5000 ---p 00000000 00:00 0                          [rollup]
Rss:              245760 kB
Pss:              198432 kB
Pss_Dirty:        150000 kB
Shared_Clean:      40000 kB
`;
  expect(parsePss(rollup)).toBe(198_432 * 1024);
});

test("a rollup without a proportional set size gives none", () => {
  expect(parsePss("Rss: 10 kB\n")).toBeNull();
});
