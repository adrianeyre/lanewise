// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import type { CheckedGitSetup, Outcome } from "../commands/api";
import type { Platform } from "../platform/platform";
import { expectNoAxeViolations } from "../test/axe";
import { checksGitSetup, fakePlatform, gitSetup } from "../test/fakePlatform";

afterEach(cleanup);

const noGit = {
  git: { kind: "missing" },
  credentialManager: { kind: "unchecked" },
} satisfies Partial<CheckedGitSetup>;

const appleGit = {
  git: { kind: "tooOld", path: "/usr/bin/git", version: "2.39.5" },
  credentialManager: { kind: "notConfigured", helpers: ["osxkeychain"] },
} satisfies Partial<CheckedGitSetup>;

const noCredentialManager = {
  credentialManager: { kind: "notConfigured", helpers: [] },
} satisfies Partial<CheckedGitSetup>;

function screenFor(...setups: CheckedGitSetup[]) {
  const fake = fakePlatform({ commands: { checkGitSetup: checksGitSetup(...setups) } });
  const drawn = render(<App platform={fake.platform} />);
  return { ...fake, ...drawn };
}

async function setupScreen() {
  return screen.findByRole("region", { name: "Set up Git for Lanewise" });
}

function findings(): string[] {
  const list = screen.getByRole("list", { name: "What Lanewise found" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

test("while the Git Setup is being checked, the app says so and offers nothing yet", async () => {
  const pending: { answer?: (outcome: Outcome<"checkGitSetup">) => void } = {};
  const fake = fakePlatform({
    commands: {
      checkGitSetup: () =>
        new Promise((resolve) => {
          pending.answer = resolve;
        }),
    },
  });
  render(<App platform={fake.platform} />);

  expect(screen.getByRole("status")).toHaveTextContent("Checking the Git Setup…");
  expect(screen.queryByRole("button", { name: "Open repository" })).toBeNull();

  pending.answer?.({ ok: true, value: gitSetup() });

  expect(await screen.findByRole("button", { name: "Open repository" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Set up Git for Lanewise" })).toBeNull();
  expect(fake.calls).toEqual([{ name: "checkGitSetup", request: {} }]);
});

test("on Windows with no Git, the screen says to install Git for Windows, which includes GCM", async () => {
  const user = userEvent.setup();
  const fake = screenFor(gitSetup({ ...noGit, operatingSystem: "windows" }));

  const setup = await setupScreen();

  expect(screen.queryByRole("button", { name: "Open repository" })).toBeNull();
  expect(setup).toHaveTextContent(
    "It needs Git 2.40.0 or later and Git Credential Manager.",
  );
  expect(findings()).toEqual([
    "Git isn't installed, or isn't where Lanewise looks for it.",
    "Git Credential Manager can be checked once Git is set up.",
  ]);
  const guidance = within(setup).getByRole("region", { name: "What to do on Windows" });
  expect(guidance).toHaveTextContent(
    "Install Git for Windows, which includes Git Credential Manager and sets it up as Git's credential helper.",
  );
  expect(
    within(guidance).getByText("winget install --id Git.Git -e --source winget"),
  ).toBeVisible();
  expect(guidance).toHaveTextContent("Then choose Check again.");
  await expectNoAxeViolations(fake.container);

  // Links open in the browser, from the keyboard too.
  within(guidance)
    .getByRole("link", { name: "Download Git for Windows (opens in your browser)" })
    .focus();
  await user.keyboard("{Enter}");

  expect(fake.links).toEqual(["https://git-scm.com/install/windows"]);
});

test("on Windows with Git but not GCM, the screen says how to make GCM the credential helper", async () => {
  screenFor(gitSetup({ ...noCredentialManager, operatingSystem: "windows" }));

  const setup = await setupScreen();

  expect(setup).toHaveTextContent("It needs Git Credential Manager.");
  expect(findings()).toEqual([
    "Git 2.56.0 is installed./opt/homebrew/bin/git",
    "Git Credential Manager isn't Git's credential helper. Git has none.",
  ]);
  const guidance = within(setup).getByRole("region", { name: "What to do on Windows" });
  expect(guidance).toHaveTextContent("Git for Windows includes Git Credential Manager.");
  expect(
    within(guidance).getByText("git config --global credential.helper manager"),
  ).toBeVisible();
});

test("on macOS with Apple's old Git, the screen says to install Git and GCM separately, with Homebrew", async () => {
  const user = userEvent.setup();
  const fake = screenFor(gitSetup({ ...appleGit, operatingSystem: "macos" }));

  const setup = await setupScreen();

  expect(findings()).toEqual([
    "Git 2.39.5 is too old. Lanewise needs Git 2.40.0 or later./usr/bin/git",
    "Git Credential Manager isn't Git's credential helper. Git uses “osxkeychain” instead.",
  ]);
  const guidance = within(setup).getByRole("region", { name: "What to do on macOS" });
  expect(guidance).toHaveTextContent(
    "On macOS, Git and Git Credential Manager are installed separately.",
  );
  expect(guidance).toHaveTextContent(
    "Apple's Command Line Tools can be older than Lanewise needs",
  );
  expect(within(guidance).getByText("brew install git")).toBeVisible();
  expect(
    within(guidance).getByText("brew install --cask git-credential-manager"),
  ).toBeVisible();
  expect(within(guidance).getByText("git-credential-manager configure")).toBeVisible();
  await expectNoAxeViolations(fake.container);

  await user.click(within(guidance).getByRole("link", { name: /^Homebrew/ }));

  expect(fake.links).toEqual(["https://brew.sh/"]);
});

test("on Linux, the screen points to GCM's install instructions and its configure step", async () => {
  const fake = screenFor(
    gitSetup({
      credentialManager: { kind: "notConfigured", helpers: ["cache", "store"] },
      operatingSystem: "linux",
    }),
  );

  const setup = await setupScreen();

  expect(findings()[1]).toBe(
    "Git Credential Manager isn't Git's credential helper. Git uses “cache” and “store” instead.",
  );
  const guidance = within(setup).getByRole("region", { name: "What to do on Linux" });
  expect(
    within(guidance).getByRole("link", {
      name: "its install instructions (opens in your browser)",
    }),
  ).toHaveAttribute(
    "href",
    "https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/install.md",
  );
  expect(within(guidance).getByText("git-credential-manager configure")).toBeVisible();
  await expectNoAxeViolations(fake.container);
});

test("a Git that doesn't run says why, with Git's own message", async () => {
  screenFor(
    gitSetup({
      git: {
        kind: "unusable",
        path: "/usr/bin/git",
        message:
          "`git --version` failed: xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)",
      },
      credentialManager: { kind: "unchecked" },
    }),
  );

  await setupScreen();

  expect(findings()[0]).toBe(
    "Lanewise found Git, but it didn't run./usr/bin/git`git --version` failed: xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)",
  );
});

test("Check again, from the keyboard, runs the check again until the Git Setup is complete", async () => {
  const user = userEvent.setup();
  const fake = screenFor(gitSetup(appleGit), gitSetup(noCredentialManager), gitSetup());
  await setupScreen();
  const checkAgain = screen.getByRole("button", { name: "Check again" });

  checkAgain.focus();
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Checked again. Lanewise still needs Git Credential Manager.",
  );
  expect(findings()[0]).toBe("Git 2.56.0 is installed./opt/homebrew/bin/git");
  expect(checkAgain).toHaveFocus();
  await expectNoAxeViolations(fake.container);

  await user.keyboard("{Enter}");

  const open = await screen.findByRole("button", { name: "Open repository" });
  expect(open).toHaveFocus();
  expect(screen.queryByRole("region", { name: "Set up Git for Lanewise" })).toBeNull();
  expect(screen.getByText("Open a repository to see its changes.")).toBeVisible();
  expect(fake.calls.map((call) => call.name)).toEqual([
    "checkGitSetup",
    "checkGitSetup",
    "checkGitSetup",
  ]);
});

test("while Check again runs, it says so, and pressing it again sends nothing more", async () => {
  const user = userEvent.setup();
  const pending: { answer?: (outcome: Outcome<"checkGitSetup">) => void } = {};
  let checks = 0;
  const fake = fakePlatform({
    commands: {
      checkGitSetup: () => {
        checks++;
        if (checks === 1) return { ok: true, value: gitSetup(noGit) };
        return new Promise((resolve) => {
          pending.answer = resolve;
        });
      },
    },
  });
  render(<App platform={fake.platform} />);
  await setupScreen();
  const checkAgain = screen.getByRole("button", { name: "Check again" });

  await user.click(checkAgain);
  expect(screen.getByRole("status")).toHaveTextContent("Checking again…");
  expect(checkAgain).toHaveAttribute("aria-disabled", "true");
  await user.click(checkAgain);
  expect(checks).toBe(2);

  pending.answer?.({ ok: true, value: gitSetup(noGit) });

  expect(
    await screen.findByText(
      "Checked again. Lanewise still needs Git 2.40.0 or later and Git Credential Manager.",
    ),
  ).toBeVisible();
  expect(checkAgain).toHaveAttribute("aria-disabled", "false");
});

test("Continue for now carries on without GCM, and says what won't work", async () => {
  const user = userEvent.setup();
  screenFor(gitSetup(noCredentialManager));
  const setup = await setupScreen();

  expect(setup).toHaveTextContent(
    "Without Git Credential Manager, Lanewise still works with the repositories on this computer, SSH remotes and other credential helpers, but can't sign in to Hosts for you.",
  );
  await user.click(screen.getByRole("button", { name: "Continue for now" }));

  expect(screen.getByRole("button", { name: "Open repository" })).toHaveFocus();
  expect(screen.queryByRole("region", { name: "Set up Git for Lanewise" })).toBeNull();
});

test("Continue for now carries on without Git too, saying only reading works", async () => {
  const user = userEvent.setup();
  screenFor(gitSetup(noGit));
  const setup = await setupScreen();

  expect(setup).toHaveTextContent(
    "Until Git is set up, Lanewise can open repositories and show their changes, but nothing that runs Git, such as committing or fetching, will work.",
  );
  await user.click(screen.getByRole("button", { name: "Continue for now" }));

  expect(screen.getByRole("button", { name: "Open repository" })).toHaveFocus();
});

test("a link that won't open says why", async () => {
  const user = userEvent.setup();
  const { platform } = fakePlatform({
    commands: { checkGitSetup: checksGitSetup(gitSetup(noGit)) },
  });
  const failing: Platform = {
    ...platform,
    openLink: () => Promise.reject(new Error("No browser is set up.")),
  };
  render(<App platform={failing} />);
  await setupScreen();

  await user.click(screen.getByRole("link", { name: /^Homebrew/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Something went wrong in Lanewise. No browser is set up.",
  );
});

test("a check the core rejects says so, and the app carries on", async () => {
  const fake = fakePlatform({
    commands: {
      checkGitSetup: () => {
        throw new Error("checkGitSetup stopped.");
      },
    },
  });
  render(<App platform={fake.platform} />);

  expect(await screen.findByRole("button", { name: "Open repository" })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Something went wrong in Lanewise. checkGitSetup stopped.",
  );
});
