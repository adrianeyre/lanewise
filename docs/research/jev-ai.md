# TypeSafe AI's Jev: calling it over HTTP

Researched on 30 September 2026 from TypeSafe's own docs and site, Vercel's AI Gateway docs, and the AI SDK docs. Every fact below links to the page it comes from. Anything marked **Observed** was seen by sending a request on 30 September 2026. It is not a published guarantee.

## Summary

- **What Jev is.** Jev is TypeSafe's "flagship model and the first System One model". You send it a `state` and a map of typed `questions`, and it returns typed `answers`. It does not generate text. ([Introduction](https://docs.typesafe.ai/introduction))
- **TypeSafe's own API.** `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <API_KEY>`. The model is `"jev-latest"`, which currently points to `jev-1.13.0`. ([API reference](https://docs.typesafe.ai/api), [Models](https://docs.typesafe.ai/models))
- **Question types.** TypeSafe's names are `noul`, `choice` and `score`. `noul` is the yes/no type: the Vercel and AI SDK APIs call it `boolean`, and TypeSafe's own API does not accept that name.
- **Vercel AI Gateway.** There are two ways in:
  - Vercel's native evaluation API: `POST https://ai-gateway.vercel.sh/v1/evaluate`, with the `boolean` type and model `typesafe-ai/jev`.
  - A TypeSafe-compatible API at `https://ai-gateway.vercel.sh/typesafe`, which uses TypeSafe's request and response shapes.

  Both take `Authorization: Bearer <AI Gateway key or OIDC token>`. ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation), [TypeSafe API with AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe))
- **Pricing and limits.** $0.042 per million input tokens, and output tokens are free. Each request has a 64k-token context, of which 32k is for `state` plus the longest question. Rate limits are 100K tokens per second and 40 requests per second, "adjusting dynamically". ([Models](https://docs.typesafe.ai/models))
- **Streaming.** None. The AI SDK "does not stream answers". ([AI SDK Evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation))
- **Availability.** TypeSafe announced Jev "available today in early access" on 15 September 2026 and is "bringing developers off the waitlist". ([TypeSafe blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev))
- **Calling it from Tauri.** Nothing in the docs restricts clients. **Observed:** `api.typesafe.ai` sends no `Access-Control-Allow-Origin` header, so a request from the webview's `fetch` would be blocked by CORS. The request has to come from the Rust side or Tauri's HTTP plugin. AI Gateway did echo `tauri://localhost`.

## 1. Ways to call it, and authentication

### TypeSafe HTTP API (direct)

- **Endpoint.** The API reference gives the endpoint and headers as follows ([API reference](https://docs.typesafe.ai/api)):

  ```http
  POST https://api.typesafe.ai/v1/systemone
  Authorization: Bearer <API_KEY>
  Content-Type: application/json
  ```

- **Listing models.** "`GET /v1/models` returns the names your account can send in the `model` field, with a description and release date for each. It currently lists the aliases." The example is `curl https://api.typesafe.ai/v1/models -H "Authorization: Bearer $TYPESAFE_API_KEY"`. ([Models](https://docs.typesafe.ai/models))
- **Getting a key.** Keys come from the console at `console.typesafe.ai/keys`. ([Quickstart](https://docs.typesafe.ai/introduction/quickstart))
- **SDK defaults.** The Python SDK's defaults are `DEFAULT_BASE_URL = 'https://api.typesafe.ai'`, `API_KEY_ENV = 'TYPESAFE_API_KEY'`, `DEFAULT_MODEL = 'jev-latest'` and `DEFAULT_TIMEOUT = 10.0` seconds. ([Python constants](https://docs.typesafe.ai/sdk/python/api/constants))
- **JavaScript SDK.** The JavaScript SDK is `npm install @typesafe-ai/sdk`, needs "Node.js 20 or newer", and is called as `client.systemOne({...})`. ([JavaScript SDK](https://docs.typesafe.ai/sdk/javascript))
- **AI SDK provider.** The AI SDK provider `@ai-sdk/typesafe-ai` defaults to `baseURL` `https://api.typesafe.ai/v1` and to the key in `TYPESAFE_AI_API_KEY`. ([AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai))

### Vercel AI Gateway: native evaluation endpoint

- **Endpoint.** The native endpoint is called like this ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation)):

  ```bash
  curl https://ai-gateway.vercel.sh/v1/evaluate \
    -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{ "model": "typesafe-ai/jev", "state": "...", "questions": { ... } }'
  ```

- **Not the other gateway APIs.** Evaluation "is not supported through the OpenAI-compatible, Anthropic-compatible, or Cohere-compatible endpoints". ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation))
- **Bring your own TypeSafe key.** "Evaluation works with BYOK. If your team has added a key for the provider, it is used automatically." ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation))

### Vercel AI Gateway: TypeSafe-compatible API

- **Base URL.** `https://ai-gateway.vercel.sh/typesafe` ([TypeSafe API with AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe))
- **Endpoints.** The API serves `POST /typesafe/v1/systemone` and `GET /typesafe/v1/models`. ([same page](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe))
- **Authentication.** The page lists two options:
  - "API key: Use your AI Gateway API key with the `Authorization: Bearer <token>` header"
  - "OIDC token: Use your Vercel OIDC token with the `Authorization: Bearer <token>` header"

  "This is the credential AI Gateway authenticates you with, not the credential used to call the model." ([same page](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe))
- **Which to use.** "If you are writing new code rather than migrating, use the evaluation API instead." ([same page](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe))

## 2. Request body

### TypeSafe (`/v1/systemone`)

The request has three top-level fields ([API reference](https://docs.typesafe.ai/api)):

- **`state`** (`string | object | array`, required). "A plain string for text, or structured data (object/array) for things like chat logs, records, or the current state of your application."
- **`model`** (`string`, required). "Use `"jev-latest"`."
- **`questions`** (`map<string, Question>`, required). The docs say of the key: "A key you choose. ... The key is not sent to the underlying model and is not used in inference."

Every question has a `type` and `instructions`. `instructions` is `string | object | array`. An object can hold the question in one field and the data it refers to in others, with the data named in backticks. ([API reference](https://docs.typesafe.ai/api))

The three question types differ only in their `criteria` ([API reference](https://docs.typesafe.ai/api)):

| `type` | `criteria` | Limits |
| --- | --- | --- |
| `"noul"` | Optional object `{ "true": ..., "false": ... }`, each `string \| object \| array` | None published |
| `"choice"` | Required `map<string, string \| object \| array \| null>` of option to description ("use null when an option needs no extra detail") | "a maximum of 255 options per Choice" |
| `"score"` | Required `array<string \| object \| array>`, "An ordered array of level descriptions" | "at least two levels; the API accepts up to 10" |

Example request ([API reference](https://docs.typesafe.ai/api)):

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "model": "jev-latest",
  "questions": {
    "is_urgent": {
      "type": "noul",
      "instructions": "Does this convey urgency?",
      "criteria": {
        "true": "Explicitly time-sensitive",
        "false": "No urgency expressed"
      }
    }
  }
}
```

- **Models and aliases.**
  - `jev-latest` points to `jev-1.13.0`.
  - `jev-preview` also currently points to `jev-1.13.0`.
  - Pinning a version is recommended "If you have tuned confidence thresholds against a specific version".

  ([Models](https://docs.typesafe.ai/models))
- **Size limits.** "64k tokens per request; 32k tokens for `state` plus the longest question." ([Models](https://docs.typesafe.ai/models))
- **Input.** "Text only. String, JSON object, or array of text values. No image, audio, or video input." ([Models](https://docs.typesafe.ai/models))
- **Sampling settings.** None are published: the API reference lists only `state`, `model` and `questions`. ([API reference](https://docs.typesafe.ai/api))

### Vercel AI Gateway (`/v1/evaluate`)

- **Fields.** The request takes the "same `model`, `state`, and `questions` fields". The type is `boolean` rather than `noul`. ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation))
- **Criteria.** The criteria follow the same pattern as TypeSafe's:
  - `boolean`: optional `criteria: { true, false }`.
  - `choice`: a record of option name to description.
  - `score`: "an array of at least two labels, ordered lowest to highest".

  ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation))
- **Model id.** `"typesafe-ai/jev"`.
- **Extra field.** `providerOptions.gateway`, for example `{ "zeroDataRetention": true, "only": ["typesafe-ai"] }`, plus `models`, which configures evaluation fallbacks. ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation))
- **Limits.** The Vercel guide gives a "Context window: 64,000 tokens per request and 32,000 for `state`", Choice "Up to 255 options", and Score "2 to 10 levels". ([Vercel KB guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk))

## 3. Response body

### TypeSafe

The response has three top-level fields ([API reference](https://docs.typesafe.ai/api)):

- `model`: the versioned model that ran.
- `answers`: keyed by question id.
- `usage`: `{ "input_tokens": integer, "output_tokens": integer }`.

Each answer type returns different fields ([API reference](https://docs.typesafe.ai/api)):

- **Noul.** `{ "type": "noul", "noul": 0.95 }`. `noul` is "on a scale from 0 (no) to 1 (yes)". It carries no confidence.
- **Choice.** `{ "type": "choice", "choice": "billing", "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 }, "confidence": 0.81 }`.
- **Score.** `{ "type": "score", "score": 1.05, "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" }, "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 }, "confidence": 0.92 }`. `score` is "The probability-weighted answer across the levels; can land between levels."

Full example ([API reference](https://docs.typesafe.ai/api)):

```json
{
  "model": "jev-1.13.0",
  "answers": { "is_urgent": { "type": "noul", "noul": 0.95 } },
  "usage": { "input_tokens": 296, "output_tokens": 20 }
}
```

- **Confidence.** `confidence` is "a statistic computed from the probability distribution". The formula is not published. ([Confidence](https://docs.typesafe.ai/confidence))
- **Rounding.** "TypeSafe returns scores and probabilities rounded to two decimal places", so probabilities may not add up to exactly one. ([AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai))
- **Request id.** It comes back in the `x-typesafe-request-id` response header. ([Python responses](https://docs.typesafe.ai/sdk/python/api/types/responses), [JS RateLimitError](https://docs.typesafe.ai/sdk/javascript/api/classes/RateLimitError))

**Errors.** "Errors use standard HTTP status codes with a JSON body describing what went wrong." ([API reference](https://docs.typesafe.ai/api)) The published status codes are:

| Status | Meaning (quoted) |
| --- | --- |
| `401` | "Missing or invalid API key." |
| `422` | "The request body failed validation ... The body details the offending field." |
| `429` | "You have exceeded your rate limit. Back off and retry after a short delay." |
| `529` | "TypeSafe is temporarily overloaded. Retry after a short delay." |

- **Retrying 429 and 529.** Retry them "with exponential backoff instead of retrying immediately". ([API reference](https://docs.typesafe.ai/api))
- **Retry headers.** The SDKs honour `Retry-After` and `retry-after-ms`. ([Python retries](https://docs.typesafe.ai/sdk/python/api/retries), [Models](https://docs.typesafe.ai/models))
- **Other statuses.** The SDK exception classes also cover 400, 403, 404 and 5xx. ([Python exceptions](https://docs.typesafe.ai/sdk/python/api/exceptions))
- **Error body.** TypeSafe does not publish the shape of its error body.
  - Vercel documents TypeSafe's error shape as `{ "message": "...", "error_type": "invalid_request" }`. ([TypeSafe API with AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe))
  - **Observed** from `api.typesafe.ai`: the error is nested under `detail`. A bad key returned `401 {"detail":{"error_type":"authentication_error","message":"Cannot authenticate with the server. ..."}}`. A missing key returned **403** (not 401) with `error_type` `"authentication_error"`. Both came with an `x-typesafe-request-id` header.

### Vercel AI Gateway `/v1/evaluate`

The answers use camelCase names and the `boolean` type ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation)):

```json
{
  "model": "typesafe-ai/jev",
  "answers": { "refund": { "type": "boolean", "probability": 0.98 } },
  "usage": { "inputTokens": 275, "outputTokens": 20 },
  "providerMetadata": { "gateway": { "routing": { "...": "..." }, "cost": "0.00001155", "generationId": "gen_..." } }
}
```

- **Choice answers.** Choice answers here carry `choice` and `probabilities`. The documented Gateway examples show no `confidence`. Through the AI SDK, confidence is read from `providerMetadata.typesafe.confidence`. ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation), [Vercel KB guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk))
- **The TypeSafe-compatible path.** It returns TypeSafe's field names (`noul`, `input_tokens`) plus `provider_metadata.gateway`. ([TypeSafe API with AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe))
- **Error shape.** The native endpoint's error shape is not published.
  - **Observed:** `{"error":{"message":"Authentication failed","param":null,"type":"authentication_error"}}` with status 401, and `400 ... "type":"invalid_request_error"` for a malformed body.
  - **Observed:** CORS exposes `retry-after` and `x-should-retry`.

## 4. Pricing, limits, availability, data, streaming

- **Price.** "\$42 / \$0.042" per billion and per million tokens. It is "Charged per input token. Output tokens are free." ([Models](https://docs.typesafe.ai/models)) Vercel gives the same figure: "$0.042 per 1M input tokens". ([Vercel KB guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk))
- **Gateway billing.** Requests through the Gateway are billed from per-token rates, and a triggered fallback bills both stages. ([Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation))
- **Rate limits.** "100K tokens per second / 40 requests per second". "A request over either limit returns `429 Too Many Requests`." The docs warn: "Rate limits are adjusting dynamically ... the limits above can change without notice." Higher limits come with custom or enterprise plans. ([Models](https://docs.typesafe.ai/models))
- **Availability.**
  - The blog post is dated 15 September 2026: "Our first public model is Jev, available today in early access." "Today, we are opening early access and bringing developers off the waitlist as quickly as we can." ([TypeSafe blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev))
  - Jev reached AI Gateway on 16 September 2026. ([Vercel changelog](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway))
  - The TypeSafe-client and HTTP API routes on the Gateway followed on 21 September 2026. ([Vercel changelog](https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev))
- **Training.** TypeSafe states it plainly in three places:
  - "Jev is not trained on customer requests or responses." ([Models](https://docs.typesafe.ai/models))
  - "We will not train or fine tune any artificial intelligence or machine learning models on your prompts or other Input." ([Privacy Policy](https://typesafe.ai/legal/privacy-policy))
  - TypeSafe "will not, include Customer Data in a dataset used to train ... without Customer's prior consent". ([Master Customer Agreement](https://typesafe.ai/legal/mca))
- **Retention.**
  - Personal data is kept "for as long as reasonably necessary to provide you with the Services". ([Privacy Policy](https://typesafe.ai/legal/privacy-policy))
  - "We also offer zero data retention (ZDR) for enterprise customers." ([Legal](https://docs.typesafe.ai/legal))
  - Through the Gateway, both are per request: "Zero Data Retention and No Training, per request" (`providerOptions.gateway.zeroDataRetention: true`). ([Vercel KB guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk), [Evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation))
- **Streaming.** None. "Evaluation currently returns one complete result for one shared state. It does not stream answers, perform multilabel classification, or batch unrelated states." ([AI SDK Evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation))
- **Language.** "English is the primary training language and where accuracy is currently best." ([Models](https://docs.typesafe.ai/models))

## 5. AI SDK `experimental_evaluate`

The import, verbatim ([AI SDK reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/evaluate)):

```ts
import { experimental_evaluate } from 'ai';
```

The parameters ([AI SDK reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/evaluate)):

| Parameter | Type |
| --- | --- |
| `model` (required) | `Experimental_EvaluationModel`, or a string ID |
| `state` (required) | `string \| object \| array` |
| `questions` (required) | `Record<string, Experimental_EvaluationQuestion>` |
| `maxRetries` | `number`, "defaults to 2" |
| `abortSignal` | `AbortSignal` |
| `headers` | `Record<string, string>` |
| `providerOptions` | `ProviderOptions` |
| `telemetry` | `TelemetryOptions` |
| `runtimeContext` | `Record<string, unknown>` |
| `onStart` | `(event: Experimental_EvaluateStartEvent) => void` |
| `onEnd` | `(event: Experimental_EvaluateEndEvent) => void` |

- **Return value.** It returns `Promise<Experimental_EvaluationResult<QUESTIONS>>` with `answers`, `usage` (`inputTokens`, `outputTokens`, `totalTokens`), `warnings`, `rounding`, `providerMetadata` and `response`. ([AI SDK reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/evaluate))
- **Versions.** It needs "AI SDK 7.0.105 onwards". ([Vercel changelog](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway))
- **Stability.** "experimental and may change in patch releases". ([AI SDK Evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation))

A minimal example, verbatim, which goes through the Gateway ([AI SDK Evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation)):

```ts
import { experimental_evaluate } from 'ai';

const result = await experimental_evaluate({
  model: 'typesafe-ai/jev',
  state: 'I was charged twice. Please refund the extra charge.',
  questions: {
    refund: {
      type: 'boolean',
      instructions: 'Is the customer asking for a refund?',
    },
  },
});
```

To call TypeSafe directly with the user's own key, use `createTypeSafeAi({ apiKey })` and `typeSafeAi.evaluationModel('jev-latest')` from `@ai-sdk/typesafe-ai`. This path accepts a custom `fetch`. ([AI SDK TypeSafe provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai))

## 6. Calling it from a Tauri desktop app

- **Client restrictions.** None are published. The docs mention no client-type limits, allow-lists, or bans on desktop apps.
- **Contract terms.** The Master Customer Agreement lets a customer integrate the API into "software applications developed and operated by Customer for the benefit of Customer's end users". It requires Access Credentials to be kept confidential and not shared, and it bars offering the Services "as a standalone service". With Lanewise, each user signs up as their own TypeSafe customer and uses their own key. ([Master Customer Agreement](https://typesafe.ai/legal/mca))
- **Observed CORS on `api.typesafe.ai`.** A preflight with `Origin: tauri://localhost`, `http://tauri.localhost` or `http://localhost:1420` returned `400` with no `Access-Control-Allow-Origin`. `fetch` from the Tauri webview would therefore fail. Make the call from Rust (for example `reqwest`) or through `tauri-plugin-http`. Neither of those is subject to browser CORS.
- **Observed CORS on `ai-gateway.vercel.sh/v1/evaluate`.** The preflight echoed `access-control-allow-origin: tauri://localhost`.
- **Timeouts.** The Python SDK's default is 10 s. ([Python constants](https://docs.typesafe.ai/sdk/python/api/constants))

## Unknown / not published

- **Formal error bodies.** TypeSafe's own docs publish no formal error-body schema. What was observed (`{"detail":{"error_type","message"}}`) differs from Vercel's description (`{"message","error_type"}`). The docs also say 401 for a missing key, but 403 was observed.
- **Gateway errors.** There is no published error body or status list for Gateway `/v1/evaluate`.
- **Confidence formula.** It is not published: the Confidence page defers it to a future cookbook. ([Confidence](https://docs.typesafe.ai/confidence))
- **Question count.** There is no maximum number of questions per request beyond the 64k-token budget, and no minimum or maximum `state` size in characters.
- **Sampling settings.** There is no temperature, seed or other sampling parameter, and none are documented.
- **Retention period.** TypeSafe publishes no retention period for API inputs on non-enterprise accounts, beyond the Privacy Policy's "as long as reasonably necessary". ZDR is enterprise-only on direct accounts.
- **Early access.** No terms, quota or timeline for leaving the waitlist are published, and no free tier or trial credit is mentioned.
- **Rate-limit headers.** No rate-limit headers (remaining or reset) are documented, only `retry-after`.
- **Gateway confidence.** It is not documented whether Gateway `/v1/evaluate` returns Choice/Score `confidence` in the answer body or only in provider metadata.
- **CORS.** CORS behaviour is documented by neither TypeSafe nor Vercel. The notes above are observations only.
