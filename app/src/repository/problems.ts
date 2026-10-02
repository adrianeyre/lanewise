import type { RepositoryError } from "../commands/api";
import { CoreUnavailableError } from "../platform/unavailable";

/** What to tell the user when a folder didn't open as a repository, or stopped being one. */
export function describeRepositoryError(error: RepositoryError): string {
  switch (error.kind) {
    case "notARepository":
      return `“${error.path}” isn't in a Git repository. Choose a repository's folder, or a folder inside one.`;
    case "notAFolder":
      return `“${error.path}” isn't a folder, or is no longer there.`;
    case "noWorkingTree":
      return `“${error.path}” is a bare repository, with no working tree to show. Choose a repository that has one.`;
    case "unreadable":
      return `Lanewise couldn't read the repository at “${error.path}”: ${error.message}`;
  }
}

/**
 * What to tell the user when a command couldn't run at all: most often a
 * `CommandRejectedError`, which is a bug in Lanewise rather than their doing.
 * Outside the Desktop App, where there's no core at all, it says only that.
 */
export function describeFailure(failure: unknown): string {
  if (failure instanceof CoreUnavailableError) return failure.message;
  const detail = failure instanceof Error ? failure.message : String(failure);
  return `Something went wrong in Lanewise. ${detail}`;
}
