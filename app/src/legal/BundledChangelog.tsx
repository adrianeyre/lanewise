import changelog from "../../../CHANGELOG.md?raw";

import { ChangelogText } from "./Changelog";
import type { LinkOpener } from "./ExternalLink";

/** The repository's `CHANGELOG.md` as this build has it: semantic-release commits it with each Release's version. */
export default function BundledChangelog({ onOpenLink }: LinkOpener) {
  return <ChangelogText markdown={changelog} onOpenLink={onOpenLink} />;
}
