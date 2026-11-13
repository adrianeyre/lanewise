import { Download, KeyRound, ShieldCheck } from "lucide-react";

import { ExternalLink } from "../../app/src/legal/ExternalLink";
import { Footer } from "../../app/src/legal/Footer";
import { REPOSITORY_URL } from "../../app/src/legal/links";
import { type Downloads, RELEASES_URL } from "./downloads";
import { HeroScene } from "./scenes/HeroScene";
import { DiffTile, GraphTile, ProvidersTile, StashTile } from "./scenes/tiles";
import { SCREENSHOTS } from "./screenshots";
import { SetupSections } from "./Setup";

interface Props {
  /** The latest Release's installers, or none before the first Release. */
  downloads: Downloads | null;
}

/**
 * The project website (PRD §12.1): a landing and download page, not the app
 * (ADR 0003). It isn't on a Grid, and has the footer every page has. Its
 * pictures of Lanewise are scenes, drawn as stageshow draws a product
 * (`scenes/`), beside screenshots of the app itself.
 */
export function Site({ downloads }: Props) {
  return (
    <div className="site">
      <a className="site-skip" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <a className="site-brand" href="./">
          <img className="site-logo" src="favicon.svg" width="32" height="32" alt="" />
          Lanewise
        </a>
        <nav aria-label="Lanewise" className="site-nav">
          <a href="#download">Download</a>
          <a href="#install">Install</a>
          <a href="#build">Build from source</a>
          <a href="#docs">Documentation</a>
          <ExternalLink href={REPOSITORY_URL}>Source on GitHub</ExternalLink>
        </nav>
      </header>

      <main id="main" className="site-main">
        <section className="site-hero" aria-labelledby="site-title">
          <div className="site-hero-copy">
            <h1 id="site-title">Lanewise</h1>
            <p className="site-tagline">A free Git client with a visual commit graph.</p>
            <p>
              Lanewise is a free, open-source desktop Git client for Windows and macOS. It draws your history as a
              Commit graph, one lane per line of history, and walks you through merge conflicts with a three-way view
              and, if you want them, AI Suggestions from the Model Provider you choose, with your own API key.
            </p>
            <DownloadButtons downloads={downloads} />
          </div>
          <HeroScene />
        </section>

        <section className="site-section" aria-labelledby="site-features">
          <h2 id="site-features">What it does</h2>
          <ul className="site-bento">
            <li className="site-tile site-tile-wide">
              <h3>A Commit graph that keeps up</h3>
              <p>
                Branches, tags and remotes are labelled on the commits they point at, and lanes never move sideways,
                even on a repository of more than 100,000 commits.
              </p>
              <GraphTile />
            </li>
            <li className="site-tile site-tile-stat">
              <h3>Quick on a large history</h3>
              <p className="site-stat">
                <span className="site-stat-lead">git/git&apos;s first screen in</span>
                <span className="site-stat-number">168 ms</span>
              </p>
              <p>Its Commit graph, drawn from a commit-graph file, as Lanewise&apos;s benchmark measured it.</p>
            </li>
            <li className="site-tile">
              <h3>Your daily Git</h3>
              <p>
                Stage files or single hunks, commit and amend, and right-click a stash in the graph to apply, pop or
                drop it. Clone, fetch, pull and push through the Git you already have.
              </p>
              <StashTile />
            </li>
            <li className="site-tile site-tile-statement">
              <h3>Yours, and nobody else&apos;s</h3>
              <p className="site-statement">
                <ShieldCheck aria-hidden="true" className="site-statement-icon" />
                No account, no telemetry and no subscription.
              </p>
              <p>
                Your API keys stay in your operating system&apos;s credential store, and Lanewise is MIT licensed.
              </p>
            </li>
            <li className="site-tile">
              <h3>AI Suggestions, never applied for you</h3>
              <p>
                Ask Claude, Gemini, OpenAI, xAI, Meta or a local model for a Suggestion, with its explanation and a
                Confidence. Nothing goes into your file until you accept it.
              </p>
              <ProvidersTile />
            </li>
            <li className="site-tile site-tile-statement">
              <h3>Sign-in that works</h3>
              <p className="site-statement">
                <KeyRound aria-hidden="true" className="site-statement-icon" />
                Through Git Credential Manager.
              </p>
              <p>
                GitHub.com and GitHub Enterprise Server, including organizations with SAML SSO. When a sign-in fails,
                Lanewise says why and how to fix it.
              </p>
            </li>
            <li className="site-tile site-tile-wide">
              <h3>Diffs and conflicts, side by side</h3>
              <p>
                See a file as it was beside the file as it is, and a conflict&apos;s Base, Ours and Theirs together,
                editing the Resolution one Conflict Hunk at a time.
              </p>
              <DiffTile />
            </li>
          </ul>
        </section>

        <section className="site-section" aria-labelledby="site-screenshots">
          <h2 id="site-screenshots">Screenshots</h2>
          <div className="site-screenshots">
            {SCREENSHOTS.map((screenshot) => (
              <figure key={screenshot.src} className="site-screenshot">
                <img
                  src={screenshot.src}
                  width={screenshot.width}
                  height={screenshot.height}
                  alt={screenshot.alt}
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>{screenshot.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section id="download" className="site-section" aria-labelledby="site-download">
          <h2 id="site-download">Download</h2>
          <DownloadButtons downloads={downloads} />
          <p>
            Lanewise needs <ExternalLink href="https://git-scm.com/downloads">Git</ExternalLink> 2.40 or later, and
            says so when it starts if it&apos;s missing.
          </p>
          <ul>
            <li>
              <strong>macOS 14 or later</strong>, on Apple Silicon or Intel: open the disk image and drag Lanewise to
              Applications. It is signed ad hoc and not notarized by Apple, so the first time you open it, choose{" "}
              <strong>Open Anyway</strong> in System Settings, under Privacy &amp; Security.
            </li>
            <li>
              <strong>Windows 10 22H2 or later, or Windows 11</strong>, on x64: run the installer, which needs no
              administrator rights. It isn&apos;t signed yet, so if SmartScreen stops it, choose{" "}
              <strong>More info</strong>, then <strong>Run anyway</strong>.
            </li>
          </ul>
          <p>
            <a href="#install">Install</a> has every command, and each Release&apos;s notes say more about installing it.{" "}
            <ExternalLink href={RELEASES_URL}>See every Release</ExternalLink>.
          </p>
        </section>

        <SetupSections />
      </main>

      <Footer />
    </div>
  );
}

/** A button for each platform's installer from the latest Release, or word that there isn't one yet. */
function DownloadButtons({ downloads }: Props) {
  if (downloads === null) {
    return (
      <p className="site-downloads">
        There&apos;s no Release to download yet.{" "}
        <ExternalLink href={RELEASES_URL}>Watch for the first on GitHub</ExternalLink>.
      </p>
    );
  }
  return (
    <div className="site-downloads">
      <ul className="site-download-list">
        <li>
          <a className="button site-download" href={downloads.windows}>
            <Download aria-hidden="true" className="button-icon" />
            Download for Windows
          </a>
        </li>
        <li>
          <a className="button site-download" href={downloads.macos}>
            <Download aria-hidden="true" className="button-icon" />
            Download for macOS
          </a>
        </li>
      </ul>
      <p className="site-version">
        Version {downloads.version}.{" "}
        <ExternalLink href={downloads.notes}>What&apos;s new in {downloads.version}</ExternalLink>
      </p>
    </div>
  );
}
