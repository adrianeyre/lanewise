import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { parseChangelog, parseInline } from "./changelogMarkdown";

const root = join(import.meta.dirname, "../../..");

test("CHANGELOG.md starts with .releaserc.json's title, so semantic-release puts each Release under it rather than writing it again", () => {
  const plugins = (JSON.parse(readFileSync(join(root, ".releaserc.json"), "utf8")) as { plugins: unknown[] })
    .plugins;
  const changelog = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/changelog") as [
    string,
    { changelogFile: string; changelogTitle: string },
  ];
  const { changelogFile, changelogTitle } = changelog[1];

  expect(changelogFile).toBe("CHANGELOG.md");
  expect(readFileSync(join(root, changelogFile), "utf8").trim().startsWith(changelogTitle)).toBe(true);
});

test("a Release as the conventionalcommits preset writes it: its heading, its sections and their items", () => {
  const blocks = parseChangelog(
    [
      "## [1.1.0](https://github.com/adrianeyre/lanewise/compare/v1.0.0...v1.1.0) (2026-10-01)",
      "",
      "### Features",
      "",
      "* **footer:** the version opens the Changelog ([abc1234](https://github.com/adrianeyre/lanewise/commit/abc1234)), closes [#63](https://github.com/adrianeyre/lanewise/issues/63)",
      "* a second one",
      "",
    ].join("\n"),
  );

  expect(blocks).toEqual([
    {
      kind: "heading",
      level: 2,
      children: [
        {
          kind: "link",
          href: "https://github.com/adrianeyre/lanewise/compare/v1.0.0...v1.1.0",
          children: [{ kind: "text", text: "1.1.0" }],
        },
        { kind: "text", text: " (2026-10-01)" },
      ],
    },
    { kind: "heading", level: 3, children: [{ kind: "text", text: "Features" }] },
    {
      kind: "list",
      items: [
        [
          { kind: "strong", children: [{ kind: "text", text: "footer:" }] },
          { kind: "text", text: " the version opens the Changelog (" },
          {
            kind: "link",
            href: "https://github.com/adrianeyre/lanewise/commit/abc1234",
            children: [{ kind: "text", text: "abc1234" }],
          },
          { kind: "text", text: "), closes " },
          {
            kind: "link",
            href: "https://github.com/adrianeyre/lanewise/issues/63",
            children: [{ kind: "text", text: "#63" }],
          },
        ],
        [{ kind: "text", text: "a second one" }],
      ],
    },
  ]);
});

test("a breaking change's note goes on indented lines under its item, and a paragraph's lines join", () => {
  expect(parseChangelog("### ⚠ BREAKING CHANGES\n\n* the first line\n  and the next\n\nOne\nparagraph")).toEqual([
    { kind: "heading", level: 3, children: [{ kind: "text", text: "⚠ BREAKING CHANGES" }] },
    { kind: "list", items: [[{ kind: "text", text: "the first line and the next" }]] },
    { kind: "paragraph", children: [{ kind: "text", text: "One paragraph" }] },
  ]);
});

test("only an http or https link is a link: any other is just its text", () => {
  expect(parseInline("[run](javascript:alert(1)) [mail](mailto:a@b.c) [ok](http://example.com)")).toEqual([
    { kind: "text", text: "run" },
    { kind: "text", text: ") " },
    { kind: "text", text: "mail" },
    { kind: "text", text: " " },
    { kind: "link", href: "http://example.com", children: [{ kind: "text", text: "ok" }] },
  ]);
});

test("code, escapes and unfinished Markdown stay as their text", () => {
  expect(parseInline("`<b>` \\*not bold\\* **open [half](")).toEqual([
    { kind: "code", text: "<b>" },
    { kind: "text", text: " *not bold* **open [half](" },
  ]);
});

test("a link's label can hold brackets and bold", () => {
  expect(parseInline("[**[x]**](https://example.com)")).toEqual([
    {
      kind: "link",
      href: "https://example.com",
      children: [{ kind: "strong", children: [{ kind: "text", text: "[x]" }] }],
    },
  ]);
});
