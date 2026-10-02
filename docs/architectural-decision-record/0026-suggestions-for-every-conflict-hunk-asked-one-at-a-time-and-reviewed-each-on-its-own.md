# Suggestions for every Conflict Hunk in a file are asked one at a time and reviewed each on its own

The PRD says "Resolve all conflicts in file" produces Suggestions for every Conflict Hunk for review, not a silent bulk apply. No automatic application of AI output is allowed, and a low-Confidence Suggestion is never applied automatically (§8.1). ADR 0025 records the AI Suggestion Widget asking about one Conflict Hunk. This ADR records how the same Widget (`app/src/conflicts/SuggestionWidget.tsx`) asks about all of them.

## One action, one request at a time

"Suggest for all Conflict Hunks in this file" sits beside "Suggest a resolution". It is described by the same list of what's sent, and is turned down under the same conditions: while a request is running, or with no Conflict Hunks left. It asks about every Conflict Hunk left in the Resolution that doesn't already have a Suggestion shown. If each one has, it says so and sends nothing.

The requests go one at a time, in the order the Conflict Hunks come in the file, and never in parallel. This keeps the load on the user's key and rate limit to one request. It lets a failure stop the rest before they're sent, and makes Cancel's meaning plain. Before each request, `ResolutionHandle.find` finds that Conflict Hunk again by its sides (as `put` does, ADR 0025) in the Resolution as it is then. The request carries that text. So a Suggestion accepted, or a Conflict Hunk resolved by hand, while the rest are being asked about is part of the context sent for the next. A Conflict Hunk resolved in the meantime is skipped.

While it runs, the Widget shows a progress bar, "Asking for Suggestion 2 of 3, for Conflict Hunk 2 of 3, lines 11–18…". The bar has `role="progressbar"`, is labelled by that text, and gives how many have been asked as its value. Like Git's progress (`GitProgressBar`), it's filled in and never animated. Its start and its outcome are said in the status. Each Suggestion is shown as it arrives.

## Each Suggestion is reviewed on its own

Suggestions are shown in the order their Conflict Hunks come in the Resolution. Each one is exactly the Suggestion ADR 0025 shows, with its own AI-generated label, Confidence, low-Confidence flag and reasons, and its own Accept, Edit and Reject. None of them is put in the Resolution until the user presses one of these. There's no "Accept all", for low-Confidence Suggestions or any others. Asking for all of them only saves asking one by one; it never saves reviewing.

Each Suggestion's heading says where its Conflict Hunk is now, found again with `ResolutionHandle.find`. Once the first is accepted, the second is "Conflict Hunk 1 of 2" with its new lines. A Suggestion whose Conflict Hunk has been resolved since keeps the place it was asked for and says it can't be put in. Accept or Edit then says so as ADR 0025 does. Accepting or rejecting one moves focus to the next Suggestion's heading, or back to "Suggest a resolution" when none is left. Edit moves focus to the Resolution, as before. Each Resolution text region is named by its Suggestion's heading too, so several are told apart.

"Suggest a resolution" for a Conflict Hunk that already has a Suggestion shown replaces it.

## A failure partway through

`failsOnlyThisRequest` (`app/src/ai/requests.ts`) splits failures in two:

- **That Conflict Hunk's own**: the model declined, the Model Provider turned that request down, or its answer couldn't be read. These are said as "No Suggestion for Conflict Hunk 2 of 3, lines 11–18." and the reason, and the rest are still asked about.
- **Anything else**: AI refused to send (off, no key, a disclosure not accepted), the key was refused, too many requests, or the Model Provider wasn't reached or is overloaded. Each of these would fail the rest too, so asking stops there and says how many Conflict Hunks weren't asked about.

Either way, the Suggestions already made stay to be reviewed, and the failures are listed in one alert. Asking for all again asks only about the Conflict Hunks without a Suggestion. The status sums it up, such as "Asked about 3 Conflict Hunks: 1 Suggestion ready to review, each on its own; 1 failed; 1 not asked."

## Cancel

Cancel aborts the request running through its `AbortController` and asks nothing after it. What that request returns is dropped, as in ADR 0025. The Suggestions already made stay to review, and nothing is put in the Resolution. Choosing another file or leaving the Conflicts page stops it the same way.

## Consequences

- A file with many Conflict Hunks takes as long as its requests one after another. Being able to stop at the first failure, and one request's load on the user's rate limit, are worth more than the speed parallel requests would give.
- `requestSuggestion` still reads the model list for each request, as ADR 0025 has it, so asking about N Conflict Hunks makes N model-list requests as well.
- Suggestions shown aren't kept when the file changes or the page closes, as in ADR 0025.
- The tests (`SuggestionsForAll.test.tsx`) use the fake Model Provider with a file of three Conflict Hunks. They cover the order, the progress, that one request runs at a time, each Suggestion accepted, edited or rejected on its own, that there's no accept-all, a failure partway through of each kind, asking again, and Cancel partway through.

## Still to check by hand

- In the Desktop App with a real Model Provider and the user's own key: a file with several Conflict Hunks gets a Suggestion for each, one at a time. Cancel stops partway, and a rate limit partway stops the rest.
- Both themes and Windows' high-contrast mode show the progress bar and the line between Suggestions.
- With a screen reader (NVDA, VoiceOver): the progress bar is read with its label and value. The outcome and a failure partway are announced, and focus moving to the next Suggestion reads its heading.
