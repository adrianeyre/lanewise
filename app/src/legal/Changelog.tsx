import { Fragment, lazy, type ReactNode, Suspense } from "react";

import { type Block, type Inline, parseChangelog } from "./changelogMarkdown";
import { ExternalLink, type LinkOpener } from "./ExternalLink";

// The whole changelog only loads when the dialog is opened, as the credits do.
const BundledChangelog = lazy(() => import("./BundledChangelog"));

/** What has changed in each Release, from `CHANGELOG.md`, shown in its dialog when the footer's version is chosen. */
export function Changelog({ onOpenLink }: LinkOpener) {
  return (
    <>
      <p className="policy-updated">You are running version {import.meta.env.VITE_APP_VERSION}.</p>
      <Suspense
        fallback={
          <p role="status" className="policy-updated">
            Loading the changelog…
          </p>
        }
      >
        <BundledChangelog onOpenLink={onOpenLink} />
      </Suspense>
    </>
  );
}

interface Props extends LinkOpener {
  markdown: string;
}

/**
 * A changelog drawn from its Markdown. Its `#` title is the dialog's own, so
 * it is left out, and each Release's `##` heading sits under the dialog's
 * title as a third-level one.
 */
export function ChangelogText({ markdown, onOpenLink }: Props) {
  const blocks = parseChangelog(markdown);
  if (blocks[0]?.kind === "heading" && blocks[0].level === 1) blocks.shift();
  const released = blocks.some((block) => block.kind === "heading" && block.level === 2);

  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} onOpenLink={onOpenLink} />
      ))}
      {!released && <p>Nothing has been released yet.</p>}
    </>
  );
}

function BlockView({ block, onOpenLink }: { block: Block } & LinkOpener) {
  switch (block.kind) {
    case "heading": {
      const Heading = `h${Math.max(3, Math.min(6, block.level + 1))}` as "h3" | "h4" | "h5" | "h6";
      return <Heading>{inlines(block.children, onOpenLink)}</Heading>;
    }
    case "paragraph":
      return <p>{inlines(block.children, onOpenLink)}</p>;
    case "list":
      return (
        <ul>
          {block.items.map((item, index) => (
            <li key={index}>{inlines(item, onOpenLink)}</li>
          ))}
        </ul>
      );
  }
}

function inlines(children: Inline[], onOpenLink: LinkOpener["onOpenLink"]): ReactNode {
  return children.map((inline, index) => {
    switch (inline.kind) {
      case "text":
        return <Fragment key={index}>{inline.text}</Fragment>;
      case "code":
        return <code key={index}>{inline.text}</code>;
      case "strong":
        return <strong key={index}>{inlines(inline.children, onOpenLink)}</strong>;
      case "link":
        return (
          <ExternalLink key={index} href={inline.href} onOpenLink={onOpenLink}>
            {inlines(inline.children, onOpenLink)}
          </ExternalLink>
        );
    }
  });
}
