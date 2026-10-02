import { Check, ListChecks, OctagonX, Pencil, RefreshCw, Scale, Sparkles, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { modelChoiceFor } from "../ai/aiSettings";
import { CONFIDENCE_WORDS, aiFailureWords, failedCheckWords, sentForASuggestion } from "../ai/aiWords";
import { type CheckedSuggestion, checkSuggestion, withJevVerdict } from "../ai/confidence";
import { checkWithJev, DOUBTFUL, type Triage, TRIAGE_WORDS, triageWithJev } from "../ai/jevDecisions";
import { type AiAccess, failsOnlyThisRequest, requestSuggestion } from "../ai/requests";
import { suggestionPrompt, suggestionRequest } from "../ai/suggestionRequest";
import { estimateTokens, recordUsage, useTokenTotals } from "../ai/usage";
import type { ConflictedFile, OpenedRepository } from "../commands/api";
import type { ConflictHunk } from "./conflictHunks";
import type { HunkInResolution, HunkPlace, ResolutionHandle } from "./ResolutionWidget";
import type { ConflictRead } from "./useConflictedFile";
import { resolvedWhole } from "./wholeFile";

interface Props {
  /** The Model Providers, and AI's settings, that a Suggestion is asked for through. */
  ai: AiAccess;
  repository: OpenedRepository;
  /** The conflicted file chosen in Conflicted files, or `null` with none, when the Widget is empty. */
  path: string | null;
  /** Its versions, or `null` while they're read. */
  read: ConflictRead | null;
  /** The Resolution being edited, which a Suggestion is asked for from and put in, or `null` with none. */
  editor: ResolutionHandle | null;
  /** Where the Conflict Hunk the Resolution's choices act on is, which a Suggestion is asked for. */
  place: HunkPlace | null;
}

/**
 * The Conflicts page's AI Suggestion Widget (PRD §8.1): Suggest a
 * resolution asks the Model Provider chosen in Settings for a Suggestion
 * for the Conflict Hunk the Resolution's choices act on, sending exactly
 * what the first-use disclosure lists. The Suggestion is shown, labelled as
 * AI-generated, with its Resolution text, the model's explanation and its
 * Confidence, which is low, and says why, where the Resolution text fails
 * Lanewise's checks. Suggest for all Conflict Hunks in this file asks for
 * one for each Conflict Hunk left, one at a time, with its progress and
 * Cancel, and shows each to be reviewed on its own: there's no accepting
 * them all. Only Accept or Edit puts one in the Resolution, and nothing
 * reaches the working tree until the Resolution is marked resolved. There's
 * none for a file resolved as a whole (PRD §7.7).
 */
export function SuggestionWidget({ ai, repository, path, read, editor, place }: Props) {
  const headingId = useId();
  return (
    <section className="surface suggestion" aria-labelledby={headingId}>
      <h3 id={headingId} className="surface-heading">
        AI Suggestion
      </h3>
      {path === null ? (
        <p className="surface-note">No file selected.</p>
      ) : read === null ? (
        <p role="status" className="file-status-summary">
          Reading “{path}”…
        </p>
      ) : !read.ok ? (
        <p className="surface-note">There's no Suggestion for “{path}”: it couldn't be read.</p>
      ) : resolvedWhole(read.file) ? (
        <p className="surface-note">
          There's no AI Suggestion for “{path}”: it's resolved as a whole, in the Resolution.
        </p>
      ) : !ai.settings.enabled ? (
        <AiOff />
      ) : (
        <Suggesting key={path} ai={ai} root={repository.root} path={path} file={read.file} editor={editor} place={place} />
      )}
    </section>
  );
}

/** How to turn AI on, while it's off, so nothing is sent. */
function AiOff() {
  return (
    <div className="suggestion-body">
      <p className="surface-note">AI is off, so nothing is sent to any Model Provider.</p>
      <p className="surface-note">
        To have a Suggestion made for a Conflict Hunk, open Settings in the title bar, turn on “Suggest Resolutions with
        AI”, choose a Model Provider and a model, and save your own API key for it. Then Suggest a resolution shows here.
      </p>
    </div>
  );
}

/** A Suggestion as it's shown: checked, for the Conflict Hunk it was asked for, where that was, and whose it is. */
interface Shown {
  key: number;
  checked: CheckedSuggestion;
  /** Jev's verdict, how likely it keeps what both sides meant, where Jev checked it; or why it couldn't. */
  jev?: { keepsBoth: number } | { problem: string } | null;
  hunk: ConflictHunk;
  place: HunkPlace;
  provider: string;
}

/**
 * A request running: for the one Conflict Hunk the Resolution is at, or for
 * every one in the file, one at a time, `asked` of `total` done so far, now
 * for the Conflict Hunk at `place`.
 */
interface Asking {
  controller: AbortController;
  all: boolean;
  asked: number;
  total: number;
  place: HunkPlace;
}

/** Where a Conflict Hunk is, in words: “Conflict Hunk 2 of 3, lines 14–22”. */
function describePlace(place: HunkPlace): string {
  return `Conflict Hunk ${place.index + 1} of ${place.count}, lines ${place.startLine}–${place.endLine}`;
}

function placeOf(at: HunkInResolution): HunkPlace {
  return { index: at.index, count: at.count, startLine: at.hunk.startLine, endLine: at.hunk.endLine };
}

/** “1 Suggestion” or “3 Suggestions”. */
function suggestions(count: number): string {
  return count === 1 ? "1 Suggestion" : `${count} Suggestions`;
}

/** “1 Conflict Hunk” or “3 Conflict Hunks”. */
function conflictHunkCount(count: number): string {
  return count === 1 ? "1 Conflict Hunk" : `${count} Conflict Hunks`;
}

/** “ The 2 Conflict Hunks after it weren't asked about.”, or nothing with none after it. */
function notAskedAfter(rest: number): string {
  if (rest === 0) return "";
  return rest === 1 ? " The Conflict Hunk after it wasn't asked about." : ` The ${rest} Conflict Hunks after it weren't asked about.`;
}

/** What asking for every Conflict Hunk's Suggestion came to, as it's said once it's done. */
function describeAskedAll({
  total,
  made,
  low,
  failed,
  unasked,
}: {
  total: number;
  made: number;
  low: number;
  failed: number;
  unasked: number;
}): string {
  const parts = [`${suggestions(made)} ready to review, each on its own`];
  if (low > 0) parts.push(`${low} with low Confidence: check ${low === 1 ? "it" : "them"} closely`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (unasked > 0) parts.push(`${unasked} not asked`);
  return `Asked about ${conflictHunkCount(total)}: ${parts.join("; ")}. Nothing was put in the Resolution.`;
}

/** Suggestions for one file's Conflict Hunks: give it the file's path as its `key`. */
function Suggesting({
  ai,
  root,
  path,
  file,
  editor,
  place,
}: {
  ai: AiAccess;
  root: string;
  path: string;
  file: ConflictedFile;
  editor: ResolutionHandle | null;
  place: HunkPlace | null;
}) {
  const sentId = useId();
  const suggestionId = useId();
  const progressId = useId();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [shown, setShown] = useState<Shown[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const suggest = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  // The Resolution as it is, for a request for every Conflict Hunk, which reads it again before each.
  const resolution = useRef(editor);
  const nextKey = useRef(0);
  // The Suggestion to move focus to once it's drawn, after the one before it is used or rejected: a new object each time.
  const [focusOn, setFocusOn] = useState<{ key: number } | null>(null);
  const { settings, providers } = ai;
  // Jev's pick of which way the Conflict Hunk at `place` goes, as a hint the user may apply (ADR 0036).
  const [triage, setTriage] = useState<
    | { state: "asking" }
    | { state: "done"; hunk: ConflictHunk; where: HunkPlace; triage: Triage; probability: number }
    | { state: "failed"; problem: string }
    | null
  >(null);

  async function askJevToTriage() {
    const at = editor?.current() ?? null;
    if (at === null || triage?.state === "asking") return;
    setTriage({ state: "asking" });
    const sent = suggestionRequest(at.text, at.hunk, {
      path,
      oursSubject: file.oursSubject,
      theirsSubject: file.theirsSubject,
      contextLines: settings.contextLines,
    });
    try {
      const picked = await triageWithJev(ai.platform, sent);
      if (picked === null) return setTriage({ state: "failed", problem: "Its answer wasn't one Lanewise could use." });
      setTriage({ state: "done", hunk: at.hunk, where: placeOf(at), ...picked });
      setSaid(`Jev takes ${describePlace(placeOf(at))} for ${TRIAGE_WORDS[picked.triage]}, ${Math.round(picked.probability * 100)}% likely.`);
    } catch (failure) {
      setTriage({ state: "failed", problem: failure instanceof Error ? failure.message : String(failure) });
    }
  }

  /** Puts Jev's pick in the Resolution, as the user chose, as one change undo takes back. */
  function applyTriage(hunk: ConflictHunk, picked: Triage) {
    const lines =
      picked === "ours"
        ? hunk.ours
        : picked === "theirs"
          ? hunk.theirs
          : picked === "oursThenTheirs"
            ? [...hunk.ours, ...hunk.theirs]
            : [...hunk.theirs, ...hunk.ours];
    const put = editor?.put(hunk, lines.join("\n"), false) ?? false;
    setSaid(put ? `Put ${TRIAGE_WORDS[picked]} in the Resolution, as Jev picked.` : "That Conflict Hunk has been resolved since Jev was asked.");
    setTriage(null);
  }
  const name = (id: string) => providers.find((provider) => provider.id === id)?.name ?? id;
  const chosen = modelChoiceFor(settings, root);
  const running = asking !== null;

  useEffect(() => {
    resolution.current = editor;
  }, [editor]);

  // A request still running for this file stops when it's no longer shown.
  useEffect(() => () => request.current?.abort(), []);

  useEffect(() => {
    if (focusOn !== null) document.getElementById(`${suggestionId}-${focusOn.key}`)?.focus();
  }, [focusOn, suggestionId]);

  /** Where the Conflict Hunk a Suggestion was asked for is now in the Resolution, or `null` once it's resolved. */
  const whereNow = (hunk: ConflictHunk) => resolution.current?.find(hunk)?.hunk.from ?? null;

  /** `list` with `added` in it, in place of any for the same Conflict Hunk, in the order they're in the Resolution. */
  function withSuggestion(list: readonly Shown[], added: Shown): Shown[] {
    const at = whereNow(added.hunk);
    const kept = list.filter((each) => at === null || whereNow(each.hunk) !== at);
    const order = (each: Shown) => whereNow(each.hunk) ?? Number.POSITIVE_INFINITY;
    return [...kept, added].toSorted((a, b) => order(a) - order(b));
  }

  /** Asks for a Suggestion for `at`, sending the Resolution's text as it is now, and checks it. */
  async function askAbout(at: HunkInResolution, signal: AbortSignal): Promise<Shown> {
    const sent = suggestionRequest(at.text, at.hunk, {
      path,
      oursSubject: file.oursSubject,
      theirsSubject: file.theirsSubject,
      contextLines: settings.contextLines,
    });
    const suggestion = await requestSuggestion({
      platform: ai.platform,
      providers,
      settings,
      catalog: (await ai.catalogs.current()).catalog,
      repository: root,
      request: sent,
      signal,
    });
    recordUsage(suggestion.usage);
    let checked = checkSuggestion(suggestion, sent);
    let jev: Shown["jev"] = null;
    if (ai.jev?.enabled && ai.jev.suggestions) {
      try {
        const verdict = await checkWithJev(ai.platform, sent, suggestion, signal);
        if (verdict !== null) {
          jev = verdict;
          checked = withJevVerdict(checked, verdict.keepsBoth, DOUBTFUL);
        }
      } catch (failure) {
        if (signal.aborted) throw failure;
        jev = { problem: failure instanceof Error ? failure.message : String(failure) };
      }
    }
    return {
      key: nextKey.current++,
      jev,
      checked,
      hunk: at.hunk,
      place: placeOf(at),
      provider: name(chosen?.provider ?? ""),
    };
  }

  /** A new request's controller, once any before it is stopped. */
  function begin(): AbortController {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setProblems([]);
    return controller;
  }

  /** Done with `controller`'s request, unless it was stopped, which says so itself. */
  function end(controller: AbortController) {
    if (request.current === controller) request.current = null;
    if (!controller.signal.aborted) setAsking(null);
  }

  async function ask() {
    const at = editor?.current() ?? null;
    if (running || at === null) return;
    const controller = begin();
    const where = placeOf(at);
    setAsking({ controller, all: false, asked: 0, total: 1, place: where });
    setSaid(`Asking for a Suggestion for ${describePlace(where)}…`);
    try {
      const made = await askAbout(at, controller.signal);
      // Cancelled: whatever came back isn't shown.
      if (controller.signal.aborted) return;
      setShown((list) => withSuggestion(list, made));
      const { confidence } = made.checked;
      setSaid(
        `AI-generated Suggestion ready for ${describePlace(where)}. Confidence ${CONFIDENCE_WORDS[confidence].toLowerCase()}${confidence === "low" ? ": check it closely" : ""}.`,
      );
    } catch (failure) {
      if (controller.signal.aborted) return;
      setProblems([aiFailureWords(failure, name)]);
      setSaid(null);
    } finally {
      end(controller);
    }
  }

  /**
   * Asks for a Suggestion for every Conflict Hunk left in the file that
   * hasn't one shown, one at a time, in order. Each is shown as it comes, to
   * be reviewed on its own, and none is put in the Resolution. A failure
   * that's that Conflict Hunk's own is said, and the rest are still asked
   * about. Any other would fail them too, so it stops there.
   */
  async function askAll() {
    if (running || editor === null) return;
    const suggested = new Set(shown.map((each) => whereNow(each.hunk)));
    const targets = editor
      .all()
      .filter((at) => !suggested.has(at.hunk.from))
      .map((at) => at.hunk);
    if (targets.length === 0) {
      setProblems([]);
      setSaid("Every Conflict Hunk left has a Suggestion shown to review. Reject one to ask for it again.");
      return;
    }
    const controller = begin();
    const total = targets.length;
    let made = 0;
    let low = 0;
    let failed = 0;
    let unasked = 0;
    setSaid(`Asking for a Suggestion for each of ${conflictHunkCount(total)}, one at a time…`);
    try {
      for (const [asked, target] of targets.entries()) {
        // Read again, as the user may have changed the Resolution since the one before.
        const at = resolution.current?.find(target) ?? null;
        if (at === null) {
          // Resolved in the meantime: there's nothing to ask about.
          unasked++;
          continue;
        }
        const where = placeOf(at);
        setAsking({ controller, all: true, asked, total, place: where });
        try {
          const one = await askAbout(at, controller.signal);
          if (controller.signal.aborted) return;
          setShown((list) => withSuggestion(list, one));
          made++;
          if (one.checked.confidence === "low") low++;
        } catch (failure) {
          if (controller.signal.aborted) return;
          failed++;
          const words = aiFailureWords(failure, name);
          if (failsOnlyThisRequest(failure)) {
            setProblems((list) => [...list, `No Suggestion for ${describePlace(where)}. ${words}`]);
            continue;
          }
          const rest = total - asked - 1;
          unasked += rest;
          setProblems((list) => [
            ...list,
            `No Suggestion for ${describePlace(where)}. ${words}${notAskedAfter(rest)}`,
          ]);
          break;
        }
      }
      setSaid(describeAskedAll({ total, made, low, failed, unasked }));
    } finally {
      end(controller);
    }
  }

  function cancel() {
    if (asking === null) return;
    asking.controller.abort();
    setAsking(null);
    setSaid(
      asking.all
        ? `Stopped asking for Suggestions at ${describePlace(asking.place)}. Those made before it are shown to review. Nothing was put in the Resolution.`
        : "Cancelled the request for a Suggestion. Nothing was put in the Resolution.",
    );
    suggest.current?.focus();
  }

  /** Takes `done` out of the Suggestions shown, and moves focus to the one after it, or else back to Suggest a resolution. */
  function dismiss(done: Shown, focus: boolean) {
    const index = shown.findIndex((each) => each.key === done.key);
    const left = shown.filter((each) => each.key !== done.key);
    setShown(left);
    if (!focus) return;
    const next = left[Math.min(index, left.length - 1)];
    if (next === undefined) suggest.current?.focus();
    else setFocusOn({ key: next.key });
  }

  function use(done: Shown, edit: boolean) {
    if (editor === null || !editor.put(done.hunk, done.checked.resolution, edit)) {
      setProblems([
        `${describePlace(done.place)} isn't in the Resolution any more, so the Suggestion wasn't put in. Ask again for the Conflict Hunk you're on.`,
      ]);
      setSaid(null);
      dismiss(done, true);
      return;
    }
    setProblems([]);
    setSaid(
      edit
        ? `Put the Suggestion in the Resolution at line ${done.hunk.startLine}, selected, to edit. Undo takes it back.`
        : `Accepted the Suggestion into the Resolution at line ${done.hunk.startLine}. Undo takes it back.`,
    );
    dismiss(done, !edit);
  }

  function reject(done: Shown) {
    setSaid("Rejected the Suggestion. The Resolution is as it was.");
    dismiss(done, true);
  }

  const cannotAsk = running || place === null || undefined;
  return (
    <div className="suggestion-body" aria-busy={running || undefined}>
      <p className="diff-path">{path}</p>
      <p className="resolution-position">
        {place === null ? "No Conflict Hunks left to ask about." : `For ${describePlace(place)}, where the Resolution is.`}
      </p>
      <ContextSummary
        editor={editor}
        path={path}
        file={file}
        contextLines={settings.contextLines}
        place={place}
      />
      <details className="suggestion-sent">
        <summary>
          What's sent to {chosen === null ? "the Model Provider" : name(chosen.provider)}
        </summary>
        <ul id={sentId}>
          {sentForASuggestion(settings.contextLines).map((sent) => (
            <li key={sent}>{sent}</li>
          ))}
        </ul>
      </details>
      <div className="resolution-controls">
        <div className="button-row">
          <button
            ref={suggest}
            type="button"
            className="button"
            aria-disabled={cannotAsk}
            aria-describedby={sentId}
            onClick={() => void ask()}
          >
            <Sparkles aria-hidden="true" className="button-icon" />
            Suggest a resolution
          </button>
          <button
            type="button"
            className="button"
            aria-disabled={cannotAsk}
            aria-describedby={sentId}
            onClick={() => void askAll()}
          >
            <ListChecks aria-hidden="true" className="button-icon" />
            Suggest for all Conflict Hunks in this file
          </button>
          {running && (
            <button type="button" className="button" onClick={cancel}>
              <OctagonX aria-hidden="true" className="button-icon" />
              Cancel
            </button>
          )}
          {ai.jev?.enabled && ai.jev.triage && (
            <button
              type="button"
              className="button"
              aria-disabled={place === null || triage?.state === "asking" || undefined}
              onClick={() => void askJevToTriage()}
            >
              <Scale aria-hidden="true" className="button-icon" />
              Ask Jev which side
            </button>
          )}
        </div>
      </div>
      {triage?.state === "asking" && (
        <p role="status" className="file-status-summary">
          Asking Jev…
        </p>
      )}
      {triage?.state === "failed" && (
        <p role="alert" className="problem">
          Jev couldn&apos;t say. {triage.problem}
        </p>
      )}
      {triage?.state === "done" && (
        <div className="jev-findings">
          <p className="suggestion-label">Jev</p>
          <p>
            For {describePlace(triage.where)}: {TRIAGE_WORDS[triage.triage]}, {Math.round(triage.probability * 100)}%
            likely. A hint only: check it before you use it.
          </p>
          {triage.triage !== "person" && (
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => applyTriage(triage.hunk, triage.triage)}>
                Use {TRIAGE_WORDS[triage.triage]}
              </button>
              <button type="button" className="button" onClick={() => setTriage(null)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
      {asking !== null &&
        (asking.all ? (
          <div className="suggestion-progress">
            <p id={progressId} className="surface-note">
              Asking for Suggestion {asking.asked + 1} of {asking.total}, for {describePlace(asking.place)}…
            </p>
            <div
              role="progressbar"
              className="suggestion-progress-bar"
              aria-labelledby={progressId}
              aria-valuemin={0}
              aria-valuemax={asking.total}
              aria-valuenow={asking.asked}
              aria-valuetext={`${asking.asked} of ${asking.total} asked`}
            >
              <div
                className="suggestion-progress-bar-done"
                style={{ inlineSize: `${(asking.asked / asking.total) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="surface-note">Asking for a Suggestion for {describePlace(asking.place)}…</p>
        ))}
      {problems.length > 0 && (
        <div role="alert" className="problem problem-output suggestion-problems">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}
      {shown.length > 1 && (
        <p className="surface-note">
          {suggestions(shown.length)} to review. Accept, edit or reject each on its own: none is put in the Resolution
          until you do.
        </p>
      )}
      {shown.map((each) => {
        // Where its Conflict Hunk is now, as those before it are resolved, or where it was, once it's resolved too.
        const now = editor?.find(each.hunk) ?? null;
        return (
          <SuggestionShown
            key={each.key}
            id={`${suggestionId}-${each.key}`}
            shown={each}
            place={now === null ? each.place : placeOf(now)}
            gone={now === null}
          onAccept={() => use(each, false)}
          onEdit={() => use(each, true)}
            onReject={() => reject(each)}
          />
        );
      })}
      <p role="status" className="visually-hidden">
        {said}
      </p>
    </div>
  );
}

/** A Suggestion, labelled as AI-generated, with its Resolution text, explanation and Confidence, and Accept, Edit and Reject. */
function SuggestionShown({
  id,
  shown,
  place,
  gone,
  onAccept,
  onEdit,
  onReject,
}: {
  id: string;
  shown: Shown;
  /** Where its Conflict Hunk is now, or was, if it's `gone`: resolved since it was asked. */
  place: HunkPlace;
  gone: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const { checked, provider } = shown;
  const low = checked.confidence === "low";
  const textId = `${id}-text`;
  return (
    <section className="suggestion-shown" aria-labelledby={id}>
      {/* Focusable, so focus can move on to it once the Suggestion before it is used or rejected. */}
      <h4 id={id} className="surface-subheading" tabIndex={-1}>
        <span className="suggestion-label">AI-generated</span> Suggestion for {describePlace(place)}
      </h4>
      <p className="surface-note">Made by {provider}. Check it before you use it: AI can be wrong.</p>
      {gone && (
        <p className="surface-note">
          Its Conflict Hunk has been resolved since it was asked, so it can't be put in. Reject it to dismiss it.
        </p>
      )}
      <p className={low ? "suggestion-confidence suggestion-confidence-low" : "suggestion-confidence"}>
        {low && <TriangleAlert aria-hidden="true" className="button-icon" />}
        Confidence: {CONFIDENCE_WORDS[checked.confidence]}
      </p>
      {low && <LowConfidence checked={checked} />}
      {shown.jev && "keepsBoth" in shown.jev && (
        <p className="surface-note">
          Jev: {Math.round(shown.jev.keepsBoth * 100)}% likely to keep what both sides meant.
        </p>
      )}
      {shown.jev && "problem" in shown.jev && (
        <p className="surface-note">Jev couldn&apos;t check it. {shown.jev.problem}</p>
      )}
      {checked.usage && (
        <p className="surface-note suggestion-tokens">
          Took {tokens(checked.usage.inputTokens)} in and {tokens(checked.usage.outputTokens)} out, as{" "}
          {provider} counts them.
        </p>
      )}
      <h5 id={textId} className="surface-subheading">
        Resolution text
      </h5>
      {checked.resolution === "" ? (
        <p className="surface-note">Empty: it would take the Conflict Hunk out, and put nothing in its place.</p>
      ) : (
        // Focusable, so the keyboard can scroll it, and named for its Suggestion too, as there can be several.
        <div className="suggestion-resolution" role="region" aria-labelledby={`${textId} ${id}`} tabIndex={0}>
          <pre>{checked.resolution}</pre>
        </div>
      )}
      <h5 className="surface-subheading">Why</h5>
      <p className="suggestion-explanation">{checked.explanation}</p>
      <div className="button-row" role="group" aria-label={`Use the Suggestion for ${describePlace(place)}`}>
        <button type="button" className="button button-small" onClick={onAccept}>
          <Check aria-hidden="true" className="button-icon" />
          Accept
        </button>
        <button type="button" className="button button-small" onClick={onEdit}>
          <Pencil aria-hidden="true" className="button-icon" />
          Edit
        </button>
        <button type="button" className="button button-small" onClick={onReject}>
          <X aria-hidden="true" className="button-icon" />
          Reject
        </button>
      </div>
      <p className="surface-note">
        Accept puts it in the Resolution in place of the Conflict Hunk, and Edit puts it in selected, to change. Undo takes
        either back. Nothing is written to the working tree until you mark the Resolution resolved.
      </p>
    </section>
  );
}

const count = new Intl.NumberFormat("en-GB");

function tokens(n: number): string {
  return n === 1 ? "1 token" : `${count.format(n)} tokens`;
}

/**
 * What a Suggestion for the Conflict Hunk the Resolution is at would send,
 * worked out from the Resolution as it is when Refresh context is chosen:
 * the lines of context each side, and about how many tokens that comes to.
 * Beside it, the tokens Suggestions have taken in this run, as their Model
 * Providers counted them.
 */
function ContextSummary({
  editor,
  path,
  file,
  contextLines,
  place,
}: {
  editor: ResolutionHandle | null;
  path: string;
  file: ConflictedFile;
  contextLines: number;
  place: HunkPlace | null;
}) {
  const totals = useTokenTotals();
  const [estimate, setEstimate] = useState<{ tokens: number; before: number; after: number } | null>(null);

  const refresh = useCallback(() => {
    const at = place === null ? null : (editor?.current() ?? null);
    if (at === null) return setEstimate(null);
    const sent = suggestionRequest(at.text, at.hunk, {
      path,
      oursSubject: file.oursSubject,
      theirsSubject: file.theirsSubject,
      contextLines,
    });
    setEstimate({ tokens: estimateTokens(suggestionPrompt(sent)), before: sent.before.length, after: sent.after.length });
  }, [editor, path, file, contextLines, place]);

  // Worked out again as the Conflict Hunk, or the context chosen, changes.
  useEffect(() => {
    queueMicrotask(refresh);
  }, [refresh]);

  return (
    <div className="suggestion-context">
      <p>
        {estimate === null
          ? "No Conflict Hunk to send."
          : `Context: ${estimate.before} lines before and ${estimate.after} after, of up to ${contextLines} each side, about ${tokens(estimate.tokens)} to send.`}
      </p>
      <p className="surface-note">
        {totals.counted === 0
          ? "No tokens taken yet in this run."
          : `This run: ${tokens(totals.inputTokens)} in and ${tokens(totals.outputTokens)} out, over ${suggestions(totals.counted)}.`}
      </p>
      <div>
        <button type="button" className="button button-small" onClick={refresh}>
          <RefreshCw aria-hidden="true" className="button-icon" />
          Refresh context
        </button>
      </div>
    </div>
  );
}

/** Why a Suggestion's Confidence is low: the checks it failed, or the model's own report. */
function LowConfidence({ checked }: { checked: CheckedSuggestion }) {
  return (
    <div className="problem suggestion-low">
      <p>
        <strong>Low Confidence.</strong>{" "}
        {checked.failed.length === 0
          ? "The model said it isn't sure of this Suggestion."
          : `The model said ${CONFIDENCE_WORDS[checked.reported].toLowerCase()}, but the Resolution text failed Lanewise's checks:`}
      </p>
      {checked.failed.length > 0 && (
        <ul>
          {checked.failed.map((check) => (
            <li key={check.kind === "droppedLines" ? `${check.kind}-${check.side}` : check.kind}>
              {failedCheckWords(check)}
              {check.kind === "droppedLines" && (
                <ul>
                  {check.lines.map((line) => (
                    <li key={line}>
                      <code>{line}</code>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <p>Check it closely, and resolve the Conflict Hunk by hand if it's wrong.</p>
    </div>
  );
}
