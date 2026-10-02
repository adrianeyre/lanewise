// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "../App";
import { STORED_ITEMS } from "../legal/stored";
import { expectNoAxeViolations } from "../test/axe";
import { checksGitSetup, fakePlatform, gitSetup } from "../test/fakePlatform";
import { fakeOsTheme } from "../test/osTheme";
import { BASE_FOLDER_KEY, ENTERPRISE_HOSTS_KEY, FETCH_ON_SHOW_KEY, THEME_KEY } from "./localSettings";

const root = document.documentElement;

beforeEach(() => {
  root.removeAttribute("data-theme");
  root.removeAttribute("style");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function themeChoice() {
  return within(screen.getByRole("dialog", { name: "Settings" })).getByRole("group", { name: "Theme" });
}

test("Settings opens from the title bar, and offers System, Light and Dark, with System chosen at first", async () => {
  const user = userEvent.setup();
  const { container } = render(<App platform={fakePlatform({}).platform} />);

  const header = screen.getByRole("banner");
  await user.click(within(header).getByRole("button", { name: "Settings" }));

  const choices = within(themeChoice()).getAllByRole("radio");
  expect(choices.map((choice) => choice.getAttribute("value"))).toEqual(["system", "light", "dark"]);
  expect(within(themeChoice()).getByRole("radio", { name: "System" })).toBeChecked();
  expect(within(themeChoice()).getByRole("radio", { name: "System" })).toHaveAccessibleDescription(
    "Light or dark, as your operating system is set",
  );
  await expectNoAxeViolations(container);
});

test("choosing a Theme shows it at once, draws the window in it, and keeps it", async () => {
  fakeOsTheme(false);
  const user = userEvent.setup();
  const fake = fakePlatform({});
  render(<App platform={fake.platform} />);
  expect(root.dataset.theme).toBe("light");

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(within(themeChoice()).getByRole("radio", { name: "Dark" }));

  expect(root.dataset.theme).toBe("dark");
  expect(root.style.colorScheme).toBe("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  expect(fake.themes).toEqual([null, "dark"]);
  expect(STORED_ITEMS.map((item) => item.name)).toContain(THEME_KEY);

  await user.click(within(themeChoice()).getByRole("radio", { name: "System" }));
  expect(root.dataset.theme).toBe("light");
  expect(fake.themes.at(-1)).toBeNull();
});

test("the Theme is chosen from the keyboard, and Escape hands focus back to Settings", async () => {
  fakeOsTheme(true);
  const user = userEvent.setup();
  render(<App platform={fakePlatform({}).platform} />);
  const settings = screen.getByRole("button", { name: "Settings" });

  settings.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: "Close settings" })).toHaveFocus();
  await user.tab();
  expect(within(themeChoice()).getByRole("radio", { name: "System" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");

  expect(within(themeChoice()).getByRole("radio", { name: "Light" })).toBeChecked();
  expect(root.dataset.theme).toBe("light");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  expect(settings).toHaveFocus();
});

test("the saved Theme is shown on launch", () => {
  fakeOsTheme(false);
  localStorage.setItem(THEME_KEY, "dark");
  const fake = fakePlatform({});
  render(<App platform={fake.platform} />);

  expect(root.dataset.theme).toBe("dark");
  expect(fake.themes).toEqual(["dark"]);
});

test("Settings can be opened on the Git Setup screen too", async () => {
  const incomplete = gitSetup({ git: { kind: "missing" } });
  render(<App platform={fakePlatform({ commands: { checkGitSetup: checksGitSetup(incomplete) } }).platform} />);

  await screen.findByRole("heading", { name: /Git/, level: 2 });
  expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open repository" })).not.toBeInTheDocument();
});

test("a window that can't be drawn in the Theme says so", async () => {
  const fake = fakePlatform({});
  fake.platform.showTheme = () => Promise.reject(new Error("The window has gone."));
  render(<App platform={fake.platform} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("The window has gone.");
});

function enterpriseServers() {
  return within(screen.getByRole("dialog", { name: "Settings" })).getByRole("region", {
    name: "GitHub Enterprise Server",
  });
}

test("a GitHub Enterprise Server is added by its address from the keyboard, kept, and removed", async () => {
  const user = userEvent.setup();
  const { container } = render(<App platform={fakePlatform({}).platform} />);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const address = within(enterpriseServers()).getByRole("textbox", { name: "Address" });
  expect(address).toHaveAccessibleDescription(/such as https:\/\/github\.example\.com.*GitHub\.com is always there/);

  await user.click(address);
  await user.keyboard("https://GitHub.Example.com/octo-org{Enter}");

  const servers = within(enterpriseServers()).getByRole("list", { name: "GitHub Enterprise Servers" });
  expect(within(servers).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["github.example.comRemove"]);
  expect(address).toHaveValue("");
  expect(screen.getByText("Added github.example.com.")).toHaveAttribute("role", "status");
  expect(JSON.parse(localStorage.getItem(ENTERPRISE_HOSTS_KEY) ?? "null")).toEqual(["github.example.com"]);
  expect(STORED_ITEMS.map((item) => item.name)).toContain(ENTERPRISE_HOSTS_KEY);
  await expectNoAxeViolations(container);

  await user.keyboard("ghe.example.com:8443{Enter}");
  expect(JSON.parse(localStorage.getItem(ENTERPRISE_HOSTS_KEY) ?? "null")).toEqual([
    "github.example.com",
    "ghe.example.com:8443",
  ]);

  await user.click(within(servers).getByRole("button", { name: "Remove github.example.com" }));
  expect(within(servers).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "ghe.example.com:8443Remove",
  ]);
  expect(address).toHaveFocus();
  expect(JSON.parse(localStorage.getItem(ENTERPRISE_HOSTS_KEY) ?? "null")).toEqual(["ghe.example.com:8443"]);
});

test("an address that isn't a GitHub Enterprise Server's is refused, saying why", async () => {
  const user = userEvent.setup();
  const { container } = render(<App platform={fakePlatform({}).platform} />);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const address = within(enterpriseServers()).getByRole("textbox", { name: "Address" });

  await user.type(address, "http://github.example.com");
  await user.click(within(enterpriseServers()).getByRole("button", { name: "Add" }));

  const alert = within(enterpriseServers()).getByRole("alert");
  expect(alert).toHaveTextContent("Lanewise signs in to a GitHub Enterprise Server over HTTPS only.");
  expect(address).toHaveAttribute("aria-invalid", "true");
  expect(address).toHaveFocus();
  expect(address).toHaveAccessibleDescription(/over HTTPS only/);
  expect(localStorage.getItem(ENTERPRISE_HOSTS_KEY)).toBeNull();
  await expectNoAxeViolations(container);

  await user.type(address, "s");
  expect(within(enterpriseServers()).queryByRole("alert")).not.toBeInTheDocument();
});

test("the GitHub Enterprise Servers kept are listed on launch", async () => {
  localStorage.setItem(ENTERPRISE_HOSTS_KEY, JSON.stringify(["github.example.com"]));
  const user = userEvent.setup();
  render(<App platform={fakePlatform({}).platform} />);
  await user.click(screen.getByRole("button", { name: "Settings" }));

  expect(within(enterpriseServers()).getByRole("button", { name: "Remove github.example.com" })).toBeInTheDocument();
});

test("a base folder, typed or chosen, is where opening a repository starts, and fetching as a Tab is shown can be turned off", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({ folders: ["C:\\projects", null] });
  const { container } = render(<App platform={fake.platform} />);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const settings = screen.getByRole("dialog", { name: "Settings" });
  const section = within(settings).getByRole("region", { name: "Repositories" });
  const folder = within(section).getByRole("textbox", { name: "Base folder" });
  expect(folder).toHaveValue("");
  expect(folder).toHaveAccessibleDescription(/The folder you keep your repositories in/);
  await expectNoAxeViolations(container);

  await user.click(within(section).getByRole("button", { name: "Choose…" }));
  expect(fake.dialogs).toEqual(["Choose the base folder"]);
  expect(folder).toHaveValue("C:\\projects");
  expect(localStorage.getItem(BASE_FOLDER_KEY)).toBe("C:\\projects");
  expect(within(section).getByRole("status")).toHaveTextContent("The base folder is C:\\projects.");

  await user.clear(folder);
  await user.type(folder, "/home/me/projects{Enter}");
  expect(localStorage.getItem(BASE_FOLDER_KEY)).toBe("/home/me/projects");

  const fetching = within(section).getByRole("checkbox", {
    name: "Fetch when you switch to a repository's tab or come back to Lanewise",
  });
  expect(fetching).toBeChecked();
  await user.click(fetching);
  expect(localStorage.getItem(FETCH_ON_SHOW_KEY)).toBe("off");

  await user.keyboard("{Escape}");
  await user.click(await screen.findByRole("button", { name: "Open repository" }));
  expect(fake.dialogs).toEqual(["Choose the base folder", "Open repository"]);
  expect(fake.startedIn).toEqual([null, "/home/me/projects"]);
});
