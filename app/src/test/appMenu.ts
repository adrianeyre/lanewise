import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Chooses `path`, such as `["File", "Open repository…"]`, from the title bar's menu. */
export async function chooseFromMenu(user: UserEvent, path: readonly string[]): Promise<void> {
  await user.click(await screen.findByRole("button", { name: "Menu" }));
  for (const [index, name] of path.entries()) {
    const item = await screen.findByRole("menuitem", { name });
    await user.click(item);
    if (index < path.length - 1) await screen.findByRole("menu", { name });
  }
}

/** Opens a repository, as File, Open repository… does, whichever page is shown. */
export function openFromFileMenu(user: UserEvent): Promise<void> {
  return chooseFromMenu(user, ["File", "Open repository…"]);
}
