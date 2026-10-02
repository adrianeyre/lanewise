import type { RemoteConfigError } from "../commands/api";
import { describeRepositoryError } from "./problems";

/** What was being done to a remote or an Upstream when it failed, to say what didn't happen. */
export type RemoteConfigRun = "add" | "rename" | "setUrl" | "remove" | "setUpstream";

const didNot: Record<RemoteConfigRun, string> = {
  add: "The remote wasn't added",
  rename: "The remote wasn't renamed",
  setUrl: "The remote's URL wasn't changed",
  remove: "The remote wasn't removed",
  setUpstream: "The Upstream wasn't set",
};

/** What to tell the user when `run` failed. Git's own words are part of it, as Git wrote them. */
export function describeRemoteConfigError(error: RemoteConfigError, run: RemoteConfigRun): string {
  switch (error.kind) {
    case "invalidName":
      return error.name.trim() === ""
        ? `${didNot[run]}: a remote needs a name.`
        : `${didNot[run]}: Git doesn't allow “${error.name}” as a remote's name. Remote names can't have spaces, “..”, “~”, “^”, “:”, “?”, “*” or “[”, or start with “-”.`;
    case "emptyUrl":
      return `${didNot[run]}: a remote needs a URL, such as https://example.com/project.git.`;
    case "alreadyExists":
      return `${didNot[run]}: there's already a remote called “${error.name}”.`;
    case "remoteNotFound":
      return `${didNot[run]}: there's no remote called “${error.name}” any more.`;
    case "branchNotFound":
      return `${didNot[run]}: there's no branch called “${error.name}” any more.`;
    case "upstreamNotFound":
      return `${didNot[run]}: there's no remote-tracking branch called “${error.name}” any more. Fetch, then try again.`;
    case "gitUnavailable":
      return `${didNot[run]}: Lanewise can't find a Git 2.40 or later to run. Install one, then open the repository again.`;
    case "gitFailed":
      return `${didNot[run]}. ${error.code === null ? "Git was stopped" : `Git stopped with exit code ${error.code}`}${error.message === "" ? "" : `:\n${error.message}`}`;
    default:
      return describeRepositoryError(error);
  }
}
