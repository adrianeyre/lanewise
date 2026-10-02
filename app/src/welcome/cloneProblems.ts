import type { CloneError } from "../commands/api";
import { describeFailure, describeRepositoryError } from "../repository/problems";
import { describeSignInFailure } from "../signIn/signInWords";

/** What didn't happen when a clone failed. */
export const NOT_CLONED = "Nothing was cloned";

/**
 * What to tell the user when a clone didn't start, or didn't make a
 * repository. Git's own words are part of it, as Git wrote them, unless
 * it's a Sign-in Failure, which is explained instead.
 */
export function describeCloneError(error: CloneError): string {
  switch (error.kind) {
    case "gitUnavailable":
      return "Nothing was cloned: Lanewise can't find a Git 2.40 or later to run. Install one, then try again.";
    case "noUrl":
      return "Enter the URL of the repository to clone.";
    case "invalidName":
      return `Nothing was cloned: “${error.name}” can't be a folder's name. Choose a name without / or \\.`;
    case "noParentFolder":
      return `Nothing was cloned: “${error.path}” isn't a folder. Choose a folder that's there to clone into.`;
    case "destinationExists":
      return `Nothing was cloned: “${error.path}” is already there, and isn't an empty folder. Choose another name, or another folder to clone into.`;
    case "signInFailed":
      return describeSignInFailure(NOT_CLONED, error.failure);
    case "gitFailed":
      return `The clone failed, and nothing was kept. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "." : `:\n${error.message}`}`;
    case "leftBehind":
      return `The clone stopped, and Lanewise couldn't remove all it had made at “${error.path}”: ${error.message}. Remove that folder before cloning into it again.`;
    case "cloneNotFound":
      return describeFailure("The core no longer knows the clone it started.");
    default:
      return `The repository was cloned, and didn't open. ${describeRepositoryError(error)}`;
  }
}
