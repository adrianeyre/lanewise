import { expect, test } from "vitest";

import { anthropicModelProvider } from "./anthropic";
import { geminiModelProvider } from "./gemini";
import type { Connection, ModelProvider } from "./modelProvider";
import { LOCAL_API } from "./modelProviderDetails";
import { MODEL_PROVIDERS } from "./modelProviders";
import { localModelProvider, metaModelProvider, openAiModelProvider, xaiModelProvider } from "./openAiCompatible";

// Nothing here reaches a Model Provider: every request is answered by a fake `fetch`.

/** What a Model Provider is offered as, without its adapter's methods. */
function detailsOf({ listModels: _list, suggest: _suggest, ...details }: ModelProvider) {
  return details;
}

const ADAPTERS = [
  anthropicModelProvider(),
  openAiModelProvider(),
  xaiModelProvider(),
  geminiModelProvider(),
  metaModelProvider(),
  localModelProvider(),
];

test("each Model Provider is offered as its adapter describes itself, in the same order", () => {
  expect(MODEL_PROVIDERS.map(detailsOf)).toEqual(ADAPTERS.map(detailsOf));
});

test.each(MODEL_PROVIDERS.map((provider) => [provider.id, provider] as const))(
  "%s loads its adapter when its models are first listed, and asks its own API",
  async (_id, provider) => {
    const urls: string[] = [];
    const connection: Connection = {
      apiKey: "sk-user",
      // An empty model list as each of the three SDKs reads one.
      fetch: async (url) => {
        urls.push(url);
        return Response.json({ object: "list", data: [], models: [], has_more: false, first_id: null, last_id: null });
      },
    };

    await expect(provider.listModels(connection)).resolves.toEqual([]);
    await expect(provider.listModels(connection)).resolves.toEqual([]);

    const api = provider.defaultBaseUrl === null ? `https://${provider.host}/` : `${LOCAL_API}/`;
    expect(urls).toHaveLength(2);
    for (const url of urls) expect(url.startsWith(api)).toBe(true);
  },
);
