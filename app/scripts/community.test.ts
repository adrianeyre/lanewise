/**
 * The files a new user or contributor reads first (PRD §12): the README,
 * CONTRIBUTING, the code of conduct, the security policy and the issue
 * forms. They name commands, paths and headings that can drift from the
 * tree, so these tests hold each one to what's really there.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..", "..");

/** A file in the repository, with CRLF made LF, as Git on Windows may check it out. */
function read(path: string): string {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

/** The pages the README links to for the detail it leaves out. */
const GUIDES = ["docs/installing.md", "docs/ai-suggestions.md", "docs/development.md", "docs/releases.md"];
const DOCUMENTS = ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", ...GUIDES];
/** The documents that give commands and link to headings. */
const GUIDING = ["README.md", "CONTRIBUTING.md", ...GUIDES];
const FORMS_DIR = ".github/ISSUE_TEMPLATE";
const FORMS = readdirSync(join(root, FORMS_DIR)).map((file) => `${FORMS_DIR}/${file}`);

/** The root `package.json`'s scripts, which `pnpm <name>` runs. */
const SCRIPTS = Object.keys(
  (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts,
);
/** pnpm's own commands and options the documents use, which aren't scripts. */
const PNPM_COMMANDS = ["install", "exec", "--filter", "--version"];

/** The top-level folders a path in the documents can start with. */
const TRACKED = ["app", "bench", "catalog", "commands", "core", "desktop", "docs", "eval", "graph", "serve", "spikes", "website", ".github", ".sandcastle"];
/** Paths the documents name that are written by a build or a run, never committed. */
const WRITTEN = ["app/dist", "website/dist", "bench/results", "eval/results", "eval/.repositories", "CHANGELOG.md"];

/** The names of the files Git has, for a file the documents name alone, such as `ci.yml`. */
const TRACKED_NAMES = new Set(
  spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout.split("\n").map((path) => basename(path)),
);

/** What's in a document's code: its fenced blocks and inline code. */
function code(markdown: string): string[] {
  return [...markdown.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map(([each]) => each);
}

/** GitHub's anchor for a Markdown heading. */
function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

function anchors(markdown: string): Set<string> {
  const outsideCode = markdown.replace(/```[\s\S]*?```/g, "");
  return new Set([...outsideCode.matchAll(/^#{1,6} (.+)$/gm)].map((match) => anchor(match[1] ?? "")));
}

test("every document and issue form is there", () => {
  expect(DOCUMENTS.filter((path) => !existsSync(join(root, path)))).toEqual([]);
  // The README links to each of its guides.
  expect(GUIDES.filter((guide) => !read("README.md").includes(`](${guide}`))).toEqual([]);
  expect(FORMS.toSorted()).toEqual(
    ["accessibility.yml", "bug-report.yml", "config.yml", "feature-request.yml"].map((file) => `${FORMS_DIR}/${file}`),
  );
});

test("the repository is only ever adrianeyre/lanewise", () => {
  const others = [...DOCUMENTS, ...FORMS].flatMap((path) =>
    [...read(path).matchAll(/github\.com\/[\w.-]+\/lanewise\b|[\w-]+\.github\.io\/lanewise\b/gi)]
      .map(([slug]) => slug)
      .filter((slug) => slug !== "github.com/adrianeyre/lanewise" && slug !== "adrianeyre.github.io/lanewise")
      .map((slug) => `${path}: ${slug}`),
  );
  expect(others).toEqual([]);
});

test("every pnpm command the documents give is a script or one of pnpm's own", () => {
  const unknown = GUIDING.flatMap((path) =>
    [...code(read(path)).join("\n").matchAll(/\bpnpm ([\w:-]+)/g)]
      .map(([, name = ""]) => name)
      // `pnpm try:<model provider>` stands for each of the `try:` scripts.
      .filter((name) =>
        name.endsWith(":")
          ? !SCRIPTS.some((script) => script.startsWith(name))
          : !SCRIPTS.includes(name) && !PNPM_COMMANDS.includes(name),
      )
      .map((name) => `${path}: pnpm ${name}`),
  );
  expect(unknown).toEqual([]);
});

test("every file and folder the documents name is in the repository", () => {
  const missing = [...DOCUMENTS, ...FORMS].flatMap((path) => {
    const text = read(path);
    // A link is from the document's own folder; a quoted path, from the root.
    const linked = [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
      .map((match) => match[1] ?? "")
      .filter((each) => !/^[a-z]+:/.test(each))
      .map((each) => normalize(join(dirname(path), each)).replaceAll("\\", "/"));
    const quoted = [...text.matchAll(/`([^`\s<>…*]+)`/g)].map((match) => match[1] ?? "");
    const paths = [...linked, ...quoted].filter(
      (each) =>
        !/^[a-z]+:/.test(each) &&
        TRACKED.some((top) => each === top || each.startsWith(`${top}/`)) &&
        !WRITTEN.some((written) => each.startsWith(written)),
    );
    const alone = quoted.filter(
      (each) => /^[\w.-]+\.(md|json|yaml|yml|ts|toml|lock)$/.test(each) && !WRITTEN.includes(each),
    );
    return [
      ...paths.filter((each) => !existsSync(join(root, each))),
      ...alone.filter((each) => !TRACKED_NAMES.has(each)),
    ].map((each) => `${path}: ${each}`);
  });
  expect(missing).toEqual([]);
});

test("every link to a heading goes to one that's there", () => {
  const broken = GUIDING.flatMap((path) =>
    [...read(path).matchAll(/\]\(([\w./-]*)#([\w-]+)\)/g)]
      .map(([, target = "", fragment = ""]) => ({
        file: target === "" ? path : normalize(join(dirname(path), target)).replaceAll("\\", "/"),
        fragment,
      }))
      .filter(({ file, fragment }) => !anchors(read(file)).has(fragment))
      .map(({ file, fragment }) => `${path}: ${file}#${fragment}`),
  );
  expect(broken).toEqual([]);
});

test("the README and its guides cover installing and building Lanewise, and what it needs (PRD §12)", () => {
  const readme = read("README.md");
  expect(readme).toContain("(https://adrianeyre.github.io/lanewise/)");
  expect(readme).toContain("(docs/product-requirements-document/git-client.md)");
  expect(readme).toMatch(/!\[[^\]]+\]\(website\/public\/screenshots\/\w+\.webp\)/);
  expect(read("docs/installing.md")).toContain("2.40 or later");
  expect(read("docs/installing.md")).toContain("Git Credential Manager");
  const setup = read("docs/development.md");
  for (const needed of ["Node 26", "corepack", "clippy", "rustfmt", "2.40 or later", "Git Credential Manager"]) {
    expect(setup).toContain(needed);
  }
  for (const dependency of ["libwebkit2gtk-4.1-dev", "xcode-select --install", "Desktop development with C++", "WebView2"]) {
    expect(setup).toContain(dependency);
  }
  const packageManager = (JSON.parse(read("package.json")) as { packageManager: string }).packageManager;
  expect(packageManager).toMatch(/^pnpm@/);
  expect(setup).toContain("`packageManager`");
});

test("each issue form is labelled, and the accessibility form `accessibility`", () => {
  for (const path of FORMS.filter((each) => !each.endsWith("config.yml"))) {
    const form = read(path);
    expect(form).toMatch(/^name: .+\ndescription: .+\nlabels: \["[\w-]+"\]\nbody:\n/);
    const ids = [...form.matchAll(/^\s+id: ([\w-]+)$/gm)].map((match) => match[1]);
    expect(ids).toEqual([...new Set(ids)]);
  }
  expect(read(`${FORMS_DIR}/accessibility.yml`)).toContain('labels: ["accessibility"]');
  expect(read(`${FORMS_DIR}/feature-request.yml`)).toContain('labels: ["enhancement"]');
  expect(read(`${FORMS_DIR}/config.yml`)).toContain("url: https://github.com/adrianeyre/lanewise/security/advisories/new");
});

test("the code of conduct is the Contributor Covenant, with a way to report filled in", () => {
  const conduct = read("CODE_OF_CONDUCT.md");
  expect(conduct).toMatch(/^# Contributor Covenant 3\.0 Code of Conduct\n/);
  expect(conduct).not.toContain("[NOTE:");
  expect(conduct).toMatch(/To report a possible violation, email .+mailto:/);
});
