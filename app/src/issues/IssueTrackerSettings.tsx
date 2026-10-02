import { Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";

import type {
  CommandClient,
  IssueTracker,
  IssueTrackerAccountShown,
  IssueTrackerError,
  SaveIssueTrackerAccountRequest,
} from "../commands/api";
import { ExternalLink, type LinkOpener } from "../legal/ExternalLink";
import { describeFailure } from "../repository/problems";
import { describeIssueTrackerError, JIRA_TOKEN_PAGE, TRACKER_NAMES, TRELLO_KEY_PAGE } from "./issueWords";
import { announceIssueTrackersChanged } from "./trackerEvents";

interface Props extends LinkOpener {
  commands: CommandClient;
}

/**
 * The Issue Trackers (ADR 0038): Jira Cloud and Trello, each signed in to
 * with the user's own API token, which the core checks with the Issue
 * Tracker before keeping it in the OS credential store. Once one is saved,
 * it says who is signed in, and Forget forgets it. The token is never shown
 * again, nor kept in the UI.
 */
export function IssueTrackerSettings({ commands, onOpenLink }: Props) {
  const headingId = useId();
  const [announcement, setAnnouncement] = useState("");
  return (
    <section className="settings-group" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-legend">
        Issue Trackers
      </h3>
      <p className="settings-choice-note">
        Add Jira Cloud or Trello, and the Issues Widget lists your open Issues, so you can make a branch for one.
        Your API token is checked with the Issue Tracker, then kept in your system&apos;s credential store, never in
        Lanewise&apos;s settings. Lanewise only reads your Issues, and never changes anything there.
      </p>
      <TrackerAccount tracker="jira" commands={commands} onOpenLink={onOpenLink} onAnnounce={setAnnouncement} />
      <TrackerAccount tracker="trello" commands={commands} onOpenLink={onOpenLink} onAnnounce={setAnnouncement} />
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </section>
  );
}

interface AccountProps extends LinkOpener {
  tracker: IssueTracker;
  commands: CommandClient;
  onAnnounce(announcement: string): void;
}

type Field = "site" | "email" | "key" | "token";

/** Which field a problem is about, to show it beside that field, or `null` for the form as a whole. */
function fieldOf(error: IssueTrackerError): Field | null {
  if (error.kind === "invalidSite") return "site";
  if (error.kind === "missingField") return error.field;
  return null;
}

/** What's saved for one Issue Tracker, or the form that saves it. */
function TrackerAccount({ tracker, commands, onOpenLink, onAnnounce }: AccountProps) {
  const headingId = useId();
  const name = TRACKER_NAMES[tracker];
  // `undefined` while it's read.
  const [account, setAccount] = useState<IssueTrackerAccountShown | null | undefined>(undefined);
  const [values, setValues] = useState<Record<Field, string>>({ site: "", email: "", key: "", token: "" });
  const [problem, setProblem] = useState<{ field: Field | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef<HTMLInputElement>(null);
  // Where focus goes once what had it is gone: to Forget once saved, and to the first field once forgotten.
  const refocus = useRef<"forget" | "first" | null>(null);
  const focusWhenShown = (which: "forget" | "first") => (element: HTMLElement | null) => {
    if (element === null || refocus.current !== which) return;
    refocus.current = null;
    element.focus();
  };

  useEffect(() => {
    let live = true;
    commands.call("issueTrackerAccount", { tracker }).then(
      (outcome) => {
        if (!live) return;
        setAccount(outcome.ok ? outcome.value : null);
        if (!outcome.ok) setProblem({ field: null, text: describeIssueTrackerError(outcome.error, tracker) });
      },
      (failure: unknown) => {
        if (!live) return;
        setAccount(null);
        setProblem({ field: null, text: describeFailure(failure) });
      },
    );
    return () => {
      live = false;
    };
  }, [commands, tracker]);

  function change(field: Field, value: string) {
    setValues((all) => ({ ...all, [field]: value }));
    if (problem?.field === field || problem?.field === null) setProblem(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const request: SaveIssueTrackerAccountRequest =
      tracker === "jira"
        ? { tracker, site: values.site, email: values.email, token: values.token }
        : { tracker, key: values.key, token: values.token };
    try {
      const outcome = await commands.call("saveIssueTrackerAccount", request);
      if (!outcome.ok) {
        const field = fieldOf(outcome.error);
        setProblem({ field, text: describeIssueTrackerError(outcome.error, tracker) });
        if (field === null && outcome.error.kind === "tokenRefused") token.current?.focus();
        return;
      }
      const saved = await commands.call("issueTrackerAccount", { tracker });
      refocus.current = "forget";
      setAccount(saved.ok && saved.value !== null ? saved.value : { site: null, email: null, name: outcome.value.name });
      setValues({ site: "", email: "", key: "", token: "" });
      onAnnounce(`Signed in to ${name} as ${outcome.value.name}.`);
      announceIssueTrackersChanged();
    } catch (failure) {
      setProblem({ field: null, text: describeFailure(failure) });
    } finally {
      setBusy(false);
    }
  }

  async function forgetAccount() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await commands.call("forgetIssueTrackerAccount", { tracker });
      if (!outcome.ok) {
        setProblem({ field: null, text: describeIssueTrackerError(outcome.error, tracker) });
        return;
      }
      refocus.current = "first";
      setAccount(null);
      onAnnounce(`Forgot your ${name} account.`);
      announceIssueTrackersChanged();
    } catch (failure) {
      setProblem({ field: null, text: describeFailure(failure) });
    } finally {
      setBusy(false);
    }
  }

  const fieldProblem = (field: Field) => (problem?.field === field ? problem.text : null);
  return (
    <section className="issue-tracker-account" aria-labelledby={headingId} aria-busy={busy || undefined}>
      <h4 id={headingId} className="settings-choice-label">
        {name}
      </h4>
      {account === undefined && <p className="settings-choice-note">Looking for your {name} account…</p>}
      {account !== undefined && account !== null && (
        <div className="issue-tracker-signed-in">
          <p className="settings-choice-note">
            {tracker === "jira" && account.site !== null
              ? `Signed in to ${account.site} as ${account.email ?? account.name ?? "you"}.`
              : `Signed in to ${name} as ${account.name ?? "you"}.`}
          </p>
          <div>
            <button
              ref={focusWhenShown("forget")}
              type="button"
              className="button button-small"
              aria-disabled={busy || undefined}
              onClick={() => void forgetAccount()}
            >
              <Trash2 aria-hidden="true" className="button-icon" />
              Forget the {name} account
            </button>
          </div>
        </div>
      )}
      {account === null && (
        <form className="issue-tracker-form" noValidate onSubmit={(event) => void save(event)}>
          {tracker === "jira" ? (
            <>
              <TextField
                inputRef={focusWhenShown("first")}
                label="Site"
                note="Your Jira Cloud site's address, such as your-team.atlassian.net."
                value={values.site}
                inputMode="url"
                problem={fieldProblem("site")}
                onChange={(value) => change("site", value)}
              />
              <TextField
                label="Email"
                note="The email you sign in to Jira with."
                value={values.email}
                type="email"
                problem={fieldProblem("email")}
                onChange={(value) => change("email", value)}
              />
              <SecretField
                inputRef={token}
                label="API token"
                value={values.token}
                problem={fieldProblem("token")}
                onChange={(value) => change("token", value)}
                note={
                  <ExternalLink href={JIRA_TOKEN_PAGE} onOpenLink={onOpenLink}>
                    Create an API token
                  </ExternalLink>
                }
              />
            </>
          ) : (
            <>
              <SecretField
                inputRef={focusWhenShown("first")}
                label="API key"
                value={values.key}
                problem={fieldProblem("key")}
                onChange={(value) => change("key", value)}
                note={
                  <>
                    Make a Power-Up of your own, then generate its API key and a token for it.{" "}
                    <ExternalLink href={TRELLO_KEY_PAGE} onOpenLink={onOpenLink}>
                      Get a Trello API key
                    </ExternalLink>
                  </>
                }
              />
              <SecretField
                inputRef={token}
                label="Token"
                value={values.token}
                problem={fieldProblem("token")}
                onChange={(value) => change("token", value)}
              />
            </>
          )}
          <div>
            <button type="submit" className="button" aria-disabled={busy || undefined}>
              <KeyRound aria-hidden="true" className="button-icon" />
              {busy ? "Checking…" : `Save and check the ${name} account`}
            </button>
          </div>
        </form>
      )}
      {problem !== null && problem.field === null && (
        <p role="alert" className="problem">
          {problem.text}
        </p>
      )}
    </section>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  problem: string | null;
  note?: ReactNode;
  type?: "text" | "email";
  inputMode?: "url";
  inputRef?: Ref<HTMLInputElement>;
}

/** A labelled field with its note, and its problem beside it as an alert. */
function TextField({ label, value, onChange, problem, note, type = "text", inputMode, inputRef }: TextFieldProps) {
  const id = useId();
  const noteId = useId();
  const problemId = useId();
  return (
    <div className="branch-field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-invalid={problem !== null || undefined}
        aria-describedby={[note === undefined ? undefined : noteId, problem === null ? undefined : problemId]
          .filter(Boolean)
          .join(" ") || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {note !== undefined && (
        <p id={noteId} className="settings-choice-note">
          {note}
        </p>
      )}
      {problem !== null && (
        <p id={problemId} role="alert" className="problem">
          {problem}
        </p>
      )}
    </div>
  );
}

/** A field for a token or key, hidden unless Show is pressed, never filled in by the browser. */
function SecretField({ label, value, onChange, problem, note, inputRef }: Omit<TextFieldProps, "type" | "inputMode">) {
  const id = useId();
  const noteId = useId();
  const problemId = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="branch-field">
      <label htmlFor={id}>{label}</label>
      <div className="clone-folder">
        <input
          ref={inputRef}
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={problem !== null || undefined}
          aria-describedby={[note === undefined ? undefined : noteId, problem === null ? undefined : problemId]
            .filter(Boolean)
            .join(" ") || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="button button-small"
          aria-pressed={shown}
          aria-label={`Show ${label}`}
          onClick={() => setShown((was) => !was)}
        >
          {shown ? (
            <EyeOff aria-hidden="true" className="button-icon" />
          ) : (
            <Eye aria-hidden="true" className="button-icon" />
          )}
          Show
        </button>
      </div>
      {note !== undefined && (
        <p id={noteId} className="settings-choice-note">
          {note}
        </p>
      )}
      {problem !== null && (
        <p id={problemId} role="alert" className="problem">
          {problem}
        </p>
      )}
    </div>
  );
}
