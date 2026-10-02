import type { Platform } from "../platform/platform";
import { askJev, fitState, type JevAnswer } from "./jev";
import type { Suggestion, SuggestionRequest } from "./modelProvider";

/** Jev's verdict on a Suggestion: how likely it keeps what both sides meant, from 0 to 1. */
export interface JevVerdict {
  keepsBoth: number;
}

/** Below this, Jev's doubt makes a Suggestion's Confidence low. */
export const DOUBTFUL = 0.5;

const noulOf = (answer: JevAnswer | undefined) => (answer?.type === "noul" ? answer.noul : null);

/** Asks Jev whether `suggestion` keeps what both sides of its Conflict Hunk meant to do. */
export async function checkWithJev(
  platform: Pick<Platform, "commands" | "fetch">,
  request: SuggestionRequest,
  suggestion: Suggestion,
  signal?: AbortSignal,
): Promise<JevVerdict | null> {
  const answered = await askJev(
    platform,
    {
      file: request.path,
      base: request.base === null ? null : fitState(request.base.join("\n")),
      ours: fitState(request.ours.join("\n")),
      theirs: fitState(request.theirs.join("\n")),
      resolution: fitState(suggestion.resolution),
    },
    {
      keeps_both: {
        type: "noul",
        instructions:
          "Does `resolution` keep every change `ours` and `theirs` each made to `base`, as both sides meant, so the code works?",
        criteria: {
          true: "Both sides' changes are kept, and the code is sound",
          false: "A side's change is lost, or the result is broken",
        },
      },
    },
    signal,
  );
  const keepsBoth = noulOf(answered.answers.keeps_both);
  return keepsBoth === null ? null : { keepsBoth };
}

/** Which way a Conflict Hunk likely goes, as Jev picks it. */
export type Triage = "ours" | "theirs" | "oursThenTheirs" | "theirsThenOurs" | "person";

export const TRIAGE_WORDS: Record<Triage, string> = {
  ours: "Ours",
  theirs: "Theirs",
  oursThenTheirs: "Both, Ours first",
  theirsThenOurs: "Both, Theirs first",
  person: "It needs a person to write it",
};

/** Asks Jev which way `request`'s Conflict Hunk likely goes, and how sure it is. */
export async function triageWithJev(
  platform: Pick<Platform, "commands" | "fetch">,
  request: SuggestionRequest,
  signal?: AbortSignal,
): Promise<{ triage: Triage; probability: number } | null> {
  const answered = await askJev(
    platform,
    {
      file: request.path,
      before: fitState(request.before.join("\n")),
      base: request.base === null ? null : fitState(request.base.join("\n")),
      ours: fitState(request.ours.join("\n")),
      theirs: fitState(request.theirs.join("\n")),
      after: fitState(request.after.join("\n")),
    },
    {
      resolution: {
        type: "choice",
        instructions: "Which resolution of this merge conflict between `ours` and `theirs` is right?",
        criteria: {
          ours: "Keep `ours` alone: `theirs` adds nothing that's needed",
          theirs: "Keep `theirs` alone: `ours` adds nothing that's needed",
          oursThenTheirs: "Keep both, `ours` then `theirs`",
          theirsThenOurs: "Keep both, `theirs` then `ours`",
          person: "Neither side alone or both as they are: the lines need rewriting by hand",
        },
      },
    },
    signal,
  );
  const answer = answered.answers.resolution;
  if (answer?.type !== "choice" || !(answer.choice in TRIAGE_WORDS)) return null;
  return { triage: answer.choice as Triage, probability: answer.probabilities[answer.choice] ?? answer.confidence };
}

/** The Conventional Commit types Jev picks among. */
export const COMMIT_TYPES = ["feat", "fix", "docs", "refactor", "test", "chore", "perf", "style", "build", "ci"] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

/** What Jev found in staged changes before a commit: warnings, never a block. */
export interface CommitCheck {
  /** How likely they hold a secret, such as a key or a password. */
  secret: number;
  /** How likely they hold a leftover, such as debug output or a note to self. */
  leftover: number;
  /** The Conventional Commit type they likely are. */
  type: CommitType | null;
}

/** Above this, a secret or a leftover is flagged. */
export const LIKELY = 0.5;

/** Asks Jev about the staged changes, `diff`, and the Commit Message they're committed with. */
export async function checkCommitWithJev(
  platform: Pick<Platform, "commands" | "fetch">,
  diff: string,
  message: string,
  signal?: AbortSignal,
): Promise<CommitCheck> {
  const answered = await askJev(
    platform,
    { staged: fitState(diff), message },
    {
      secret: {
        type: "noul",
        instructions: "Do the lines `staged` adds hold a real secret, such as an API key, token, password or private key?",
      },
      leftover: {
        type: "noul",
        instructions:
          "Do the lines `staged` adds hold a leftover that shouldn't be committed, such as debug output, a console.log or dbg!, or a note to self?",
      },
      type: {
        type: "choice",
        instructions: "Which Conventional Commit type is this change?",
        criteria: Object.fromEntries(COMMIT_TYPES.map((type) => [type, null])),
      },
    },
    signal,
  );
  const type = answered.answers.type;
  return {
    secret: noulOf(answered.answers.secret) ?? 0,
    leftover: noulOf(answered.answers.leftover) ?? 0,
    type: type?.type === "choice" && (COMMIT_TYPES as readonly string[]).includes(type.choice) ? (type.choice as CommitType) : null,
  };
}
