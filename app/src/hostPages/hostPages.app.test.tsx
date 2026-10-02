// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import type { OpenedRepository } from "../commands/api";
import { HOST_PAGES_KEY, RECENT_REPOSITORIES_KEY } from "../settings/localSettings";
import { expectNoAxeViolations } from "../test/axe";
import { fakeHostPages, fakePlatform } from "../test/fakePlatform";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const web = { url: "https://github.com/adrianeyre/lanewise", host: "github.com", integration: "github" } as const;
const lanewise: OpenedRepository = { root: "/work/lanewise", name: "lanewise", web };

function renderApp(withHostPages = true) {
  localStorage.setItem(RECENT_REPOSITORIES_KEY, JSON.stringify([{ root: lanewise.root, name: lanewise.name }]));
  const pages = fakeHostPages();
  const fake = fakePlatform({
    commands: { openRepository: () => ({ ok: true, value: lanewise }) },
    hostPages: withHostPages ? pages.hostPages : null,
  });
  const view = render(<App platform={fake.platform} />);
  return { fake, pages, ...view };
}

test("Open repository opens its GitHub page in a Tab of its own, beside the others, named by its title", async () => {
  const user = userEvent.setup();
  const { fake, pages, container } = renderApp();
  await user.click(await screen.findByRole("button", { name: "Open repository lanewise on GitHub" }));

  const tab = await screen.findByRole("tab", { name: "github.com" });
  expect(tab).toHaveAttribute("aria-selected", "true");
  expect(fake.links).toEqual([]);
  await waitFor(() => expect(pages.calls[0]).toEqual({ call: "open", page: 1, detail: web.url }));
  const toolbar = screen.getByRole("toolbar", { name: "Page" });
  expect(within(toolbar).getByText(web.url)).toBeVisible();
  expect(within(toolbar).getByRole("status")).toHaveTextContent("Loading github.com…");

  // The page's own news: its title names the Tab, and where it has gone shows.
  act(() => pages.tell({ kind: "title", page: 1, title: "adrianeyre/lanewise: A Git client" }));
  act(() => pages.tell({ kind: "loading", page: 1, url: `${web.url}/pulls`, done: true }));
  expect(screen.getByRole("tab", { name: "adrianeyre/lanewise: A Git client" })).toBeVisible();
  expect(within(toolbar).getByText(`${web.url}/pulls`)).toBeVisible();
  await expectNoAxeViolations(container);

  await user.click(within(toolbar).getByRole("button", { name: "Back" }));
  await user.click(within(toolbar).getByRole("button", { name: "Reload" }));
  await user.click(within(toolbar).getByRole("button", { name: /^Go to the page/ }));
  expect(pages.calls.filter((call) => call.call === "go").map((call) => call.detail)).toEqual([
    "back",
    "reload",
    "focus",
  ]);
  // The page's F6 hands focus back to its toolbar, so the keyboard is never trapped in it.
  act(() => pages.tell({ kind: "focus", page: 1 }));
  expect(within(toolbar).getByRole("button", { name: "Back" })).toHaveFocus();

  await user.click(within(toolbar).getByRole("button", { name: "Open in browser" }));
  expect(fake.links).toEqual([`${web.url}/pulls`]);
});

test("a link the page opens in a new window opens in a new Tab, and a Host page goes with its Tab", async () => {
  const user = userEvent.setup();
  const { pages } = renderApp();
  await user.click(await screen.findByRole("button", { name: "Open repository lanewise on GitHub" }));
  await screen.findByRole("tab", { name: "github.com" });

  act(() => pages.tell({ kind: "newTab", page: 1, url: "https://github.com/adrianeyre/lanewise/pull/42" }));
  expect(screen.getAllByRole("tab").map((each) => each.textContent)).toEqual(["Welcome", "github.com", "github.com"]);
  // Hidden as another Tab is shown, rather than closed.
  await waitFor(() => expect(pages.calls).toContainEqual({ call: "show", page: 1, detail: false }));

  // Ctrl or Cmd+W in the page closes its Tab, and the Host page with it.
  act(() => pages.tell({ kind: "close", page: 2 }));
  await waitFor(() => expect(pages.calls).toContainEqual({ call: "close", page: 2 }));
  expect(screen.getAllByRole("tab")).toHaveLength(2);
});

test("a menu or dialog open over a Host page hides it, since it's drawn over everything", async () => {
  const user = userEvent.setup();
  const { pages } = renderApp();
  await user.click(await screen.findByRole("button", { name: "Open repository lanewise on GitHub" }));
  await screen.findByRole("tab", { name: "github.com" });
  await waitFor(() => expect(pages.calls[0]?.call).toBe("open"));

  await user.click(screen.getByRole("button", { name: "Menu" }));
  await waitFor(() => expect(pages.calls.at(-1)).toEqual({ call: "show", page: 1, detail: false }));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(pages.calls.at(-1)).toEqual({ call: "show", page: 1, detail: true }));
});

test("with Host pages turned off in Settings, or where the shell can't show them, a Host's page opens in the browser", async () => {
  const user = userEvent.setup();
  localStorage.setItem(HOST_PAGES_KEY, "off");
  const off = renderApp();
  await user.click(await screen.findByRole("button", { name: "Open repository lanewise on GitHub" }));
  expect(off.fake.links).toEqual([web.url]);
  expect(off.pages.calls).toEqual([]);
  cleanup();

  const webMode = renderApp(false);
  await user.click(await screen.findByRole("button", { name: "Open repository lanewise on GitHub" }));
  expect(webMode.fake.links).toEqual([web.url]);
  expect(screen.getAllByRole("tab")).toHaveLength(1);
});

test("a Pull Request, from the Pull requests Widget or its mark in the Commit graph, opens in a Tab of its own", async () => {
  const user = userEvent.setup();
  localStorage.setItem(RECENT_REPOSITORIES_KEY, JSON.stringify([{ root: lanewise.root, name: lanewise.name }]));
  const pages = fakeHostPages();
  const pull = {
    number: 42,
    title: "Mark Pull Requests in the Commit graph",
    url: "https://github.com/adrianeyre/lanewise/pull/42",
    author: "octocat",
    draft: false,
    head: { branch: "feature/pulls", commit: "a".repeat(40), repository: "adrianeyre/lanewise" },
    base: "main",
    updatedAt: null,
  };
  const fake = fakePlatform({
    commands: {
      openRepository: () => ({ ok: true, value: lanewise }),
      pullRequests: () => ({ ok: true, value: { host: "github.com", integration: "github", pullRequests: [pull] } }),
    },
    hostPages: pages.hostPages,
  });
  render(<App platform={fake.platform} />);
  await user.click(await screen.findByRole("button", { name: /^lanewise/ }));
  const list = await screen.findByRole("list", { name: "Open Pull Requests on github.com" });
  await user.click(within(list).getByRole("button", { name: /^#42 Mark Pull Requests/ }));

  expect(await screen.findByRole("tab", { name: "github.com" })).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(pages.calls).toContainEqual({ call: "open", page: 1, detail: pull.url }));
  expect(fake.links).toEqual([]);
  // The repository's Tab stays, beside it.
  expect(screen.getByRole("tab", { name: "lanewise" })).toBeVisible();
});

test("Settings turns Host pages in Tabs off, for the browser, only where the shell can show them", async () => {
  const user = userEvent.setup();
  const { fake, pages } = renderApp();
  await screen.findByRole("button", { name: "Open repository lanewise on GitHub" });
  await user.keyboard("{Control>},{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  const choice = within(dialog).getByRole("checkbox", {
    name: "Open GitHub, GitLab, Bitbucket and Azure DevOps pages in Tabs here",
  });
  expect(choice).toBeChecked();
  await user.click(choice);
  expect(localStorage.getItem(HOST_PAGES_KEY)).toBe("off");
  await expectNoAxeViolations(dialog);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Open repository lanewise on GitHub" }));
  expect(fake.links).toEqual([web.url]);
  expect(pages.calls).toEqual([]);
  cleanup();

  renderApp(false);
  await screen.findByRole("button", { name: "Open repository lanewise on GitHub" });
  await user.keyboard("{Control>},{/Control}");
  const webMode = await screen.findByRole("dialog", { name: "Settings" });
  expect(within(webMode).queryByRole("checkbox", { name: /Tabs here$/ })).toBeNull();
});
