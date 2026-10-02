import { useId } from "react";

import { ExternalLink, type LinkOpener } from "./ExternalLink";
import { ISSUES_URL } from "./links";
import { STORED_ITEMS } from "./stored";

/** The Cookie Policy's text, shown in its dialog. There is no cookie banner: nothing here needs consent. */
export function CookiePolicy({ onOpenLink }: LinkOpener) {
  const captionId = useId();
  return (
    <>
      <p className="policy-updated">Last updated: September 2026</p>

      <h3>About this policy</h3>
      <p>
        This policy explains how Lanewise uses cookies and similar technologies, such as the local storage of the
        app&apos;s window. Cookies and local storage are small pieces of data saved on your device that help an
        app work and remember your choices.
      </p>

      <h3>How we use them</h3>
      <p>
        Lanewise sets <strong>no cookies</strong>. It uses local storage only for the essential settings listed
        below, which stay on your device. There are <strong>no tracking, analytics or advertising cookies</strong>,
        nor anything else that tracks or profiles you, and nothing is shared with anyone for marketing. That is why
        there is no cookie banner.
      </p>

      <h3>What we store</h3>
      <div className="table-scroll" tabIndex={0} role="group" aria-labelledby={captionId}>
        <table>
          <caption id={captionId}>Items Lanewise may save in local storage on this device.</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Purpose</th>
              <th scope="col">Expiry</th>
            </tr>
          </thead>
          <tbody>
            {STORED_ITEMS.map((item) => (
              <tr key={item.name}>
                <td>
                  <code>{item.name}</code>
                </td>
                <td>{item.purpose}</td>
                <td>Until you clear it</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Your API keys</h3>
      <p>
        The API keys you give Lanewise for a Model Provider, and the API tokens for an Issue Tracker, are{" "}
        <strong>never</strong> kept in local storage or in
        any file of Lanewise&apos;s. They go in your operating system&apos;s credential store, in the Desktop App
        and in Web Mode alike.
      </p>

      <h3>Your repositories</h3>
      <p>
        Lanewise works on your repositories where they are, on your own disk, through your own Git. It never uploads
        them anywhere and keeps no copy of them.
      </p>

      <h3>Lanewise&apos;s logs</h3>
      <p>
        Lanewise keeps logs of what it did, such as a command that failed and why, in your operating system&apos;s
        folder for logs, and removes the oldest as they grow. They <strong>never</strong> hold credentials, API keys,
        your files&apos; contents or prompts, and Lanewise sends them nowhere: there is no telemetry of any kind.
        Settings&apos; Copy diagnostics copies the latest lines for a bug report, which you read, and send, yourself.
      </p>

      <h3>The project website</h3>
      <p>Lanewise&apos;s website stores nothing on your device at all.</p>

      <h3>Third-party services</h3>
      <p>
        Lanewise loads no third-party fonts, scripts or trackers. It contacts others only when you ask it to: the
        remotes and Hosts you fetch from and push to, and the Model Provider you chose, with your own API key and
        under that Model Provider&apos;s own terms and privacy policy. The Desktop App also asks GitHub whether a
        newer Release is out each time it starts, unless you turn that off in Settings, and whenever you choose Check
        for updates; it sends nothing about you or how you use Lanewise, and installs an Update only when you say so.
      </p>

      <h3>Managing cookies and storage</h3>
      <p>
        You can clear local storage at any time through your browser&apos;s settings in Web Mode, or by removing
        Lanewise&apos;s app data in the Desktop App. Clearing it won&apos;t stop Lanewise working, but your settings
        won&apos;t be remembered.
      </p>

      <h3>Changes to this policy</h3>
      <p>
        We may update this policy as Lanewise changes. Any change will appear here with a revised &ldquo;last
        updated&rdquo; date.
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
