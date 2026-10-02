import { expect, test } from "vitest";

import { fakeKeyStore, fakePlatform } from "../test/fakePlatform";
import { askJev, JEV_API, JEV_ID, JevError } from "./jev";
import { checkCommitWithJev, checkWithJev, triageWithJev } from "./jevDecisions";
import type { SuggestionRequest } from "./modelProvider";

const request: SuggestionRequest = {
  path: "src/a.rs",
  base: ["let n = 1;"],
  ours: ["let n = 2;"],
  theirs: ["let count = 1;"],
  before: ["fn a() {"],
  after: ["}"],
  oursSubject: "Two",
  theirsSubject: "Rename",
};

/** A platform whose TypeSafe answers `answers`, keeping each request's body. */
function typesafe(answers: Record<string, unknown>, status = 200) {
  const store = fakeKeyStore({ [JEV_ID]: "ts-key" });
  const sent: { url: string; authorization: string | null; body: Record<string, unknown> }[] = [];
  const fake = fakePlatform({
    commands: store.commands,
    fetch: (url, init) => {
      sent.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 2 } }, { status });
    },
  });
  return { fake, sent };
}

test("Jev is asked at TypeSafe with the key kept for it, its questions typed", async () => {
  const { fake, sent } = typesafe({ q: { type: "noul", noul: 0.9 } });

  const answered = await askJev(fake.platform, "state", { q: { type: "noul", instructions: "Is it?" } });

  expect(answered.answers.q).toEqual({ type: "noul", noul: 0.9 });
  expect(sent).toEqual([
    {
      url: `${JEV_API}/v1/systemone`,
      authorization: "Bearer ts-key",
      body: { model: "jev-latest", state: "state", questions: { q: { type: "noul", instructions: "Is it?" } } },
    },
  ]);
});

test("with no key kept, or a key refused, Jev says so, and sends nothing without one", async () => {
  const bare = fakePlatform({ commands: fakeKeyStore({}).commands });
  await expect(askJev(bare.platform, "s", {})).rejects.toMatchObject({ kind: "noKey" });
  expect(bare.fetches).toEqual([]);
  const { fake } = typesafe({}, 401);
  const refused = askJev(fake.platform, "s", {});
  await expect(refused).rejects.toBeInstanceOf(JevError);
  await expect(refused).rejects.toMatchObject({ kind: "keyRefused" });
});

test("Jev's three decisions ask about only what the disclosure lists, and read its typed answers", async () => {
  const verdict = typesafe({ keeps_both: { type: "noul", noul: 0.31 } });
  expect(await checkWithJev(verdict.fake.platform, request, { explanation: "", resolution: "let count = 2;", confidence: "high" })).toEqual({
    keepsBoth: 0.31,
  });
  expect(verdict.sent[0]!.body.state).toEqual({
    file: "src/a.rs",
    base: "let n = 1;",
    ours: "let n = 2;",
    theirs: "let count = 1;",
    resolution: "let count = 2;",
  });

  const triage = typesafe({
    resolution: { type: "choice", choice: "theirs", probabilities: { theirs: 0.81, ours: 0.19 }, confidence: 0.7 },
  });
  expect(await triageWithJev(triage.fake.platform, request)).toEqual({ triage: "theirs", probability: 0.81 });

  const commit = typesafe({
    secret: { type: "noul", noul: 0.93 },
    leftover: { type: "noul", noul: 0.1 },
    type: { type: "choice", choice: "fix", probabilities: { fix: 0.7 }, confidence: 0.6 },
  });
  expect(await checkCommitWithJev(commit.fake.platform, "+API_KEY=sk-live-1", "Fix it")).toEqual({
    secret: 0.93,
    leftover: 0.1,
    type: "fix",
  });
  expect(commit.sent[0]!.body.state).toEqual({ staged: "+API_KEY=sk-live-1", message: "Fix it" });
});
