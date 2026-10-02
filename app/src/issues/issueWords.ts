import type { IssueTracker, IssueTrackerError } from "../commands/api";

/** Each Issue Tracker's name, as the UI says it. */
export const TRACKER_NAMES: Record<IssueTracker, string> = { jira: "Jira Cloud", trello: "Trello" };

/** Every Issue Tracker, in the order Settings and the Issues Widget list them. */
export const TRACKERS: readonly IssueTracker[] = ["jira", "trello"];

/** Where the user creates a Jira API token. */
export const JIRA_TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";

/** Where the user gets a Trello API key, from a Power-Up of their own, and its token. */
export const TRELLO_KEY_PAGE = "https://trello.com/power-ups/admin";

/** What to tell the user when an Issue Tracker couldn't be signed in to or read. It never says a token. */
export function describeIssueTrackerError(error: IssueTrackerError, tracker: IssueTracker): string {
  const name = TRACKER_NAMES[tracker];
  switch (error.kind) {
    case "notSignedIn":
      return `No ${name} account is saved. Add one in Settings.`;
    case "invalidSite":
      return "That isn't a Jira Cloud site. Enter its address, such as your-team.atlassian.net.";
    case "missingField":
      switch (error.field) {
        case "email":
          return "Enter the email you sign in to Jira with.";
        case "key":
          return "Enter your Trello API key.";
        case "token":
          return tracker === "jira" ? "Enter your Jira API token." : "Enter your Trello token.";
      }
      break;
    case "tokenRefused":
      return tracker === "jira"
        ? "Jira refused the email and API token. Check both, or create a new API token."
        : "Trello refused the API key and token. Check both, or make a new token.";
    case "rateLimited":
      return `${name} is limiting requests. Wait a minute, then try again.`;
    case "unreachable":
      return `Lanewise couldn't reach ${name}. Check your connection, then try again. (${error.message})`;
    case "trackerFailed":
      return error.message === ""
        ? `${name} answered with an error (${error.status}). Try again later.`
        : `${name} answered with an error (${error.status}): ${error.message}`;
    case "store":
      return `Lanewise couldn't use your system's credential store: ${error.message}`;
    case "invalidCursor":
      return "The list changed. Search again from the top.";
  }
  return `${name} couldn't be read.`;
}
