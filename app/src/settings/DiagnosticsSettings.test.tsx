// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";

import { App } from "../App";
import type { Diagnostics } from "../commands/api";
import { bugReportUrl, diagnosticsText } from "../diagnostics/diagnostics";
import { expectNoAxeViolations } from "../test/axe";
import { fakePlatform } from "../test/fakePlatform";
import { DiagnosticsSettings } from "./DiagnosticsSettings";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const diagnostics: Diagnostics = {
  operatingSystem: "Windows 11 (x86_64)",
  git: { kind: "supported", version: "2.56.0.windows.1" },
  credentialManager: { version: "2.7.0", configured: true },
  logFolder: "C:\\Users\\ada\\AppData\\Local\\com.adrianeyre.lanewise\\logs",
  recentLogLines: ["2026-09-29T14:00:00Z INFO  lanewise_desktop: Lanewise 0.1.0 started on windows (x86_64)"],
};

test("Copy diagnostics, in Settings, copies them and opens a bug report with them filled in", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({ commands: { diagnostics: () => ({ ok: true, value: diagnostics }) } });
  const { container } = render(<App platform={fake.platform} />);

  await user.click(screen.getByRole("button", { name: "Settings" }));
  const settings = screen.getByRole("dialog", { name: "Settings" });
  const section = within(settings).getByRole("region", { name: "Diagnostics" });
  const copy = within(section).getByRole("button", { name: "Copy diagnostics" });
  expect(copy).toHaveAccessibleDescription(/Lanewise sends nothing about how you use it/);
  await expectNoAxeViolations(container);

  await user.click(copy);

  const version = import.meta.env.VITE_APP_VERSION;
  expect(fake.copied).toEqual([diagnosticsText(version, diagnostics)]);
  expect(fake.links).toEqual([bugReportUrl(version, diagnostics)]);
  expect(fake.calls.filter(({ name }) => name === "diagnostics")).toEqual([{ name: "diagnostics", request: {} }]);
  expect(within(section).getByRole("status")).toHaveTextContent(
    "Copied the diagnostics, and filled them in on a bug report on GitHub. All of Lanewise's logs are in C:\\Users\\ada\\AppData\\Local\\com.adrianeyre.lanewise\\logs.",
  );
  await expectNoAxeViolations(container);
});

test("Copy diagnostics works from the keyboard, and opens the bug report even when the clipboard refuses", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({ commands: { diagnostics: () => ({ ok: true, value: { ...diagnostics, logFolder: null } }) } });
  fake.platform.copyText = () => Promise.reject(new Error("The clipboard is busy."));
  render(<DiagnosticsSettings platform={fake.platform} version="0.1.0" />);

  await user.tab();
  expect(screen.getByRole("button", { name: "Copy diagnostics" })).toHaveFocus();
  await user.keyboard("{Enter}");

  expect(fake.links).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Filled the diagnostics in on a bug report on GitHub. Lanewise couldn't copy them too.",
  );
});

test("diagnostics the core couldn't read are a problem, and nothing is copied or opened", async () => {
  const user = userEvent.setup();
  const fake = fakePlatform({});
  const { container } = render(<DiagnosticsSettings platform={fake.platform} version="0.1.0" />);

  await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong in Lanewise.");
  expect(fake.copied).toEqual([]);
  expect(fake.links).toEqual([]);
  expect(screen.getByRole("status")).toHaveTextContent("");
  await expectNoAxeViolations(container);
});
