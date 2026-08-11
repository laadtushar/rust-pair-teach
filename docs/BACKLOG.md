# Backlog

Every ticket below is grounded in a fact verified against the tree at `573bbfc`, with the evidence
cited. Where something could not be verified from the code, it is in [Open questions](#open-questions)
rather than written as a ticket — a ticket built on a guess is worse than no ticket.

**Status legend** — `P0` blocks correctness or honesty, `P1` needed before anyone else uses it,
`P2` real value, `P3` speculative.
**Size** — `S` ≤ half a day, `M` 1–2 days, `L` 3–5 days, `XL` more than a week.

---

## Audit summary

| Finding | Evidence |
|---|---|
| Scaffolding code is unreachable at runtime | `generateSkeleton`, `generatedIsSkeletonOnly`, `allDone` imported by 0 files in `src/`; no reference in `src/vscode/` |
| `courseView` is now dead | Imported by 0 files after chat became the default surface |
| The provider is constructed twice | `extension.ts:88` and `extension.ts:92` both call `providerFromSettings` |
| Chat history is lost on reload | No `globalState` use in `src/core/chat/`; only the textarea draft is persisted (`sidebar.ts:159`) |
| Chat is invisible to the learner model | `recordEpisode`/`noteResolvedUnaided` reachable only from the detector (`extension.ts:181`) |
| Chat is invisible to telemetry | No `telemetry.*` call on any chat path |
| No spend guard exists | Design N2 promises a daily budget; no `budget`/`rateLimit` anywhere in `src/` |
| No response caching exists | Design §3.5 promises it; no cache in `src/` |
| No streaming | `openaiCompatible.ts` awaits the whole body |
| No integration test against real VS Code | `@vscode/test-electron` is not a dependency; no integration test file |
| Nothing has ever run in real VS Code | Only a stubbed `require()` smoke test |

---

## Epic A — Make the tree honest (P0)

Dead code and duplicate wiring make the codebase lie about what it does. These are cheap and
unblock accurate reasoning about everything else.

### A1 — Delete or wire the scaffolding module `P0` `S`

**Why.** `src/core/action/skeleton.ts` (102 lines) and its 17 tests pass, but nothing in
`src/vscode/` imports them. The test count implies a feature that does not exist at runtime.

**Decision required first** — see [Q1](#q1). Two mutually exclusive options:
- **A1a (wire it):** the tutor may create a file containing only `todo!()` bodies, on explicit
  per-action confirmation with a preview diff.
- **A1b (delete it):** remove `src/core/action/skeleton.ts` and `test/action.test.ts`'s skeleton
  half; keep `verify.ts`, which the course genuinely uses.

**Acceptance criteria (A1a).**
- A chat reply may propose a file; the sidebar shows path + full contents before anything is written.
- Nothing is written without a click. No global "always allow".
- `generatedIsSkeletonOnly` is asserted on the content *before* the preview is shown; a violation
  logs and shows nothing.
- Writes are confined to the workspace root — a path escaping it is rejected with a test proving it.
- **Files:** `src/vscode/extension.ts`, `src/vscode/sidebar.ts`, new `src/core/action/plan.ts`.
- **Tests:** path-escape rejection; refusal when content fails the skeleton check; no-write-without-confirm.

**Acceptance criteria (A1b).** `rg 'skeleton'` returns nothing outside git history; test count drops
by the corresponding number and the drop is stated in the commit message.

---

### A2 — Construct the provider once `P0` `S`

**Why.** `extension.ts:88` and `:92` each call `providerFromSettings`, so two
`OpenAiCompatibleProvider` instances exist, the output channel logs the provider line twice, and the
credential warning can fire twice on activation.

**Acceptance criteria.**
- `providerFromSettings` is called exactly once; the result is shared by `LessonEngine` and `TutorChat`.
- The `[provider]` line appears once per activation.
- **Files:** `src/vscode/extension.ts`.
- **Test:** not unit-testable without a VS Code stub; covered by A6's integration test asserting a
  single `[provider]` line in the output channel.

---

### A3 — Resolve the two competing surfaces `P0` `M`

**Why.** `extension.ts:231` branches: with a model configured, a fired moment goes to chat; without
one, it renders the old hint card (`:235`, `:259`). So there are two teaching UIs and which one a
learner sees depends on their config. `courseView` is now dead entirely.

**Decision required first** — see [Q2](#q2).

**Acceptance criteria.**
- Exactly one teaching surface reachable in a given configuration, documented in the README.
- Whatever is retired is deleted, not left dangling.
- If the card path is retired, `LessonEngine`, `staticHint`, `lessonView` and the hint-ladder tests
  are removed or explicitly repurposed — **note this deletes the offline-capable path**, which is
  why Q2 is a product decision, not a cleanup.

---

### A4 — Persist chat history across reloads `P0` `S`

**Why.** `TutorChat` holds history in memory only. Reloading the window — which the setup wizard
*tells you to do* — silently destroys the conversation.

**Acceptance criteria.**
- History survives window reload and VS Code restart.
- Storage is capped (proposal: last 200 messages, matching the existing in-memory cap at
  `tutorChat.ts` `push`).
- "Clear" wipes both memory and storage.
- Stored per workspace, not globally — a conversation about project A must not appear in project B.
- **Files:** `src/core/chat/tutorChat.ts` (accept an injected store), `src/vscode/extension.ts`.
- **Tests:** round-trip through a fake store; cap enforced; clear empties storage.

---

### A5 — Feed chat into the learner model and telemetry `P0` `M`

**Why.** The learner model is the product's differentiator and chat is now the primary surface, so
right now the differentiator is fed by a path most learners will not use. Telemetry likewise records
nothing about chat, meaning the Stage-1 validation instrument is blind to the main interaction.

**Acceptance criteria.**
- A resolved struggle discussed in chat records an episode with a concept id and a resolution.
- Telemetry counts: messages sent, proactive nudges by reason, redactions triggered, provider errors.
- `interpret()` gains a chat-aware reading, or explicitly states it cannot judge chat yet.
- **Blocked on** [Q3](#q3): how a chat exchange maps to a `Resolution`, which is not obvious and must
  not be invented.
- **Files:** `src/core/chat/tutorChat.ts`, `src/core/telemetry.ts`, `src/vscode/extension.ts`.

---

## Epic B — Make chat good enough to use daily (P1)

### B1 — Stream replies token by token `P1` `M`

**Why.** `openaiCompatible.ts` awaits the entire response. On a local 7B model a 400-token reply is
several seconds of a static "…". For a surface whose whole promise is conversation, that latency is
the product.

**Acceptance criteria.**
- `ProviderAdapter` gains an optional `stream()`; adapters without it fall back to `complete()`.
- Partial text renders as it arrives.
- The redaction rule (`limitCodeInReply`) is applied to the **final** text, and a partial code fence
  mid-stream is not shown as if it were complete.
- Cancelling mid-stream stops the request (see B2).
- **Files:** `src/core/provider/*`, `src/core/chat/tutorChat.ts`, `src/vscode/sidebar.ts`.
- **Tests:** fake streaming provider; assert progressive `onChanged` calls; assert redaction still
  applies at the end.
- **Risk:** the webview re-renders its whole HTML on each update (`sidebar.ts` `render`), which will
  destroy input focus at streaming frequency. **B1 depends on B4.**

---

### B2 — Cancel an in-flight reply `P1` `S`

**Why.** `TutorChat.busy` blocks new turns but nothing aborts the request. A learner who asks the
wrong question waits it out.

**Acceptance criteria.** A Stop button appears while busy; pressing it aborts the HTTP request via
the existing `AbortController` in `openaiCompatible.ts` and leaves the history consistent.

---

### B3 — Daily spend guard and response cache `P1` `M`

**Why.** Design N2 targets <$0.02 per teachable moment and §3.5 promises caching; neither exists.
Chat sends the full lesson context every turn, so cost per session is materially higher than the
design assumed, and a proactive nudge loop bug could bill unboundedly.

**Acceptance criteria.**
- Configurable daily call cap (proposal: 200), enforced in `TutorChat` and `LessonEngine`.
- On hitting the cap: a clear message, and the offline path still works if it still exists (see A3).
- Token usage accumulated from `Completion.usage` and visible in the telemetry command.
- **Not specified:** cache key design for conversational turns — see [Q4](#q4).

---

### B4 — Stop re-rendering the whole webview `P1` `M`

**Why.** `TutorSidebar.render` reassigns `webview.html` on every change. Every file save and every
message rebuilds the DOM, which is why a draft-restore hack exists (`sidebar.ts:157`). It will not
survive streaming.

**Acceptance criteria.**
- HTML is set once; updates go through `postMessage` and are applied by script.
- Input focus, caret position, scroll position and draft survive updates without the state hack.
- CSP stays as strict as it is now.
- **Blocks:** B1.

---

### B5 — Handle context that exceeds the model's window `P1` `S`

**Why.** `buildChatPrompt` sends the persona, the full lesson steps, a 60-line code region and up to
12 turns, unbounded in total. A small local model with a 4k window will silently truncate or error.

**Acceptance criteria.** Estimate prompt size; degrade in a defined order (drop oldest turns, then
narrow the code region) before sending; log when it happens. A test asserts the ordering.

---

## Epic C — Verify it actually works (P1)

### C1 — Integration test in real VS Code `P1` `L`

**Why.** Nothing in this project has ever run inside VS Code. The current smoke test stubs the
`vscode` module, which proves the bundle parses and nothing else. Every UI claim in the README is
unverified.

**Acceptance criteria.**
- `@vscode/test-electron` runs a headless VS Code in CI.
- Covers: activation without a workspace; activation with a Rust workspace; the sidebar renders;
  a message round-trips through a stub provider; `Set up a teaching model` completes; settings write
  and read back.
- Runs on Linux CI; documented as also runnable locally.
- **Risk:** headless VS Code in CI is fiddly and can be flaky. Time-box to `L`; if it exceeds that,
  fall back to C2 and re-scope.

### C2 — Written manual test script `P1` `S`

**Why.** Until C1 exists, "did we break it" has no answer. Cheap, immediate, and useful regardless.

**Acceptance criteria.** `docs/manual-test.md`: numbered steps from a clean install to each feature,
with expected observable results. Executed once against the current build and the results recorded,
including failures.

### C3 — Model conformance run `P2` `M`

**Why.** The engineering plan §3.4 specifies this and it has never run. "Levels 1–2 work on small
local models" is an untested claim, and the chat persona is far harder to follow than the old JSON
contract.

**Acceptance criteria.** A script running a fixed prompt suite against configured providers,
reporting per model: JSON validity (engine path), persona adherence, brevity, and redaction rate.
Results published in the README as a compatibility table. Manually triggered, never in PR CI.

---

## Epic D — Content and pedagogy (P2)

### D1 — Lessons 9–16 `P2` `L`

**Why.** The course stops at tests. A learner who finishes has no path onward, and the README claims
"from scratch" while covering only the first third of a typical Rust introduction.

Proposed, in order: collections (`Vec`/`HashMap` in anger) → strings and `&str` vs `String` →
error handling with `?` → traits → generics → iterators and closures → modules and visibility →
a small end-to-end CLI project.

**Acceptance criteria.** Each lesson follows the existing front-matter schema; each has ≥3 steps with
working checks; each names the concepts it exercises; `test/course.test.ts` extended to assert the
new ordering and that every lesson's checks are satisfiable.

### D2 — Concept entries for every error code the lessons can produce `P2` `M`

**Why.** `session.ts` returns `no_concept` and stays silent for unmapped codes. The lessons
deliberately provoke E0384, E0425, E0601, E0308 — verified present in the course pack's concept
front-matter — but a learner will hit far more than that, and each unmapped code is a moment of
silence exactly when help was wanted.

**Acceptance criteria.** Coverage for at least the 25 most common beginner codes. A test enumerates
codes referenced anywhere in `packs/` and asserts each maps to a concept.

### D3 — Adaptive lesson ordering `P3` `M`

**Why.** The course is a fixed sequence; the learner model knows what someone is bad at and is not
consulted. Speculative until the model has real data.

---

## Epic E — Distribution (P1)

### E1 — Unblock the release `P1` `S`

**Why.** Both tag push and `workflow_dispatch` return HTTP 403 from the session token. No release
exists despite the pipeline being built and locally verified.

**Acceptance criteria.** One release published. Either the repo owner runs the workflow manually, or
a PAT with `contents: write` is added as a secret and the workflow uses it.
**Owner: repo owner, not implementable from a session.**

### E2 — Marketplace publish `P2` `M`

**Why.** Distribution is currently "a file someone sends you". Requires a real publisher identity.
**Blocked on** [Q5](#q5).

### E3 — Chapter registry `P3` `L`

**Why.** Design §3.8 specifies a static JSON index plus signed tarballs. Only bundled packs exist.
Not worth building before there is a second author.

---

## Epic F — Correctness risks found in review (P1)

### F1 — Verify Windows path handling `P1` `S`

**Why.** `workspaceView` builds paths with `vscode.Uri.joinPath(root, 'src/main.rs')` and lesson
checks use forward-slash literals. This is *believed* fine because `Uri.joinPath` normalises, but it
has never been executed on Windows.

**Acceptance criteria.** Confirmed on Windows, or a normalisation layer added with tests. Do not
close this by reasoning alone.

### F2 — Bound the proactive nudge loop `P1` `S`

**Why.** `reactToProgress` fires on every save, and `nudge` dedupes only on the immediately previous
`(reason, key)`. Alternating between two events (save → error appears → save → error clears) could
produce a nudge on every save. Not observed — unverifiable without real use — but structurally
possible.

**Acceptance criteria.** A minimum interval between proactive nudges regardless of reason, reusing
the interruption budget from `config.ts`. A test drives alternating events and asserts the cap holds.

### F3 — Decide what happens with no workspace open `P1` `S`

**Why.** `workspaceView` returns `exists: () => false` when there is no workspace folder, so every
lesson step reads as incomplete and the tutor may confidently discuss a project that does not exist.

**Acceptance criteria.** With no folder open, the tutor says so and offers to walk through
`cargo new` first. A test covers the empty-workspace context.

---

## Open questions

These block the tickets that reference them. Each needs a human decision or an experiment; none
should be guessed.

### Q1 — Should the tutor ever write files?
Blocks **A1**. The design says yes, narrowly (skeletons behind explicit confirmation). The chat
pivot did not revisit it. Writing files is the largest single step toward the autocomplete pattern
this product defines itself against.

### Q2 — Is the offline path still a requirement?
Blocks **A3**. Chat requires a model. Retiring the card path means the extension does nothing useful
without one — which contradicts the current README and changelog, and removes the "works with no AI
at all" property that made it usable on a plane. Keeping both means maintaining two teaching
surfaces indefinitely.

### Q3 — What is a "resolution" in a conversation?
Blocks **A5**. In the card model it was unambiguous: the learner clicked *I solved it*, or the
diagnostic cleared. In chat there is no such click. Options: infer from the diagnostic clearing
while a chat about it is open; ask the model to classify; add explicit buttons. Each has a different
accuracy profile and none is obviously right.

### Q4 — Can conversational turns be cached at all?
Blocks half of **B3**. The existing design caches on (error code, code shape, hint level). A chat
turn depends on the whole history, so cache hits will be rare. Possibly the honest answer is that
caching does not apply to chat and only the spend cap does.

### Q5 — Under what identity does this publish?
Blocks **E2**. `package.json` claims `publisher: laadtushar`, which has not been verified to exist
on the Marketplace. Also unresolved: the extension is still named `rust-pair-teacher` while the repo
is `rust-pair-teach`, and the docs still call the product "BorrowSensei (placeholder)".

### Q6 — What are the real threshold values?
Affects **F2** and the detector's whole configuration. Every number in `config.ts` is a guess. The
instrument to answer this exists (the candidate log) and has never been run against real use. This
remains the single largest unvalidated assumption in the project.

---

## Suggested order

1. **A2, A4** — small, no decisions needed, immediately reduce harm.
2. **C2** — write and run the manual script; it will find bugs the audit could not.
3. **Q1, Q2, Q3** — decide, since A1, A3 and A5 are all blocked on them.
4. **B4 → B1 → B2** — the chat quality chain, in dependency order.
5. **C1** — integration testing, once the surface has stopped moving.
6. **F1, F2, F3** — correctness risks.
7. **D1, D2** — content, which is the moat but only once the vehicle is sound.
8. **E1** whenever the owner is available; it is not blocked by anything technical.
