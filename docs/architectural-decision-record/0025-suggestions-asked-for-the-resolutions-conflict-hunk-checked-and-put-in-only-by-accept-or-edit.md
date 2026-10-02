# Suggestions are asked for the Resolution's Conflict Hunk, checked, and put in only by Accept or Edit

The PRD says the Conflicts page has an AI Suggestion for the selected Conflict Hunk. The request carries the Base, Ours and Theirs, 20 lines of context above and below, the file's path and both commit subjects. The Suggestion shows its Resolution text, a short explanation and a Confidence, and it's clearly labelled as AI-generated. Confidence is the model's own report, made low when the Resolution text fails a check, and a low Confidence is flagged prominently. Accept copies the Suggestion into the Resolution, Edit copies it in to be edited, and Reject dismisses it. Nothing reaches the working tree without one of them (§8.1). ADR 0020 records how a request reaches a Model Provider, and ADR 0018 the Resolution. This ADR records the AI Suggestion Widget (`app/src/conflicts/SuggestionWidget.tsx`) that sits between them.

## One Widget, beside the Resolution

The AI Suggestion is a Widget on the Conflicts page's Grid (ADR 0004, `CONFLICTS_WIDGETS`). Like the Three-way view and the Resolution, it's empty, and listed in the Grid menu as "(empty)", until a file is chosen in Conflicted files. With a file chosen, it says one of these:

- **AI is off**: nothing is sent to any Model Provider, and here's how to turn it on (Settings in the title bar, "Suggest Resolutions with AI", a Model Provider and model, and the user's own API key). No request is made, not even for the model catalog.
- **The file is resolved as a whole** (ADR 0019): there's no Suggestion for it.
- **Otherwise**: which Conflict Hunk a Suggestion would be for, what's sent to the chosen Model Provider, and "Suggest a resolution".

## A Suggestion is for the Conflict Hunk the Resolution's choices act on

The Resolution Widget reports two things up to the Conflicts page, which hands them to the AI Suggestion:

- `onHunk` gives where the Conflict Hunk is: the one the cursor is in, or the next one, the same Conflict Hunk that Accept Ours and Next conflict act on. It's reported only when that changes, so the AI Suggestion can say "For Conflict Hunk 1 of 2, lines 26–33, where the Resolution is." and F7 moves both.
- `onEditor` gives a `ResolutionHandle`. `current()` reads the Resolution's text and that Conflict Hunk as they are at that moment. `put()` puts a Suggestion in.

The handle is passed up as state, not through a ref, so the Resolution's editor stays the only thing that changes its text.

"Suggest a resolution" builds the request with `suggestionRequest` (ADR 0020) from the Resolution as it is. That gives the Conflict Hunk's Base, Ours and Theirs, the context lines Settings sets (20 by default), the path, and the commit subjects `conflictedFile` read for each side. What's sent is listed beside the button, from the same `sentForASuggestion` the First-use disclosure uses, and the button is described by that list. So the list and the request can't differ. `requestSuggestion` is given the platform, the Model Providers, the settings and the model catalog through one `AiAccess` built in `App`. The catalog source moved up from Settings to `App` for this, so both share it.

## Confidence is the model's, unless the text fails a check

Every Suggestion is run through `checkSuggestion` (`app/src/ai/confidence.ts`) before it's shown. Its Confidence is the one the model reported unless the Resolution text:

- still has Conflict Markers, where a lone `=======` counts only if neither side nor the Base has one,
- is empty, or only blank lines, or
- leaves out a line only Ours or only Theirs has, comparing trimmed lines without blank ones.

In any of those cases it's low. A low Confidence is shown with a warning icon and bold text. A problem box above the Resolution text says the model's own Confidence, then each check that failed and, for dropped lines, which side's lines they were. With every check passed and a low Confidence reported, it says the model wasn't sure. Everything shown is labelled AI-generated in the Suggestion's heading and says which Model Provider made it. The status that announces it says the Confidence too.

## Only Accept or Edit changes the Resolution, and only Mark resolved writes it

- **Accept** puts the Resolution text in place of the Conflict Hunk it was asked for.
- **Edit** puts it in, selects it and moves focus to the Resolution to change it.
- **Reject** dismisses it and leaves the Resolution as it was.

Accept and Edit go through `ResolutionHandle.put`. This finds the Conflict Hunk again with `sameHunk`: in the text as it is now, one with the same Ours, Base and Theirs, nearest where it was. `putSuggestion` then replaces it as one change in the editor's history, so Undo takes it back as it would a choice. If that Conflict Hunk is no longer there, because it was resolved some other way in the meantime, nothing is put in and the Widget says so.

None of these writes the working tree. A Suggestion only ever reaches the Resolution, which stays a draft until Mark resolved writes it and runs `git add` (ADR 0018). Mark resolved still refuses Conflict Markers left in, so an accepted Suggestion that has them is caught there too.

## Cancel, and leaving, stop the request

Each request has its own `AbortController`, whose signal `requestSuggestion` passes to the adapter's `fetch`. Cancel aborts it and says nothing was put in. Choosing another file, which draws the Widget afresh, and closing the Conflicts page abort it too. Once a request has been aborted, whatever it returns, answer or failure, is dropped, so a late Suggestion never appears after Cancel. A failure is shown as an alert in the words `aiFailureWords` uses in Settings, such as no key kept, the key refused, the Model Provider limiting requests or not reached, or an answer that isn't a Suggestion.

## Consequences

- A Suggestion is for the Resolution's text at the moment it's asked. Edits made while it's running aren't sent, and Accept finds the Conflict Hunk by its sides, not its line numbers, so edits elsewhere in the file don't stop it.
- A Suggestion isn't kept when the file changes or the page closes. It's asked again.
- One Suggestion is asked at a time. Asking again while one is running is turned down until it's cancelled or answered. Suggest for all Conflict Hunks in this file asks for each in turn (ADR 0026).
- The tests use the fake Model Provider (`app/src/test/fakeModelProvider.ts`), never a real one. They check the exact request body, each Confidence check, Accept, Edit, Reject, Cancel and the failures (`Suggestion.test.tsx`).

## Still to check by hand

- In the Desktop App with a real Model Provider and the user's own key: a Suggestion comes back for a merge, a rebase and a stash apply. Accept, Edit and Reject change the Resolution as expected, and Cancel stops a slow request with nothing shown after.
- Both themes and Windows' high-contrast mode show the AI-generated label, the low-Confidence warning and the Resolution text's border and focus.
- With a screen reader (NVDA, VoiceOver): "Suggest a resolution" is read with what's sent. The Suggestion's arrival, its Confidence, and Accept, Edit, Reject and Cancel are announced, and a failure is read as an alert.
