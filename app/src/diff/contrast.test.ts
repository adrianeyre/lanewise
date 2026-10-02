import { describe, expect, test } from "vitest";

import { colourIn, contrast, THEMES } from "../test/styles";

const light = THEMES.get("light")!;
const dark = THEMES.get("dark")!;
const syntax = [...light.keys()].filter((name) => name.startsWith("--syntax-"));

describe.each([...THEMES])("in the %s theme", (_, theme) => {
  /** Each of `colours` below 4.5:1 on `background`, with its ratio. */
  const failing = (colours: string[], background: string) =>
    colours
      .map((name) => ({
        name,
        ratio: Math.round(contrast(colourIn(theme, name), colourIn(theme, background)) * 100) / 100,
      }))
      .filter(({ ratio }) => ratio < 4.5);

  test("every syntax colour is one the dark theme sets too", () => {
    expect(syntax.length).toBeGreaterThan(0);
    for (const name of syntax) expect(dark.get(name)).not.toBe(light.get(name));
  });

  test.each([
    ["--surface", ["--text", "--muted", ...syntax]],
    ["--diff-added-background", ["--text", "--added", ...syntax]],
    ["--diff-removed-background", ["--text", "--deleted", ...syntax]],
    ["--diff-hunk-background", ["--text", "--muted"]],
    ["--conflict-marker-background", ["--text", "--muted"]],
    ["--conflict-ours-background", ["--text", "--muted"]],
    ["--conflict-base-background", ["--text", "--muted"]],
    ["--conflict-theirs-background", ["--text", "--muted"]],
  ])("text on %s meets 4.5:1", (on, colours) => {
    expect(failing(colours, on)).toEqual([]);
  });

  test("a chosen changed file's text and change colours meet 4.5:1 on its highlight", () => {
    expect(
      failing(["--text", "--muted", "--added", "--modified", "--deleted", "--renamed"], "--focus 6% --surface"),
    ).toEqual([]);
  });
});
