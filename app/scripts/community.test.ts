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
import { parse } from "yaml";

const root = join(import.meta.dirname, "..", "..");

/** A file in the repository, with CRLF made LF, as Git on Windows may check it out. */
function read(path: string): string {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

/** The pages the README links to for the detail it leaves out. */
const GUIDES = ["docs/installing.md", "docs/ai-suggestions.md", "docs/development.md", "docs/releases.md"];
/** The rules every Pen-test round's tester agrees to, which the security policy points testers at. */
const RULES_OF_ENGAGEMENT = "docs/product-requirements-document/pen-testing-rules-of-engagement.md";
/** How the owner triages a Finding, with the pen-testing PRD's targets where the triage sees them. */
const FINDING_TRIAGE = "docs/processes/triaging-a-finding.md";
const DOCUMENTS = [
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  RULES_OF_ENGAGEMENT,
  FINDING_TRIAGE,
  ...GUIDES,
];
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
    ["accessibility.yml", "bug-report.yml", "config.yml", "feature-request.yml", "finding.yml"].map((file) => `${FORMS_DIR}/${file}`),
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
  expect(readme).toContain("(https://lanewise.adrianeyre.co.uk/)");
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

/** An issue form's fields, as GitHub reads them from its YAML. */
interface Field {
  type: string;
  id?: string;
  attributes: { label?: string; value?: string; description?: string; options?: (string | { label: string; required?: boolean })[] };
  validations?: { required?: boolean };
}
interface Form {
  name: string;
  description: string;
  title?: string;
  labels: string[];
  body: Field[];
}

/** An issue form, parsed as GitHub parses it, which fails if it isn't valid YAML. */
function form(file: string): Form {
  return parse(read(`${FORMS_DIR}/${file}`)) as Form;
}

test("each issue form is valid YAML of GitHub's shape, labelled, and the accessibility form `accessibility`", () => {
  for (const path of FORMS.filter((each) => !each.endsWith("config.yml"))) {
    const { name, description, labels, body } = form(basename(path));
    expect({ path, name, description, labels }).toEqual({
      path,
      name: expect.any(String),
      description: expect.any(String),
      labels: [expect.stringMatching(/^[\w:-]+$/)],
    });
    for (const { type, attributes } of body) {
      expect({ path, type }).toEqual({ path, type: expect.stringMatching(/^(markdown|input|textarea|dropdown|checkboxes)$/) });
      expect({ path, text: type === "markdown" ? attributes.value : attributes.label }).toEqual({ path, text: expect.any(String) });
    }
    const ids = body.flatMap(({ id }) => (id === undefined ? [] : [id]));
    expect(ids).toEqual([...new Set(ids)]);
  }
  expect(form("accessibility.yml").labels).toEqual(["accessibility"]);
  expect(form("feature-request.yml").labels).toEqual(["enhancement"]);
  expect(form("config.yml")).toMatchObject({
    contact_links: expect.arrayContaining([
      expect.objectContaining({ url: "https://github.com/adrianeyre/lanewise/security/advisories/new" }),
    ]),
  });
});

// Pen-testing PRD §7: a Finding is filed with its scope issue, the promise it breaks, the
// Release it was shown on, its steps and the test that would have caught it, and a
// critical or high one goes privately instead.
test("the Finding form sends a critical or high Finding to private vulnerability reporting before anything else", () => {
  const finding = form("finding.yml");
  const advisories = "https://github.com/adrianeyre/lanewise/security/advisories/new";
  expect(finding.description).toMatch(/^A critical or high Finding goes through private vulnerability reporting instead\./);
  expect(finding.title).toBe("[finding] <ID> — <what it does>");
  expect(finding.labels).toEqual(["prd:pen-test"]);

  const [first, ...fields] = finding.body;
  expect(first?.type).toBe("markdown");
  expect(first?.attributes.value).toMatch(/^\*\*Stop here if the Finding is critical or high\.\*\*/);
  expect(first?.attributes.value).toContain(`[private vulnerability reporting](${advisories})`);

  const field = (id: string) => fields.find((each) => each.id === id);
  const required = ["scope-issue", "severity", "promise", "release", "steps", "test"];
  expect(required.filter((id) => field(id)?.validations?.required !== true)).toEqual([]);
  const disclosure = field("disclosure");
  expect(disclosure?.type).toBe("checkboxes");
  expect(fields.indexOf(disclosure as Field)).toBeLessThan(fields.indexOf(field("scope-issue") as Field));
  const boxes = disclosure?.attributes.options ?? [];
  expect(boxes).toHaveLength(3);
  expect(boxes.every((box) => typeof box === "object" && box.required === true)).toBe(true);
});

test("the Finding form and its triage guide carry the pen-testing PRD's targets for each severity", () => {
  const prd = read("docs/product-requirements-document/pen-testing.md");
  const rows = [...prd.matchAll(/^\| (critical|high|medium|low) \| ([^|]+) \| .+ \|$/gm)];
  expect(rows.map(([, severity]) => severity)).toEqual(["critical", "high", "medium", "low"]);

  const finding = form("finding.yml");
  const table = finding.body.map(({ attributes }) => attributes.value ?? "").join("\n");
  const options = finding.body.find(({ id }) => id === "severity")?.attributes.options;
  const triage = read(FINDING_TRIAGE);
  expect(options).toEqual(rows.map(([, severity, target = ""]) => `${severity}: target ${target.replace(/^(\d+)/, "$1 days")}`));
  for (const [row, severity] of rows) {
    expect(table).toContain(`\n${row}\n`);
    expect(triage).toContain(`\n${row}\n`);
    expect(triage).toContain(`\`severity:${severity}\``);
  }
  expect(triage).toContain("(`.github/ISSUE_TEMPLATE/finding.yml`)");
});

// Pen-testing PRD §3: the rules are written and linked before a window opens.
test("the pen-testing PRD and the security policy link to the rules of engagement, which date each window", () => {
  expect(read("docs/product-requirements-document/pen-testing.md")).toContain("](./pen-testing-rules-of-engagement.md)");
  expect(read("SECURITY.md")).toContain(`](${RULES_OF_ENGAGEMENT})`);
  const rules = read(RULES_OF_ENGAGEMENT);
  expect(rules).toMatch(/^\| 1 \| \w+day \d{1,2} \w+ \d{4} \| \w+day \d{1,2} \w+ \d{4} \|$/m);
  expect(rules).toContain("https://github.com/adrianeyre/lanewise/security/advisories/new");
});

test("the code of conduct is the Contributor Covenant, with a way to report filled in", () => {
  const conduct = read("CODE_OF_CONDUCT.md");
  expect(conduct).toMatch(/^# Contributor Covenant 3\.0 Code of Conduct\n/);
  expect(conduct).not.toContain("[NOTE:");
  expect(conduct).toMatch(/To report a possible violation, email .+mailto:/);
});
