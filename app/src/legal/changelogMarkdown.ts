/**
 * The Markdown semantic-release writes into `CHANGELOG.md` (`.releaserc.json`,
 * ADR 0029), read into blocks the Changelog dialog draws as React elements:
 * never as HTML, since every line is a commit message someone wrote. It
 * knows only what the conventionalcommits preset writes: headings, `*` lists
 * whose lines go on indented, paragraphs, links, `**bold**` and `` `code` ``.
 * Anything else stays as its text.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; items: Inline[][] };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ITEM = /^[*-]\s+(.*)$/;

/** The blocks of a changelog, in order. */
export function parseChangelog(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: string[] | null = null;

  const end = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ")) });
    if (items) blocks.push({ kind: "list", items: items.map(parseInline) });
    paragraph = [];
    items = null;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);
    const item = ITEM.exec(line);
    if (line.trim() === "") {
      end();
    } else if (heading) {
      end();
      blocks.push({ kind: "heading", level: heading[1]!.length, children: parseInline(heading[2]!) });
    } else if (item) {
      if (paragraph.length > 0) end();
      items ??= [];
      items.push(item[1]!);
    } else if (items && /^\s/.test(line)) {
      // A list item's next line, indented under it.
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      if (items) end();
      paragraph.push(line.trim());
    }
  }
  end();
  return blocks;
}

/** The links, bold and code in one block's text. A link that isn't http or https is only its text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const push = (inline: Inline) => {
    if (plain) out.push({ kind: "text", text: plain });
    plain = "";
    out.push(inline);
  };

  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest[0] === "\\" && rest.length > 1 && /[!-/:-@[-`{-~]/.test(rest[1]!)) {
      plain += rest[1];
      i += 2;
      continue;
    }
    if (rest[0] === "`") {
      const close = rest.indexOf("`", 1);
      if (close > 0) {
        push({ kind: "code", text: rest.slice(1, close) });
        i += close + 1;
        continue;
      }
    }
    if (rest.startsWith("**")) {
      const close = rest.indexOf("**", 2);
      if (close > 2) {
        push({ kind: "strong", children: parseInline(rest.slice(2, close)) });
        i += close + 2;
        continue;
      }
    }
    if (rest[0] === "[") {
      const link = linkAt(rest);
      if (link) {
        const children = parseInline(link.label);
        if (/^https?:\/\//i.test(link.href)) push({ kind: "link", href: link.href, children });
        else for (const child of children) push(child);
        i += link.length;
        continue;
      }
    }
    plain += rest[0];
    i += 1;
  }
  if (plain) out.push({ kind: "text", text: plain });
  return out;
}

/** `[label](href)` at the start of `text`, with brackets inside the label allowed. */
function linkAt(text: string): { label: string; href: string; length: number } | null {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === "[") depth += 1;
    else if (text[i] === "]" && --depth === 0) {
      if (text[i + 1] !== "(") return null;
      const close = text.indexOf(")", i + 2);
      if (close < 0) return null;
      const href = text.slice(i + 2, close).trim();
      if (href === "" || /\s/.test(href)) return null;
      return { label: text.slice(1, i), href, length: close + 1 };
    }
  }
  return null;
}
