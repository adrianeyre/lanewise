# Suggestions from your own Model Provider

[Back to the README](../README.md)

AI is off until you turn it on. Lanewise only ever calls a Model Provider with **your own API key**, which bills your account; a consumer subscription such as Claude Pro or Max, ChatGPT Plus, SuperGrok, Gemini Advanced or Meta AI can't stand in for one. The Model Providers are:

| Model Provider | Where to make an API key |
| --- | --- |
| Anthropic (Claude) | [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) |
| OpenAI (ChatGPT models) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| xAI (Grok) | [console.x.ai](https://console.x.ai/team/default/api-keys) |
| Google (Gemini) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Meta (Muse Spark), preview, US only | [dev.meta.ai](https://dev.meta.ai/) |
| Local server (Ollama, LM Studio or llama.cpp) | Usually none. Lanewise asks `http://localhost:11434/v1` unless you set another base URL on this computer |

To add yours:

1. Open **Settings** from the title bar, and go to **AI**.
2. Under **For every repository**, choose your **Model Provider**.
3. Paste your key into **API key** and choose **Save**. It's kept in your system's credential store (Keychain on macOS, Credential Manager on Windows, the Secret Service on Linux), never in Lanewise's settings or its Logs. **Forget the API key** removes it.
4. Tick **Suggest Resolutions with AI**. Lanewise shows exactly what each Suggestion request sends, and to whom; choose **Turn on AI** to agree, or **Cancel**.
5. Choose the **Model**, its **Version** and, where it takes one, its **Effort**. **Refresh models** asks the Model Provider for its list again.

A repository can be set apart with a Model Provider of its own, under **For** the repository open. Then, on the Conflicts page, **Suggest a resolution** in the AI Suggestion Widget asks for a Suggestion for the Conflict Hunk you're at. Nothing is put in the Resolution until you accept or edit it.

The scripts in the repository that call a Model Provider (`pnpm try:<model provider>` and `pnpm eval:suggestions`) never read Settings: they take your key from a `LANEWISE_…_API_KEY` variable in your shell, such as `LANEWISE_ANTHROPIC_API_KEY`, and never from `ANTHROPIC_API_KEY` or any other variable an SDK knows ([Trying a Model Provider](development.md#trying-a-model-provider)).

## A gateway

A cloud Model Provider's requests can go through a gateway of your own, such as your company's AI gateway or Vercel AI Gateway. Under the Model Provider in **Settings → AI**, choose **Use a gateway for …**, enter its address and any headers it needs, such as its key, and choose **Save the gateway**. Lanewise keeps them in your system's credential store, sends each request there with those headers, and never shows a header's value again; leave a value blank to keep it. **Stop using the gateway** sends requests to the Model Provider's own API again (ADR 0035).

## Tokens and context

The AI Suggestion Widget says how many lines of context a Suggestion would send, about how many tokens that is, and, once one is made, how many tokens it took as the Model Provider counts them, with a total for the run. **Refresh context** works it out again from the Resolution as it is.

## Jev decisions

Jev, TypeSafe AI's decision model, can check each Suggestion, offer which side a Conflict Hunk likely takes, and check staged changes for secrets and leftovers before a commit. Turn it on under **Settings → Jev decisions**, which lists exactly what each decision sends, and add your own TypeSafe API key from [console.typesafe.ai/keys](https://console.typesafe.ai/keys), or a gateway such as Vercel AI Gateway's TypeSafe route. Jev never changes anything itself (ADR 0036).

