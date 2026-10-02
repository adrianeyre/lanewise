// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import type { GitProgress, Outcome } from "../commands/api";
import { RECENT_REPOSITORIES_KEY } from "../settings/localSettings";
import { AUTHORIZE_TOKEN_URL } from "../signIn/signInWords";
import { expectNoAxeViolations } from "../test/axe";
import { type FakeCommands, fakeClones, fakePlatform, pagedStatus } from "../test/fakePlatform";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const url = "https://github.com/adrianeyre/lanewise.git";
const lanewise = { root: "/work/lanewise", name: "lanewise" };
const soundcheck = { root: "/work/soundcheck", name: "soundcheck" };

function platformFor(folders: (string | null)[] = [], commands: FakeCommands = {}) {
  const clones = fakeClones();
  const fake = fakePlatform({
    folders,
    commands: {
      openRepository: (): Outcome<"openRepository"> => ({ ok: true, value: soundcheck }),
      fileStatus: pagedStatus([]),
      ...clones.commands,
      ...commands,
    },
  });
  return { ...fake, clones };
}

function receiving(done: number, total = 1000): GitProgress {
  const percent = Math.floor((done / total) * 100);
  return { phase: "Receiving objects", remote: false, done, total, percent, finished: done === total };
}

function cloneSection() {
  return screen.findByRole("region", { name: "Clone a repository" });
}

/** Fills the Clone form in, choosing `/work` to clone into, and sends it from the keyboard. */
async function cloneFromKeyboard(user: ReturnType<typeof userEvent.setup>) {
  const section = await cloneSection();
  await user.type(within(section).getByRole("textbox", { name: "Repository URL" }), url);
  await user.click(within(section).getByRole("button", { name: "Choose a folder…" }));
  await user.click(within(section).getByRole("textbox", { name: "Folder name" }));
  await user.keyboard("{Enter}");
  return section;
}

test("the Welcome screen offers to clone from a URL into a folder, named after the URL until it's changed", async () => {
  const user = userEvent.setup();
  const fake = platformFor(["/work"]);
  const { container } = render(<App platform={fake.platform} />);

  const section = await cloneSection();
  const address = within(section).getByRole("textbox", { name: "Repository URL" });
  const into = within(section).getByRole("textbox", { name: "Clone into" });
  const name = within(section).getByRole("textbox", { name: "Folder name" });
  expect(address).toHaveAccessibleDescription(
    "HTTPS or SSH, such as https://github.com/adrianeyre/lanewise.git or git@github.com:adrianeyre/lanewise.git. " +
      "Git signs in with your credential helper or SSH agent; Lanewise never asks for a password.",
  );
  expect(screen.queryByLabelText(/password/i)).toBeNull();
  await expectNoAxeViolations(container);

  await user.type(address, "git@github.com:adrianeyre/lanewise.git");
  expect(name).toHaveValue("lanewise");
  await user.click(within(section).getByRole("button", { name: "Choose a folder…" }));
  expect(fake.dialogs).toEqual(["Clone into"]);
  expect(into).toHaveValue("/work");

  await user.clear(name);
  await user.type(name, "mine");
  await user.type(address, "-fork");
  expect(name).toHaveValue("mine");
});

test("a Clone missing what it needs says so, on the field that needs it, and nothing starts", async () => {
  const user = userEvent.setup();
  const fake = platformFor();
  const { container } = render(<App platform={fake.platform} />);
  const section = await cloneSection();

  await user.click(within(section).getByRole("button", { name: "Clone" }));

  const address = within(section).getByRole("textbox", { name: "Repository URL" });
  expect(within(section).getByRole("alert")).toHaveTextContent("Enter the URL of the repository to clone.");
  expect(address).toHaveFocus();
  expect(address).toHaveAttribute("aria-invalid", "true");
  await expectNoAxeViolations(container);

  await user.type(address, url);
  await user.keyboard("{Enter}");
  const into = within(section).getByRole("textbox", { name: "Clone into" });
  expect(within(section).getByRole("alert")).toHaveTextContent("Choose a folder to clone into.");
  expect(into).toHaveFocus();
  expect(address).not.toHaveAttribute("aria-invalid");
  expect(fake.calls.map((call) => call.name)).not.toContain("startClone");
});

test("a clone shows Git's progress as it goes, announces it politely, and opens the repository in a Tab", async () => {
  const user = userEvent.setup();
  const fake = platformFor(["/work"]);
  const { container } = render(<App platform={fake.platform} />);

  const section = await cloneFromKeyboard(user);

  const cancel = await within(section).findByRole("button", { name: "Cancel clone" });
  expect(cancel).toHaveFocus();
  expect(fake.calls).toContainEqual({ name: "startClone", request: { url, parent: "/work", name: "lanewise" } });
  const announcer = within(section).getByRole("status");
  expect(announcer).toHaveTextContent("Cloning…");
  expect(within(section).getByText("Starting the clone…")).toBeVisible();
  expect(await within(section).findByText("Into /work/lanewise")).toBeVisible();
  expect(within(section).getByRole("button", { name: "Clone" })).toHaveAttribute("aria-disabled", "true");

  act(() => fake.clones.report({ kind: "running", progress: receiving(450) }));
  const bar = await within(section).findByRole("progressbar", { name: "Receiving objects: 45% (450 of 1,000)" });
  expect(bar).toHaveAttribute("aria-valuenow", "45");
  expect(announcer).toHaveTextContent("Receiving objects: 25%");
  await expectNoAxeViolations(container);

  // Not every update is announced: only each quarter, and each new phase.
  act(() => fake.clones.report({ kind: "running", progress: receiving(480) }));
  await within(section).findByText("Receiving objects: 48% (480 of 1,000)");
  expect(announcer).toHaveTextContent("Receiving objects: 25%");
  act(() =>
    fake.clones.report({
      kind: "running",
      progress: { phase: "Resolving deltas", remote: false, done: 3, total: 10, percent: 30, finished: false },
    }),
  );
  await within(section).findByText("Resolving deltas: 30% (3 of 10)");
  expect(announcer).toHaveTextContent("Resolving deltas: 25%");

  act(() => fake.clones.report({ kind: "cloned", repository: lanewise }));

  expect(await screen.findByRole("heading", { level: 2, name: "lanewise" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "lanewise" })).toHaveAttribute("aria-selected", "true");
  expect(JSON.parse(localStorage.getItem(RECENT_REPOSITORIES_KEY)!)).toEqual([lanewise]);
});

test("Cancel stops the clone, says so once Git has, and gives focus back to the form", async () => {
  const user = userEvent.setup();
  const fake = platformFor(["/work"]);
  const { container } = render(<App platform={fake.platform} />);
  const section = await cloneFromKeyboard(user);
  const cancel = await within(section).findByRole("button", { name: "Cancel clone" });
  act(() => fake.clones.report({ kind: "running", progress: receiving(100) }));
  await within(section).findByText("Receiving objects: 10% (100 of 1,000)");

  await user.keyboard("{Enter}");

  expect(fake.clones.cancelled).toEqual([1]);
  expect(within(section).getByText("Cancelling the clone…", { selector: ".clone-phase" })).toBeVisible();
  expect(within(section).getByRole("status")).toHaveTextContent("Cancelling the clone…");
  expect(cancel).toHaveAttribute("aria-disabled", "true");
  // Still running until Git stops and the folder has gone.
  act(() => fake.clones.report({ kind: "running", progress: receiving(120) }));
  expect(within(section).getByRole("button", { name: "Cancel clone" })).toBeVisible();

  act(() => fake.clones.report({ kind: "cancelled" }));

  expect(await within(section).findByText("The clone was cancelled, and what it had made was removed.")).toBeVisible();
  expect(within(section).getByRole("status")).toHaveTextContent("Clone cancelled.");
  expect(within(section).queryByRole("button", { name: "Cancel clone" })).toBeNull();
  // Focus moves back once the clone has stopped, which can be a render after the message.
  await waitFor(() => expect(within(section).getByRole("textbox", { name: "Repository URL" })).toHaveFocus());
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Welcome"]);
  await expectNoAxeViolations(container);
});

test("a clone that fails says what Git said, and one that can't start says why", async () => {
  const user = userEvent.setup();
  const fake = platformFor(["/work", "/work"]);
  render(<App platform={fake.platform} />);
  const section = await cloneFromKeyboard(user);
  await within(section).findByRole("button", { name: "Cancel clone" });

  act(() =>
    fake.clones.report({
      kind: "failed",
      error: {
        kind: "gitFailed",
        code: 128,
        message: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      },
    }),
  );

  const alert = await within(section).findByRole("alert");
  expect(alert).toHaveTextContent(
    "The clone failed, and nothing was kept. Git stopped with exit code 128: fatal: could not read Username",
  );
  // Focus moves back once the clone has stopped, which can be a render after the message.
  await waitFor(() => expect(within(section).getByRole("textbox", { name: "Repository URL" })).toHaveFocus());

  cleanup();
  const refused = platformFor(["/work"], {
    startClone: ({ parent, name }) => ({
      ok: false,
      error: { kind: "destinationExists", path: `${parent}/${name}` },
    }),
  });
  render(<App platform={refused.platform} />);
  const again = await cloneFromKeyboard(user);
  expect(await within(again).findByRole("alert")).toHaveTextContent(
    "Nothing was cloned: “/work/lanewise” is already there, and isn't an empty folder.",
  );
  expect(within(again).getByRole("button", { name: "Clone" })).not.toHaveAttribute("aria-disabled");
});

test("a clone GitHub's SSO refuses explains how to authorize the token, and opens GitHub's instructions in the browser", async () => {
  const user = userEvent.setup();
  const fake = platformFor(["/work"]);
  const { container } = render(<App platform={fake.platform} />);
  const section = await cloneFromKeyboard(user);
  await within(section).findByRole("button", { name: "Cancel clone" });

  act(() =>
    fake.clones.report({
      kind: "failed",
      error: {
        kind: "signInFailed",
        failure: { kind: "ssoNotAuthorized", organization: "axa-ch", credential: { kind: "token" } },
        message:
          "remote: The 'axa-ch' organization has enabled or enforced SAML SSO.\nremote: To access this repository, you must use the HTTPS remote with a personal access token or SSH with an SSH key and passphrase that has been authorized for this organization.",
      },
    }),
  );

  const alert = await within(section).findByRole("alert");
  expect(alert).toHaveTextContent(
    "Nothing was cloned: Git couldn't sign in to GitHub. The axa-ch organization uses SAML single sign-on (SSO), and your personal access token hasn't been authorized for it, so GitHub refused it.",
  );
  expect(alert).toHaveTextContent("Next to the token, choose Configure SSO, then Authorize next to the axa-ch organization");
  expect(within(section).getByRole("button", { name: "Clone" })).toHaveAccessibleDescription(
    /Git couldn't sign in to GitHub/,
  );
  await expectNoAxeViolations(container);

  await user.click(within(alert).getByRole("link", { name: /Authorizing a personal access token for use with SSO/ }));
  expect(fake.links).toEqual([AUTHORIZE_TOKEN_URL]);
});

test("a clone carries on while another Tab is shown, and opens in a new Tab of its own", async () => {
  const user = userEvent.setup();
  const fake = platformFor(["/work", "/work/soundcheck"]);
  render(<App platform={fake.platform} />);
  const section = await cloneFromKeyboard(user);
  await within(section).findByRole("button", { name: "Cancel clone" });

  await user.click(screen.getByRole("button", { name: "Open repository" }));
  expect(await screen.findByRole("heading", { level: 2, name: "soundcheck" })).toBeVisible();

  act(() => fake.clones.report({ kind: "cloned", repository: lanewise }));

  expect(await screen.findByRole("tab", { name: "lanewise" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getAllByRole("tab").map((tab) => tab.querySelector(".tab-name")!.textContent)).toEqual([
    "soundcheck",
    "lanewise",
  ]);
});
