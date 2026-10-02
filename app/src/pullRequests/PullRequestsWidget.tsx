import { GitPullRequest, LocateFixed, LogIn, RefreshCw } from "lucide-react";
import { useId } from "react";

import type { HostError, PullRequest, PullRequestsError, RepositoryError } from "../commands/api";
import { HostLogo } from "../hosts/OpenOnHost";
import { explainHostError } from "../hosts/hostWords";
import { describeRepositoryError } from "../repository/problems";
import type { PullRequests } from "./usePullRequests";
import { SectionHeading, useSectionOpen } from "../ui/Section";

interface Props {
  pullRequests: PullRequests;
  /** Opens a Pull Request's page: in a Tab of its own, or the user's browser (ADR 0042). */
  onOpenLink: (url: string) => void;
  /** Called with the tip of a Pull Request's branch, for the Commit graph to show it. */
  onShowCommit: (commit: string) => void;
}

const REPOSITORY_ERRORS: ReadonlySet<string> = new Set(["notAFolder", "notARepository", "noWorkingTree", "unreadable"]);

/**
 * Why the Pull Requests weren't read, in words, whether signing in could
 * help, and whether it's a failure, rather than there being none to read,
 * as for a repository on no Host.
 */
function describe(error: PullRequestsError): { said: string; signIn: boolean; failed?: boolean } {
  if (error.kind === "noHost") {
    return { said: "None of this repository's remotes is on a Host, so it has no Pull Requests.", signIn: false, failed: false };
  }
  if (REPOSITORY_ERRORS.has(error.kind)) {
    return { said: describeRepositoryError(error as RepositoryError), signIn: false };
  }
  const hostError = error as HostError;
  if (hostError.kind === "notOffered") {
    return {
      said: `Lanewise reads Pull Requests from GitHub only, so far, not ${hostError.host}.`,
      signIn: false,
      failed: false,
    };
  }
  if (hostError.kind === "noCredential") {
    return {
      said: `Sign in to ${hostError.host} to see this repository's Pull Requests: it isn't public, or ${hostError.host} wouldn't say without signing in.`,
      signIn: true,
    };
  }
  const help = explainHostError(hostError);
  return { said: help.said, signIn: help.signInAgain || hostError.kind === "tokenRefused" };
}

/** `#12`, as a Pull Request is named. */
export function pullRequestName(pull: PullRequest): string {
  return `#${pull.number}`;
}

/**
 * The Pull requests Widget, in the sidebar: the repository's open Pull
 * Requests on its Host, newest first, each by its number and title. A click
 * on one opens it, in a Tab of its own or the user's browser; beside it, a button shows its
 * branch's tip in the Commit graph, which marks it too. They're read as the
 * repository opens, with only a credential already kept, and again with
 * Refresh; signing in is only ever asked for.
 */
export function PullRequestsWidget({ pullRequests, onOpenLink, onShowCommit }: Props) {
  const headingId = useId();
  // A section of the left column's accordion.
  const [pullsOpen, togglePulls] = useSectionOpen("pullRequests");
  const pullsId = useId();
  const { state, refresh } = pullRequests;
  const count =
    state.kind === "read"
      ? state.pullRequests.length === 1
        ? "1 open."
        : `${state.pullRequests.length} open.`
      : state.kind === "reading"
        ? "Reading…"
        : "";
  const problem =
    state.kind === "failed" ? describe(state.error) : state.kind === "broken" ? { said: state.problem, signIn: false } : null;

  return (
    <section className="surface pull-requests" aria-labelledby={headingId} aria-busy={state.kind === "reading" || undefined}>
      <div className="surface-header">
        <SectionHeading level={3} open={pullsOpen} onToggle={togglePulls} controls={pullsId} labelId={headingId}>
          Pull requests
        </SectionHeading>
        <p role="status" className="surface-count">
          {count}
        </p>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh Pull Requests"
          title="Refresh Pull Requests"
          aria-disabled={state.kind === "reading" || undefined}
          onClick={() => {
            if (state.kind !== "reading") refresh();
          }}
        >
          <RefreshCw aria-hidden="true" className="button-icon" />
        </button>
      </div>
      {problem !== null && problem.failed === false && <p className="surface-note">{problem.said}</p>}
      {problem !== null && problem.failed !== false && (
        <div className="issues-problem">
          <p role="alert" className="problem">
            {problem.said}
          </p>
          {problem.signIn && (
            <button type="button" className="button button-small" onClick={() => refresh(true)}>
              <LogIn aria-hidden="true" className="button-icon" />
              Sign in
            </button>
          )}
        </div>
      )}
      {pullsOpen && (
        <div id={pullsId}>
        {state.kind === "read" && state.pullRequests.length === 0 && (
          <p className="surface-note">No open Pull Requests on {state.host}.</p>
        )}
        {state.kind === "read" && state.pullRequests.length > 0 && (
          <ul className="pull-request-list" aria-label={`Open Pull Requests on ${state.host}`}>
            {state.pullRequests.map((pull) => (
              <li key={pull.number} className="pull-request">
                <button
                  type="button"
                  className="pull-request-open"
                  title={`Open ${pullRequestName(pull)} on ${state.host}: ${pull.url}`}
                  onClick={() => onOpenLink(pull.url)}
                >
                  <span className="pull-request-title">
                    <HostLogo integration={state.integration} />
                    <span className="pull-request-number">{pullRequestName(pull)}</span>{" "}
                    <span>{pull.title === "" ? "(No title)" : pull.title}</span>
                  </span>
                  <span className="pull-request-note">
                    {pull.draft && <span className="pull-request-draft">Draft</span>}
                    {pull.author !== null && <span>{pull.author}</span>}
                    <span>
                      {pull.head.branch} → {pull.base}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Show ${pullRequestName(pull)}'s branch in the Commit graph`}
                  title="Show in the Commit graph"
                  onClick={() => onShowCommit(pull.head.commit)}
                >
                  <LocateFixed aria-hidden="true" className="button-icon" />
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
      )}
    </section>
  );
}

/** A Pull Request's mark, as the Commit graph draws it beside its branch's tip. */
export function PullRequestIcon() {
  return <GitPullRequest aria-hidden="true" className="label-pull-request-icon" />;
}
