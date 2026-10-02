// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";

import { parseAiSettings } from "../ai/aiSettings";
import { CATALOG_URL, catalogSource } from "../ai/modelCatalog";
import type { ModelProvider } from "../ai/modelProvider";
import { CLOUD_MODEL_PROVIDERS } from "../ai/modelProviders";
import { useAiSettings } from "../ai/useAiSettings";
import { App } from "../App";
import { expectNoAxeViolations } from "../test/axe";
import { FAKE_LOCAL_API, fakeModelProvider } from "../test/fakeModelProvider";
import { type FakePlatform, fakeKeyStore, fakePlatform } from "../test/fakePlatform";
import { MODEL_PROVIDER_KEY } from "./localSettings";
import { ModelProviderSettings } from "./ModelProviderSettings";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function setUp(keysKept: Record<string, string> = {}, providers?: ModelProvider[], { offline = false } = {}) {
  const fake = fakeModelProvider();
  const other = fakeModelProvider({ id: "other", name: "Other Model Provider", key: "sk-other" });
  const keys = fakeKeyStore(keysKept);
  const platform = fakePlatform({
    commands: keys.commands,
    fetch: (url, init) => {
      // Offline, but for a Model Provider on this computer.
      if (offline && url === CATALOG_URL) throw new TypeError("Failed to fetch");
      return url.includes("/other/") ? other.answer(url, init) : fake.answer(url, init);
    },
  });
  return { fake, other, keys, platform, providers: providers ?? [fake.provider, other.provider] };
}

async function openAi(platform: FakePlatform, providers: readonly ModelProvider[]) {
  const user = userEvent.setup();
  const view = render(<App platform={platform.platform} modelProviders={providers} />);
  await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Settings" }));
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  return { user, view, ai: within(within(dialog).getByRole("region", { name: "AI" })) };
}

function kept() {
  return parseAiSettings(localStorage.getItem(MODEL_PROVIDER_KEY));
}

test("AI is off at first, and nothing is sent to any Model Provider", async () => {
  const { platform, providers } = setUp({ fake: "sk-fake" });
  const { ai, view } = await openAi(platform, providers);

  const toggle = ai.getByRole("checkbox", { name: "Suggest Resolutions with AI" });
  expect(toggle).not.toBeChecked();
  expect(toggle).toHaveAccessibleDescription(
    expect.stringContaining("With AI on, Lanewise also fetches its model catalog from GitHub, sending nothing with it"),
  );
  expect(ai.getByRole("combobox", { name: "Model Provider" })).toHaveValue("");
  expect(platform.fetches).toEqual([]);
  expect(platform.calls.map(({ name }) => name)).not.toContain("modelProviderKey");
  await expectNoAxeViolations(view.container);
});

test("without a Model Provider to choose, Settings says so, and still says which API keys to get", async () => {
  const { platform } = setUp();
  const { ai, view } = await openAi(platform, []);

  expect(ai.getByText("No Model Provider can be chosen in this version of Lanewise yet.")).toBeInTheDocument();
  expect(ai.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(ai.getByRole("link", { name: /Anthropic \(Claude\): API keys/ })).toBeInTheDocument();
  await expectNoAxeViolations(view.container);
});

test("Settings says consumer subscriptions can't be used, and links to each API-key page", async () => {
  const { platform, providers } = setUp();
  const { ai, user } = await openAi(platform, providers);

  const note = ai.getByRole("group", { name: "API keys, not subscriptions" });
  expect(note).toHaveTextContent(
    "Claude Pro or Max, ChatGPT Plus, SuperGrok, Gemini Advanced and Meta AI won't work",
  );
  const links = within(note).getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "https://platform.claude.com/settings/keys",
    "https://platform.openai.com/api-keys",
    "https://console.x.ai/team/default/api-keys",
    "https://aistudio.google.com/apikey",
    "https://dev.meta.ai/",
  ]);
  expect(CLOUD_MODEL_PROVIDERS).toHaveLength(5);

  await user.click(within(note).getByRole("link", { name: /xAI \(Grok\): API keys/ }));

  expect(platform.links).toEqual(["https://console.x.ai/team/default/api-keys"]);
});

test("an API key is kept in the credential store, never in local storage, and only said to be kept", async () => {
  const { platform, providers, keys } = setUp();
  const { ai, user } = await openAi(platform, providers);
  await user.selectOptions(ai.getByRole("combobox", { name: "Model Provider" }), "Fake Model Provider");
  expect(await ai.findByText(/No API key for Fake Model Provider is kept yet\./)).toBeInTheDocument();

  const field = ai.getByLabelText("API key");
  expect(field).toHaveAttribute("type", "password");
  await user.type(field, "  sk-fake  ");
  await user.click(ai.getByRole("button", { name: "Save" }));

  expect(keys.keys.get("fake")).toBe("sk-fake");
  expect(await ai.findByText(/Your API key for Fake Model Provider is kept in your system's credential store\./)).toBeInTheDocument();
  expect(ai.getByLabelText("Replace your API key")).toHaveValue("");
  expect(ai.getByRole("status")).toHaveTextContent("Saved your API key for Fake Model Provider.");
  expect(JSON.stringify({ ...localStorage })).not.toContain("sk-fake");
  expect(ai.queryByText(/sk-fake/)).not.toBeInTheDocument();
  expect(ai.getByRole("link", { name: /Make an API key for Fake Model Provider/ })).toHaveAttribute(
    "href",
    "https://fake-model-provider.test/fake/api-keys",
  );

  await user.click(ai.getByRole("button", { name: "Forget the API key for Fake Model Provider" }));

  expect(keys.keys.has("fake")).toBe(false);
  expect(await ai.findByText(/No API key for Fake Model Provider is kept yet\./)).toBeInTheDocument();
  expect(ai.getByLabelText("API key")).toHaveFocus();
});

test("an empty API key isn't kept, and the field says why", async () => {
  const { platform, providers } = setUp();
  const { ai, user } = await openAi(platform, providers);
  await user.selectOptions(ai.getByRole("combobox", { name: "Model Provider" }), "Fake Model Provider");

  await user.click(ai.getByRole("button", { name: "Save" }));

  expect(ai.getByRole("alert")).toHaveTextContent("Enter the API key to keep.");
  expect(ai.getByLabelText("API key")).toHaveAttribute("aria-invalid", "true");
  expect(ai.getByLabelText("API key")).toHaveFocus();
});

test("turning AI on first discloses exactly what's sent, and to which Model Provider", async () => {
  const { platform, providers, fake } = setUp({ fake: "sk-fake" });
  const { ai, user, view } = await openAi(platform, providers);
  await user.selectOptions(ai.getByRole("combobox", { name: "Model Provider" }), "Fake Model Provider");
  const toggle = ai.getByRole("checkbox", { name: "Suggest Resolutions with AI" });

  await user.click(toggle);

  const disclosure = ai.getByRole("group", {
    name: "What AI sends to Fake Model Provider (api.fake-model-provider.test)",
  });
  expect(disclosure).toHaveFocus();
  expect(within(disclosure).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "The Conflict Hunk's three versions: Base, Ours and Theirs.",
    "Up to 20 lines of the file above the Conflict Hunk, and up to 20 below it.",
    "The file's path in the repository.",
    "The subjects of the commits on both sides.",
  ]);
  expect(toggle).not.toBeChecked();
  expect(fake.requests).toEqual([]);
  await expectNoAxeViolations(view.container);

  await user.click(within(disclosure).getByRole("button", { name: "Cancel" }));

  expect(toggle).not.toBeChecked();
  expect(toggle).toHaveFocus();
  expect(kept().enabled).toBe(false);
  expect(fake.requests).toEqual([]);

  await user.click(toggle);
  await user.click(ai.getByRole("button", { name: "Turn on AI" }));

  expect(toggle).toBeChecked();
  expect(kept()).toMatchObject({ enabled: true, disclosed: ["fake"] });
  expect(ai.queryByRole("group", { name: /What AI sends/ })).not.toBeInTheDocument();
  expect(await ai.findByRole("combobox", { name: "Model" })).toBeInTheDocument();
  expect(fake.requests.map(({ url, authorization }) => [url, authorization])).toEqual([
    ["https://api.fake-model-provider.test/fake/models", "Bearer sk-fake"],
  ]);
  // The model catalog comes from the repository, with nothing sent: no API key.
  expect(platform.fetches.map(({ url, init }) => [url, new Headers(init?.headers).get("authorization")])).toEqual([
    [CATALOG_URL, null],
    ["https://api.fake-model-provider.test/fake/models", "Bearer sk-fake"],
  ]);
});

test("AI can't be turned on before a Model Provider is chosen, since the disclosure names it", async () => {
  const { platform, providers, fake } = setUp({ fake: "sk-fake" });
  const { ai, user, view } = await openAi(platform, providers);
  const toggle = ai.getByRole("checkbox", { name: "Suggest Resolutions with AI" });

  await user.click(toggle);

  expect(toggle).not.toBeChecked();
  expect(kept().enabled).toBe(false);
  expect(ai.getByRole("alert")).toHaveTextContent("Choose a Model Provider for every repository first");
  expect(toggle).toHaveAccessibleDescription(expect.stringContaining("Choose a Model Provider"));
  expect(ai.queryByRole("group", { name: /What AI sends/ })).not.toBeInTheDocument();
  await expectNoAxeViolations(view.container);

  await user.selectOptions(ai.getByRole("combobox", { name: "Model Provider" }), "Fake Model Provider");

  expect(ai.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(toggle);
  expect(ai.getByRole("group", { name: /What AI sends to Fake Model Provider/ })).toBeInTheDocument();
  expect(fake.requests).toEqual([]);
});

test("with AI on, the model, its version, newest first, and its effort are chosen from the live list, and kept", async () => {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["fake"], global: { provider: "fake" } }),
  );
  const { platform, providers, fake } = setUp({ fake: "sk-fake" });
  const { ai, user, view } = await openAi(platform, providers);

  const model = await ai.findByRole("combobox", { name: "Model" });
  expect(within(model).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Choose a model",
    "Fake Opus",
    "Fake Mini",
    "Other versions",
  ]);
  await user.selectOptions(model, "Fake Opus");

  const version = ai.getByRole("combobox", { name: "Version" });
  expect(within(version).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Newest: Fake Opus 5",
    "Fake Opus 5",
    "Fake Opus 4",
  ]);
  expect(version).toHaveValue("");
  const effort = ai.getByRole("combobox", { name: "Effort" });
  expect(within(effort).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Fake Model Provider's default: High",
    "Low",
    "Medium",
    "High",
    "Maximum",
  ]);

  await user.selectOptions(version, "Fake Opus 4");
  await user.selectOptions(ai.getByRole("combobox", { name: "Effort" }), "Low");

  expect(kept().global).toEqual({ provider: "fake", model: "fake-opus", version: "fake-opus-4", effort: "low" });
  await expectNoAxeViolations(view.container);

  await user.selectOptions(ai.getByRole("combobox", { name: "Model" }), "Fake Mini");

  expect(ai.queryByRole("combobox", { name: "Effort" })).not.toBeInTheDocument();
  expect(ai.getByText("Fake Mini 1 takes no effort.")).toBeInTheDocument();

  await user.click(ai.getByRole("button", { name: "Refresh models" }));

  await waitFor(() => expect(fake.requests.filter(({ url }) => url.endsWith("/models"))).toHaveLength(2));
  expect(await ai.findByRole("combobox", { name: "Model" })).toHaveValue("fake-mini");
  // The model catalog is fetched once for the run, and again with each Refresh models.
  expect(platform.fetches.filter(({ url }) => url === CATALOG_URL)).toHaveLength(2);
});

test("a model the catalog doesn't describe is offered under Other versions, with only the Model Provider's default effort", async () => {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["fake"], global: { provider: "fake" } }),
  );
  const { platform, providers } = setUp({ fake: "sk-fake" });
  const { ai, user, view } = await openAi(platform, providers);

  await user.selectOptions(await ai.findByRole("combobox", { name: "Model" }), "Other versions");

  const version = ai.getByRole("combobox", { name: "Version" });
  expect(within(version).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Newest: fake-lab-1",
    "fake-lab-1",
  ]);
  expect(ai.queryByRole("combobox", { name: "Effort" })).not.toBeInTheDocument();
  expect(
    ai.getByText("Lanewise's model catalog doesn't describe fake-lab-1 yet, so it's used with Fake Model Provider's default effort."),
  ).toBeInTheDocument();
  expect(kept().global).toEqual({ provider: "fake", model: "other-versions", version: null, effort: null });
  await expectNoAxeViolations(view.container);
});

test("the picker's fields and Refresh models are reached in order with Tab, and Refresh models works with Enter", async () => {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["fake"], global: { provider: "fake", model: "fake-opus" } }),
  );
  const { platform, providers, fake } = setUp({ fake: "sk-fake" });
  const { ai, user } = await openAi(platform, providers);

  // Each is a native select, which the arrow keys choose in: jsdom can't press them (a hand check).
  const model = await ai.findByRole("combobox", { name: "Model" });
  model.focus();
  await user.tab();
  expect(ai.getByRole("combobox", { name: "Version" })).toHaveFocus();
  await user.tab();
  expect(ai.getByRole("combobox", { name: "Effort" })).toHaveFocus();
  await user.tab();
  expect(ai.getByRole("button", { name: "Refresh models" })).toHaveFocus();
  await user.keyboard("{Enter}");

  await waitFor(() => expect(fake.requests.filter(({ url }) => url.endsWith("/models"))).toHaveLength(2));
  expect(platform.fetches.filter(({ url }) => url === CATALOG_URL)).toHaveLength(2);
});

test("offline, the model catalog Lanewise came with describes the models", async () => {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["fake"], global: { provider: "fake" } }),
  );
  const { platform, providers } = setUp({ fake: "sk-fake" }, undefined, { offline: true });
  const { ai, view } = await openAi(platform, providers);

  // The bundled catalog has no section for the fake Model Provider, so it describes none of its models.
  const model = await ai.findByRole("combobox", { name: "Model" });
  expect(within(model).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Choose a model",
    "Other versions",
  ]);
  await expectNoAxeViolations(view.container);
});

test("with AI on, choosing a Model Provider not yet disclosed discloses it first", async () => {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["fake"], global: { provider: "fake" } }),
  );
  const { platform, providers, other } = setUp({ fake: "sk-fake", other: "sk-other" });
  const { ai, user } = await openAi(platform, providers);
  const choice = ai.getByRole("combobox", { name: "Model Provider" });

  await user.selectOptions(choice, "Other Model Provider");

  expect(
    ai.getByRole("group", { name: "What AI sends to Other Model Provider (api.fake-model-provider.test)" }),
  ).toHaveFocus();
  expect(choice).toHaveValue("fake");
  expect(other.requests).toEqual([]);

  await user.click(ai.getByRole("button", { name: "Use Other Model Provider" }));

  expect(choice).toHaveValue("other");
  expect(kept()).toMatchObject({ disclosed: ["fake", "other"], global: { provider: "other" } });
  await waitFor(() => expect(other.requests).toHaveLength(1));
});

test("the lines of context sent are chosen in Settings, and the disclosure says how many", async () => {
  const { platform, providers } = setUp({ fake: "sk-fake" });
  const { ai, user } = await openAi(platform, providers);
  const lines = ai.getByRole("spinbutton", { name: "Lines of context" });

  await user.clear(lines);
  await user.type(lines, "5");
  expect(kept().contextLines).toBe(5);

  await user.clear(lines);
  await user.type(lines, "500");
  expect(lines).toHaveAttribute("aria-invalid", "true");
  expect(kept().contextLines).toBe(50);
  await user.clear(lines);
  await user.type(lines, "5");

  await user.selectOptions(ai.getByRole("combobox", { name: "Model Provider" }), "Fake Model Provider");
  await user.click(ai.getByRole("checkbox", { name: "Suggest Resolutions with AI" }));

  expect(ai.getByText("Up to 5 lines of the file above the Conflict Hunk, and up to 5 below it.")).toBeInTheDocument();
});

/** Settings' AI alone, for the repository `root`, as the App would show it. */
function RepositoryAi({ platform, providers, root }: { platform: FakePlatform; providers: ModelProvider[]; root: string }) {
  const ai = useAiSettings();
  const [catalogs] = useState(() => catalogSource(platform.platform));
  return (
    <ModelProviderSettings
      ai={ai}
      providers={providers}
      platform={platform.platform}
      catalogs={catalogs}
      repository={{ root, name: root.split("/").pop() ?? root }}
    />
  );
}

test("the shown repository can be set apart with a choice of its own, and put back", async () => {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({
      enabled: true,
      disclosed: ["fake"],
      global: { provider: "fake", model: "fake-opus" },
      repositories: { "/work/elsewhere": { provider: "fake" } },
    }),
  );
  const { platform, providers, other } = setUp({ fake: "sk-fake", other: "sk-other" });
  const user = userEvent.setup();
  const { container } = render(<RepositoryAi platform={platform} providers={providers} root="/work/lanewise" />);
  const apart = screen.getByRole("checkbox", { name: "Set lanewise apart, with a choice of its own" });
  expect(apart).not.toBeChecked();

  await user.click(apart);

  const own = within(screen.getByRole("group", { name: "lanewise's choice" }));
  expect(kept().repositories["/work/lanewise"]).toEqual(kept().global);
  await user.selectOptions(own.getByRole("combobox", { name: "Model Provider" }), "Other Model Provider");
  await user.click(screen.getByRole("button", { name: "Use Other Model Provider" }));

  expect(kept().repositories["/work/lanewise"]).toEqual({ provider: "other", model: null, version: null, effort: null });
  expect(kept().global?.provider).toBe("fake");
  await waitFor(() => expect(other.requests).toHaveLength(1));
  await user.selectOptions(await own.findByRole("combobox", { name: "Model" }), "Fake Mini");
  expect(kept().repositories["/work/lanewise"]?.model).toBe("fake-mini");
  await expectNoAxeViolations(container);

  const others = screen.getByRole("list", { name: "Other repositories set apart" });
  expect(within(others).getAllByRole("listitem").map((item) => item.firstChild?.textContent)).toEqual([
    "elsewhere: Fake Model Provider",
  ]);
  await user.click(within(others).getByRole("button", { name: "Stop setting elsewhere apart" }));
  expect(kept().repositories["/work/elsewhere"]).toBeUndefined();
  expect(screen.getByRole("status")).toHaveTextContent("elsewhere uses the choice for every repository again.");

  await user.click(apart);

  expect(kept().repositories).toEqual({});
  expect(screen.queryByRole("group", { name: "lanewise's choice" })).not.toBeInTheDocument();
});

/** A platform with a Model Provider on this computer, answering at any base URL there, and keeping `keysKept`. */
function setUpLocal(keysKept: Record<string, string> = {}, key: string | null = null) {
  const local = fakeModelProvider({ id: "local", name: "Local server", key, local: true });
  const keys = fakeKeyStore(keysKept);
  const platform = fakePlatform({ commands: keys.commands, fetch: (url, init) => local.answer(url, init) });
  return { local, keys, platform, providers: [local.provider] };
}

test("a server on this computer is disclosed as on it, and lists its models without an API key", async () => {
  const { platform, providers, local } = setUpLocal();
  const { ai, user, view } = await openAi(platform, providers);
  await user.selectOptions(ai.getByRole("combobox", { name: "Model Provider" }), "Local server");

  expect(ai.getByLabelText("Base URL")).toHaveValue(FAKE_LOCAL_API);
  expect(ai.getByLabelText("API key (optional)")).toHaveAttribute("type", "password");
  expect(await ai.findByText(/No API key is kept, and most local servers take none\./)).toBeInTheDocument();
  expect(ai.queryByRole("link", { name: /Make an API key/ })).not.toBeInTheDocument();

  await user.click(ai.getByRole("checkbox", { name: "Suggest Resolutions with AI" }));

  const disclosure = ai.getByRole("group", { name: "What AI sends to Local server, on this computer" });
  expect(disclosure).toHaveTextContent("It's sent to the base URL you set, which is always on this computer");
  expect(disclosure).not.toHaveTextContent("bills your account");
  await expectNoAxeViolations(view.container);
  await user.click(within(disclosure).getByRole("button", { name: "Turn on AI" }));

  expect(await ai.findByRole("combobox", { name: "Model" })).toBeInTheDocument();
  expect(local.requests.map(({ url, authorization }) => [url, authorization])).toEqual([[`${FAKE_LOCAL_API}/models`, null]]);
  await expectNoAxeViolations(view.container);
});

test("a server on this computer is asked at the base URL set for it, which is only ever on this computer", async () => {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["local"], global: { provider: "local" } }),
  );
  const { platform, providers, local } = setUpLocal();
  const { ai, user, view } = await openAi(platform, providers);
  await ai.findByRole("combobox", { name: "Model" });
  const field = ai.getByLabelText("Base URL");
  const save = within(field.closest("form") as HTMLFormElement).getByRole("button", { name: "Save" });

  await user.clear(field);
  await user.type(field, "https://models.example.com/v1");
  await user.click(save);

  expect(ai.getByRole("alert")).toHaveTextContent(
    `Enter a base URL on this computer, with its port, such as ${FAKE_LOCAL_API}.`,
  );
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveFocus();
  expect(kept().baseUrls).toEqual({});
  await expectNoAxeViolations(view.container);

  await user.clear(field);
  // With Enter, as well as Save.
  await user.type(field, "http://localhost:1234/v1/{Enter}");

  expect(kept().baseUrls).toEqual({ local: "http://localhost:1234/v1" });
  expect(field).toHaveValue("http://localhost:1234/v1");
  expect(field).not.toHaveAttribute("aria-invalid");
  // Its models are listed afresh from there, which is said once they are.
  await waitFor(() =>
    expect(local.requests.map(({ url }) => url)).toEqual([`${FAKE_LOCAL_API}/models`, "http://localhost:1234/v1/models"]),
  );
  expect(await ai.findByRole("combobox", { name: "Model" })).toBeInTheDocument();
  expect(ai.getByRole("status")).toHaveTextContent("Listed 3 models from Local server.");
  expect(JSON.stringify(platform.fetches.map(({ url }) => url))).not.toContain("example.com");
});

test("a server on this computer that asks for an API key is sent the one kept for it", async () => {
  localStorage.setItem(
    MODEL_PROVIDER_KEY,
    JSON.stringify({ enabled: true, disclosed: ["local"], global: { provider: "local" } }),
  );
  const { platform, providers, local, keys } = setUpLocal({}, "lm-studio-key");
  const { ai, user } = await openAi(platform, providers);

  // Without the key it asks for, it's refused, and says so.
  expect(await ai.findByRole("alert")).toHaveTextContent(/API key/);
  await user.type(ai.getByLabelText("API key (optional)"), "lm-studio-key");
  const field = ai.getByLabelText("API key (optional)");
  await user.click(within(field.closest("form") as HTMLFormElement).getByRole("button", { name: "Save" }));

  expect(keys.keys.get("local")).toBe("lm-studio-key");
  expect(await ai.findByRole("combobox", { name: "Model" })).toBeInTheDocument();
  expect(local.requests.map(({ authorization }) => authorization)).toEqual([null, "Bearer lm-studio-key"]);
  expect(ai.getByLabelText("Replace your API key")).toHaveValue("");
});
