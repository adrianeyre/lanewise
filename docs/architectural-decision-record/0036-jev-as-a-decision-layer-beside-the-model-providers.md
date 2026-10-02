# Jev as a decision layer beside the Model Providers

The owner asked for TypeSafe AI's Jev to take part in Lanewise's decisions. Jev is a "System One" model in limited early access since 15 September 2026: it answers typed questions about a block of state, a yes-or-no's probability, a choice with its probabilities, or a score, rather than writing text (`docs/research/jev-ai.md` has its API and where each fact comes from). It isn't a Model Provider, which writes Suggestions (ADR 0020, PRD §8.2), so it sits beside them.

## What Jev decides

Each only while Jev is on in Settings, and each can be turned off on its own. None acts: the user does (CLAUDE.md's AI rule).

- **How far to trust a Suggestion.** After each Suggestion, Jev is asked whether its Resolution text keeps what both sides meant. Its answer is shown beside the Confidence, and below 50% it's a failed check (`jevDoubts`), which makes the Confidence low, as a Suggestion that drops a side's lines already is.
- **Which side a Conflict Hunk takes.** Ask Jev which side picks Ours, Theirs, both either way round, or "needs a person", with its probability. Use puts that in the Resolution as one change undo takes back; the hint alone changes nothing.
- **Whether staged changes are fit to commit.** Before a commit, and on Check with Jev, Jev is asked whether the staged diff holds a secret or a leftover, and which Conventional Commit type it is. A likely secret or leftover stops the commit only to say so, with Commit anyway; the type is offered as a button that starts the subject with it.

## How it's asked

- `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, through the platform's `fetch`, like a Model Provider's (ADR 0020). `https://api.typesafe.ai` joins the HTTP allow-list.
- With the user's own TypeSafe API key, kept in the OS credential store under `typesafe-jev`, as a Model Provider's key is.
- Or through a gateway kept for `typesafe-jev` (ADR 0035), such as Vercel AI Gateway's TypeSafe route, `https://ai-gateway.vercel.sh/typesafe`, with its own key as the gateway's `Authorization` header.
- What's sent is listed in Settings, where Jev is turned on: the Conflict Hunk's sides and the Suggestion; the Conflict Hunk and the lines round it; the staged diff, cut to about 60,000 characters, and the Commit Message. `lanewise.jev` keeps whether it's on, in the Cookie Policy.

## Considered options

- **Jev as another Model Provider.** Rejected: it writes no Suggestion, and its answers are typed, not text.
- **The AI SDK's `experimental_evaluate`.** Not yet: it would add the AI SDK for one call the platform's `fetch` makes as simply.

## Still to check by hand

With a real TypeSafe key: each decision's answers on the Evaluation corpus (ADR 0027), and whether 50% is the right doubt for a Suggestion.
