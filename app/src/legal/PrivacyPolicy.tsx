import { ExternalLink, type LinkOpener } from "./ExternalLink";
import { ISSUES_URL } from "./links";

// TODO(#60): Host pages in Tabs, once merged: what a Host's page you open in a Tab keeps, such as its sign-in.
/**
 * The Privacy Policy's text, shown in its dialog: what Lanewise keeps, where,
 * and what it sends to whom, which is only ever what the user asked for.
 */
export function PrivacyPolicy({ onOpenLink }: LinkOpener) {
  return (
    <>
      <p className="policy-updated">Last updated: October 2026</p>

      <h3>About this policy</h3>
      <p>
        Lanewise is free, open-source software that runs on your own computer. This policy explains what it keeps,
        where, and what it sends to whom. The short version: Lanewise collects nothing about you, has no account
        and no server of its own, and sends your data only where you ask it to.
      </p>

      <h3>What Lanewise collects</h3>
      <p>
        <strong>Nothing.</strong> There is no telemetry, analytics, crash reporting or advertising of any kind.
        Nothing is sent about you, your repositories or how you use Lanewise, and the project never receives any of
        it.
      </p>

      <h3>What stays on your computer</h3>
      <ul>
        <li>
          <strong>Your repositories</strong> stay where they are, on your own disk. Lanewise works on them through
          your own Git, and never uploads them or keeps a copy.
        </li>
        <li>
          <strong>Your settings</strong>, such as the Theme and your Recent Repositories, are kept in local storage,
          as the Cookie Policy lists.
        </li>
        <li>
          <strong>Your API keys and tokens</strong>, for a Model Provider, Jev or an Issue Tracker, are kept in your
          operating system&apos;s credential store, never in a file of Lanewise&apos;s. Your Host credentials are
          your credential helper&apos;s, such as Git Credential Manager: Lanewise never sees your password.
        </li>
        <li>
          <strong>Lanewise&apos;s logs</strong> stay in your operating system&apos;s folder for logs. They never hold
          credentials, API keys, your files&apos; contents or prompts. Copy diagnostics copies their latest lines for
          a bug report, which you read, and send, yourself.
        </li>
      </ul>

      <h3>What is sent, and only when you ask</h3>
      <ul>
        <li>
          <strong>Your remotes and Hosts</strong>, such as GitHub, GitLab, Bitbucket and Azure DevOps, when you
          clone, fetch, pull or push, sign in, browse your repositories, or read Pull Requests, as Git and their own
          APIs need.
        </li>
        <li>
          <strong>The Model Provider you chose</strong>, with your own API key, once you turn AI on and accept its
          first-use disclosure: the Conflict Hunk you ask a Suggestion for, with the lines around it.
        </li>
        <li>
          <strong>Jev, from TypeSafe</strong>, with your own key, only while you turn it on: what it is asked about,
          such as a Suggestion or your staged changes.
        </li>
        <li>
          <strong>Your Issue Tracker</strong>, Jira Cloud or Trello, with your own token, to list your Issues.
        </li>
        <li>
          <strong>GitHub, for authors&apos; pictures</strong>, for a repository on GitHub.com, unless you turn
          them off in Settings: the email in each commit shown, to find its author&apos;s picture.
        </li>
        <li>
          <strong>GitHub, for Updates and the model catalog</strong>: the Desktop App asks whether a newer Release
          is out as it starts, unless you turn that off, and reads the list of models from Lanewise&apos;s
          repository. Neither request says anything about you.
        </li>
      </ul>
      <p>
        Each of these services handles what it receives under its own privacy policy and terms, which you agreed to
        with them. Lanewise is not part of that.
      </p>

      <h3>The project website</h3>
      <p>
        Lanewise&apos;s website is served by GitHub Pages and stores nothing on your device. GitHub may log your
        visit, as any web host does, under GitHub&apos;s own privacy statement.
      </p>

      <h3>Your rights</h3>
      <p>
        Since the project holds no data about you, there is nothing it can show, correct or delete. What Lanewise
        keeps on your computer is yours to remove: clear its app data, its logs and its entries in your credential
        store. For what a service you used holds, ask that service.
      </p>

      <h3>Children</h3>
      <p>Lanewise collects nothing from anyone, children included.</p>

      <h3>Changes to this policy</h3>
      <p>
        We may update this policy as Lanewise changes. Any change will appear here with a revised &ldquo;last
        updated&rdquo; date, and in the project&apos;s history on GitHub.
      </p>

      <h3>Contact us</h3>
      <p>
        If you have a question about this policy, please{" "}
        <ExternalLink href={ISSUES_URL} onOpenLink={onOpenLink}>
          open an issue on GitHub
        </ExternalLink>
        .
      </p>
    </>
  );
}
