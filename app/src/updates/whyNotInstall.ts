import type { CommandClient, InProgressOperation, OpenedRepository } from "../commands/api";
import { operationName } from "../repository/remoteWords";

const IN_PROGRESS: Record<InProgressOperation["kind"], string> = {
  merge: "A merge",
  rebase: "A rebase",
  stashApply: "A stash apply",
  cherryPick: "A cherry-pick",
  revert: "A revert",
};

const RESTARTS = "installing the Update restarts Lanewise.";

/**
 * Why the Update mustn't be installed now, or null if it may: installing
 * restarts Lanewise, so it waits for a clone, fetch, pull or push running,
 * and for an In-Progress Operation in any open repository, to be done with.
 * What can't be asked about is a reason too, since it can't be known to be
 * safe.
 */
export async function whyNotInstall(
  commands: CommandClient,
  repositories: readonly OpenedRepository[],
  cloning: boolean,
): Promise<string | null> {
  if (cloning) return `A clone is running. Let it finish, or cancel it, first: ${RESTARTS}`;
  for (const { root, name } of repositories) {
    try {
      const remote = await commands.call("remoteOperation", { repository: root });
      if (remote.ok && remote.value !== null) {
        return `A ${operationName[remote.value.kind]} is running in ${name}. Let it finish first: ${RESTARTS}`;
      }
      const operation = await commands.call("operationInProgress", { repository: root });
      if (operation.ok && operation.value !== null) {
        return `${IN_PROGRESS[operation.value.kind]} is in progress in ${name}. Finish or abort it on its Conflicts page first: ${RESTARTS}`;
      }
    } catch {
      return `Lanewise couldn't tell whether anything is running in ${name}, so it hasn't installed the Update. Try again.`;
    }
  }
  return null;
}
