import { ExternalLink, type LinkOpener } from "./ExternalLink";
import { ISSUES_URL, REPOSITORY_URL } from "./links";

/**
 * The Terms and Conditions' text, shown in its dialog: Lanewise's MIT
 * licence, in plain words, and what using it with others' services means.
 */
export function TermsAndConditions({ onOpenLink }: LinkOpener) {
  return (
    <>
      <p className="policy-updated">Last updated: October 2026</p>

      <h3>About these terms</h3>
      <p>
        These terms cover your use of Lanewise, the Desktop App, Web Mode and its website. By using Lanewise you
        accept them. If you don&apos;t, please don&apos;t use it.
      </p>

      <h3>The licence</h3>
      <p>
        Lanewise is free and open-source software under the{" "}
        <ExternalLink href={`${REPOSITORY_URL}/blob/main/LICENSE`} onOpenLink={onOpenLink}>
          MIT License
        </ExternalLink>
        . You may use, copy, change and share it, for any purpose and at no cost, as long as the licence&apos;s
        copyright notice goes with it. Where these terms and the licence differ, the licence wins.
      </p>

      <h3>No warranty</h3>
      <p>
        Lanewise is provided <strong>&ldquo;as is&rdquo;</strong>, without warranty of any kind. It may have bugs.
        Keep backups of what matters, and push your work to a remote.
      </p>

      <h3>Your repositories and actions</h3>
      <p>
        Lanewise does what you ask of your repositories, through your own Git: commits, merges, resets, deleting a
        branch or a branch on its remote. Some of these can&apos;t be undone, and Lanewise asks before those it knows
        lose work. What you do with your repositories, and on your Hosts, is your responsibility.
      </p>

      <h3>AI Suggestions</h3>
      <p>
        A Suggestion is made by the Model Provider you chose, and can be wrong. Lanewise never applies one for you:
        read it, and check the result, before you accept it, commit it or push it.
      </p>

      <h3>Other services</h3>
      <p>
        Lanewise can work with services that aren&apos;t its own: your Hosts, Model Providers, Jev and Issue
        Trackers. Using them is between you and them, under their terms, and any cost of a Model Provider&apos;s
        or TypeSafe&apos;s API, billed to your own key, is yours. Keep your keys and tokens to yourself.
      </p>

      <h3>Limitation of liability</h3>
      <p>
        As far as the law allows, the authors and copyright holders of Lanewise aren&apos;t liable for any claim,
        damage or other liability arising from Lanewise or its use, as the licence says.
      </p>

      <h3>Changes to these terms</h3>
      <p>
        We may update these terms as Lanewise changes. Any change will appear here with a revised &ldquo;last
        updated&rdquo; date, and in the project&apos;s history on GitHub.
      </p>

      <h3>Contact us</h3>
      <p>
        If you have a question about these terms, please{" "}
        <ExternalLink href={ISSUES_URL} onOpenLink={onOpenLink}>
          open an issue on GitHub
        </ExternalLink>
        .
      </p>
    </>
  );
}
