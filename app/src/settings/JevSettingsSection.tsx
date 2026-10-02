import { KeyRound, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";

import { JEV_ID, JEV_KEY_PAGE } from "../ai/jev";
import type { JevSettings } from "../ai/jevSettings";
import { keyStoreWords } from "../ai/aiWords";
import { ExternalLink, type LinkOpener } from "../legal/ExternalLink";
import type { Platform } from "../platform/platform";
import { describeFailure } from "../repository/problems";
import { GatewaySettings } from "./GatewaySettings";

interface Props extends LinkOpener {
  jev: JevSettings;
  onChange(change: Partial<JevSettings>): void;
  platform: Pick<Platform, "commands">;
  onAnnounce(announcement: string): void;
}

/** What each of Jev's decisions sends to TypeSafe, as the disclosure lists it. */
const SENT = [
  "For a Suggestion's check: the conflicted file's path, the Conflict Hunk's Base, Ours and Theirs, and the Suggestion's Resolution text.",
  "For which side a Conflict Hunk takes: the path, its Base, Ours and Theirs, and the lines round it, as many as a Suggestion sends.",
  "For a commit's check: the staged changes' diff, up to about 60,000 characters, and the Commit Message.",
];

/**
 * Jev (ADR 0036): TypeSafe AI's decision model, off until turned on here,
 * which lists what each of its decisions sends. Each decision can be turned
 * off on its own. Its TypeSafe API key is kept in the OS credential store,
 * and its requests can go through a gateway, such as Vercel AI Gateway's.
 */
export function JevSettingsSection({ jev, onChange, platform, onAnnounce, onOpenLink }: Props) {
  const sentId = useId();
  return (
    <section className="settings-group" aria-labelledby={`${sentId}-heading`}>
      <h3 id={`${sentId}-heading`} className="settings-legend">
        Jev decisions
      </h3>
      <p className="settings-choice-note">
        Jev, TypeSafe AI&apos;s decision model, answers typed questions quickly rather than writing text. With your
        own TypeSafe API key, Lanewise can ask it to check each Suggestion, to say which side a Conflict Hunk likely
        takes, and to check staged changes before a commit. It never acts on an answer: you do.
      </p>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={jev.enabled}
          aria-describedby={sentId}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        Let Jev help with decisions, sending TypeSafe what&apos;s listed below
      </label>
      <ul id={sentId} className="settings-choice-note">
        {SENT.map((sent) => (
          <li key={sent}>{sent}</li>
        ))}
      </ul>
      {jev.enabled && (
        <fieldset className="settings-group">
          <legend className="settings-choice-label">What Jev decides</legend>
          {(
            [
              ["suggestions", "Check each Suggestion, its verdict joining the Confidence"],
              ["triage", "Offer which side a Conflict Hunk likely takes"],
              ["commits", "Check staged changes for secrets and leftovers before a commit, and suggest its type"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="settings-check">
              <input type="checkbox" checked={jev[key]} onChange={(event) => onChange({ [key]: event.target.checked })} />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      <JevKey platform={platform} onAnnounce={onAnnounce} onOpenLink={onOpenLink} />
      <GatewaySettings provider={{ id: JEV_ID, name: "Jev" }} platform={platform} onAnnounce={onAnnounce} />
    </section>
  );
}

/** Jev's TypeSafe API key: whether one is kept, and a field to keep one, never showing it. */
function JevKey({ platform, onAnnounce, onOpenLink }: Pick<Props, "platform" | "onAnnounce" | "onOpenLink">) {
  const fieldId = useId();
  const noteId = useId();
  const [kept, setKept] = useState<boolean | undefined>(undefined);
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    platform.commands.call("modelProviderKeyStored", { provider: JEV_ID }).then(
      (outcome) => {
        if (live) setKept(outcome.ok ? outcome.value : false);
      },
      () => {
        if (live) setKept(false);
      },
    );
    return () => {
      live = false;
    };
  }, [platform.commands]);

  async function run(command: "saveModelProviderKey" | "forgetModelProviderKey", event?: FormEvent) {
    event?.preventDefault();
    try {
      const outcome =
        command === "saveModelProviderKey"
          ? await platform.commands.call(command, { provider: JEV_ID, key })
          : await platform.commands.call(command, { provider: JEV_ID });
      if (!outcome.ok) return setProblem(keyStoreWords(outcome.error));
      const saved = command === "saveModelProviderKey";
      setKept(saved);
      setKey("");
      setProblem(null);
      onAnnounce(saved ? "Saved your TypeSafe API key for Jev." : "Forgot your TypeSafe API key for Jev.");
    } catch (failure) {
      setProblem(describeFailure(failure));
    }
  }

  return (
    <form className="settings-host-form" noValidate onSubmit={(event) => void run("saveModelProviderKey", event)}>
      <div className="branch-field">
        <label htmlFor={fieldId}>{kept ? "Replace your TypeSafe API key" : "TypeSafe API key"}</label>
        <div className="clone-folder">
          <input
            id={fieldId}
            type="password"
            value={key}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={noteId}
            aria-invalid={problem !== null || undefined}
            onChange={(event) => {
              setKey(event.target.value);
              setProblem(null);
            }}
          />
          <button type="submit" className="button">
            <KeyRound aria-hidden="true" className="button-icon" />
            Save
          </button>
        </div>
        <p id={noteId} className="settings-choice-note">
          {kept === undefined
            ? "Looking for your TypeSafe API key…"
            : kept
              ? "Your TypeSafe API key is kept in your system's credential store."
              : "No TypeSafe API key is kept yet. It's kept in your system's credential store, never in Lanewise's settings."}{" "}
          <ExternalLink href={JEV_KEY_PAGE} onOpenLink={onOpenLink}>
            Make a TypeSafe API key
          </ExternalLink>
        </p>
      </div>
      {kept && (
        <div>
          <button type="button" className="button button-small" onClick={() => void run("forgetModelProviderKey")}>
            <Trash2 aria-hidden="true" className="button-icon" />
            Forget the TypeSafe API key
          </button>
        </div>
      )}
      {problem !== null && (
        <p role="alert" className="problem">
          {problem}
        </p>
      )}
    </form>
  );
}
