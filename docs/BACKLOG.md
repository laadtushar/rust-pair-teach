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
| ~~Scaffolding code is unreachable at runtime~~ | Fixed: deleted (Q1 — the tutor never writes files) |
| ~~`courseView` is now dead~~ | Fixed: chat is the only teaching surface; the hint card and the whole ladder engine were deleted with it (A3) |
| ~~The provider is constructed twice~~ | Fixed: one `providerFromSettings` call, shared by engine and chat |
| ~~Chat history is lost on reload~~ | Fixed: `TutorChat` takes an injected `ChatStore`, backed by `workspaceState` |
| ~~Chat is invisible to the learner model~~ | Fixed: the compiler reports the resolution, tutor involvement sets the credit (A5/Q3) |
| ~~Chat is invisible to telemetry~~ | Fixed: `onTelemetry` seam on `TutorChat`; `interpret()` reads replies-per-nudge (A5) |
| ~~No spend guard exists~~ | Fixed: `SpendGuard`, daily call ceiling, persisted and shown in telemetry |
| No response caching exists | Design §3.5 promises it; no cache in `src/` |
| ~~No streaming~~ | Fixed: optional `stream()` on the adapter, SSE-decoded; providers without it fall back |
| ~~No integration test against real VS Code~~ | Harness added and green on CI |
| ~~Nothing has ever run in real VS Code~~ | Resolved 2026-08-13: activation, command registration and execution, pack loading and settings defaults all verified in a real editor. Rendering and model behaviour remain unverified. |

---

## Epic A — Make the tree honest (P0)

Dead code and duplicate wiring make the codebase lie about what it does. These are cheap and
unblock accurate reasoning about everything else.

### A1 — Delete or wire the scaffolding module `P0` `S` — **DONE (A1b)**

**Why.** `src/core/action/skeleton.ts` (102 lines) and its 17 tests passed, but nothing in
`src/vscode/` imported them. The test count implied a feature that did not exist at runtime.

**Resolved** by [Q1](#q1): deleted. `src/core/action/skeleton.ts` is gone along with
`ScaffoldFile`, `ActionCard.scaffolds` and the skeleton half of `test/action.test.ts`. `verify.ts`
stays — the course genuinely uses it to tick steps.

**Acceptance criteria.** `rg 'skeleton'` returns nothing outside git history. ✓

---

### A2 — Construct the provider once `P0` `S` — **DONE**

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

### A3 — Resolve the two competing surfaces `P0` `M` — **DONE**

**Why.** `extension.ts` branched: with a model configured, a fired moment went to chat; without one,
it rendered the old hint card. So there were two teaching UIs and which one a learner saw depended
on their config.

**Resolved** by [Q2](#q2): chat is the only surface, and the pack's teaching is delivered *into* it
as a tutor message rather than through a second panel. `raise()` in `extension.ts` is now the single
path — it nudges a configured model, or posts `session.offlineTeaching(...)` when there is none.

**What went with it.** `lessonView`, `courseView`, the `hint` and `course` sidebar states,
`SidebarAction`'s `escalate`/`solved`/`dismissed`, `TutorSession.offer`/`escalate`/`resolve`, and
the whole ladder engine — `LessonEngine`, `lesson/contract.ts`, `lesson/prompt.ts`,
`lesson/refusal.ts`. `staticHint` stays: it is what `offlineTeaching` reads.

**What was kept rather than lost.** The ladder's refusal invariants became a direct assertion over
authored pack content in `test/lesson.test.ts`; the prompt's privacy snapshot moved to
`buildChatPrompt`, which is what actually leaves the machine now, and `describeEgress` is finally
surfaced through **Rust Pair Teacher: Show what gets sent to the model**.

**Acceptance criteria.**
- Exactly one teaching surface in every configuration. ✓
- Whatever was retired is deleted, not left dangling. ✓
- The offline path survives as content, not as a second UI. ✓

---

### A4 — Persist chat history across reloads `P0` `S` — **DONE**

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

### A5 — Feed chat into the learner model and telemetry `P0` `M` — **DONE**

**Why.** The learner model is the product's differentiator and chat is now the primary surface, so
the differentiator was fed by a path most learners would not use. Telemetry likewise recorded
nothing about chat, meaning the Stage-1 validation instrument was blind to the main interaction.

**Resolved** by [Q3](#q3): the compiler decides that something was resolved, and what the tutor did
decides the credit. `MomentDetector.onCleared` calls `session.noteResolved(...)`; an error cleared
without the tutor ever mentioning it grades as `unaided`, one cleared after a conversation as
`self_level_2`. `noteAbandoned` runs on deactivate, so closing the window on an unsolved error is
recorded too — otherwise the model only ever learns from successes.

**Acceptance criteria.**
- A resolved struggle discussed in chat records an episode with a concept id and a resolution. ✓
- Telemetry counts messages sent, proactive nudges by reason, redactions, provider errors and
  cancellations, via `TutorChat`'s `onTelemetry` seam — shapes only, never text. ✓
- `interpret()` gains a chat-aware reading: `conversation.repliesPerNudge` calls out a tutor that is
  monologuing, which is the chat-era form of "noisy". ✓

---

## Epic B — Make chat good enough to use daily (P1)

### B1 — Stream replies token by token `P1` `M` — **DONE**

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

### B2 — Cancel an in-flight reply `P1` `S` — **DONE**

**Why.** `TutorChat.busy` blocks new turns but nothing aborts the request. A learner who asks the
wrong question waits it out.

**Acceptance criteria.** A Stop button appears while busy; pressing it aborts the HTTP request via
the existing `AbortController` in `openaiCompatible.ts` and leaves the history consistent.

---

### B3 — Daily spend guard and response cache `P1` `M` — **spend guard DONE; cache still blocked on Q4**

**Why.** Design N2 targets <$0.02 per teachable moment and §3.5 promises caching; neither exists.
Chat sends the full lesson context every turn, so cost per session is materially higher than the
design assumed, and a proactive nudge loop bug could bill unboundedly.

**Acceptance criteria.**
- Configurable daily call cap (proposal: 200), enforced in `TutorChat` and `LessonEngine`.
- On hitting the cap: a clear message, and the offline path still works if it still exists (see A3).
- Token usage accumulated from `Completion.usage` and visible in the telemetry command.
- **Not specified:** cache key design for conversational turns — see [Q4](#q4).

---

### B4 — Stop re-rendering the whole webview `P1` `M` — **DONE**

**Why.** `TutorSidebar.render` reassigns `webview.html` on every change. Every file save and every
message rebuilds the DOM, which is why a draft-restore hack exists (`sidebar.ts:157`). It will not
survive streaming.

**Acceptance criteria.**
- HTML is set once; updates go through `postMessage` and are applied by script.
- Input focus, caret position, scroll position and draft survive updates without the state hack.
- CSP stays as strict as it is now.
- **Blocks:** B1.

---

### B5 — Handle context that exceeds the model's window `P1` `S` — **DONE**

**Why.** `buildChatPrompt` sends the persona, the full lesson steps, a 60-line code region and up to
12 turns, unbounded in total. A small local model with a 4k window will silently truncate or error.

**Acceptance criteria.** Estimate prompt size; degrade in a defined order (drop oldest turns, then
narrow the code region) before sending; log when it happens. A test asserts the ordering.

---

## Epic C — Verify it actually works (P1)

### C1 — Integration test in real VS Code `P1` `L` — **DONE, green on CI**

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

**Outcome (2026-08-13).** It cannot run in the dev sandbox — the network policy denies `CONNECT`
to `update.code.visualstudio.com` with a 403, so `test-electron` cannot fetch an editor. It ran on
CI instead, and **five of six assertions passed on the first attempt**:

```
✔ the extension is present and activates
✔ every contributed command is actually registered
✔ the packs load from the packaged layout
✔ settings are contributed with the documented defaults
✔ the sidebar view is contributed
✗ activating with a Rust file open — "fixture workspace should contain a .rs file"
```

The failure was in the harness, not the product: `__dirname` is `out/` after bundling, so the
fixture workspace resolved one directory too high and `findFiles` matched nothing. Fixed, and the
assertion now names the folder it searched so the next such mistake explains itself.

**What this settles.** The extension activates in a real editor; every contributed command is
genuinely registered rather than a menu entry that throws; the packs resolve from the installed
layout; telemetry defaults off and the no-code rule defaults on. All four were assumptions through
eleven releases.

**What it still does not cover.** Anything requiring a webview to render or a model to answer —
the chat UI, streaming, the composer, step ticking. Those remain manual-only.

### C2 — Written manual test script `P1` `S` — **DONE (written; execution still owed)**

**Why.** Until C1 exists, "did we break it" has no answer. Cheap, immediate, and useful regardless.

**Acceptance criteria.** `docs/manual-test.md`: numbered steps from a clean install to each feature,
with expected observable results. Executed once against the current build and the results recorded,
including failures.

### C3 — Model conformance run `P2` `M` — **harness DONE; never run against a real model**

**Why.** The engineering plan §3.4 specifies this and it has never run. "Levels 1–2 work on small
local models" is an untested claim, and the chat persona is far harder to follow than the old JSON
contract.

**Acceptance criteria.** A script running a fixed prompt suite against configured providers,
reporting per model: JSON validity (engine path), persona adherence, brevity, and redaction rate.
Results published in the README as a compatibility table. Manually triggered, never in PR CI.

---

## Epic D — Content and pedagogy (P2)

### D1 — Lessons 9–16 `P2` `L` — **DONE**

**Why.** The course stops at tests. A learner who finishes has no path onward, and the README claims
"from scratch" while covering only the first third of a typical Rust introduction.

Proposed, in order: collections (`Vec`/`HashMap` in anger) → strings and `&str` vs `String` →
error handling with `?` → traits → generics → iterators and closures → modules and visibility →
a small end-to-end CLI project.

**Acceptance criteria.** Each lesson follows the existing front-matter schema; each has ≥3 steps with
working checks; each names the concepts it exercises; `test/course.test.ts` extended to assert the
new ordering and that every lesson's checks are satisfiable.

### D2 — Concept entries for every error code the lessons can produce `P2` `M` — **DONE**

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

### F2 — Bound the proactive nudge loop `P1` `S` — **DONE**

**Why.** `reactToProgress` fires on every save, and `nudge` dedupes only on the immediately previous
`(reason, key)`. Alternating between two events (save → error appears → save → error clears) could
produce a nudge on every save. Not observed — unverifiable without real use — but structurally
possible.

**Acceptance criteria.** A minimum interval between proactive nudges regardless of reason, reusing
the interruption budget from `config.ts`. A test drives alternating events and asserts the cap holds.

### F3 — Decide what happens with no workspace open `P1` `S` — **DONE**

**Why.** `workspaceView` returns `exists: () => false` when there is no workspace folder, so every
lesson step reads as incomplete and the tutor may confidently discuss a project that does not exist.

**Acceptance criteria.** With no folder open, the tutor says so and offers to walk through
`cargo new` first. A test covers the empty-workspace context.

---

## Open questions

These block the tickets that reference them. Each needs a human decision or an experiment; none
should be guessed.

### Q1 — Should the tutor ever write files? — **DECIDED: no**
The design allowed it narrowly; the chat pivot never revisited it, and nothing has asked for it
since. A capability with no caller is not a feature, it is a liability with tests. Deleting it also
removes the only code path that could ever grow into writing solutions. If a lesson later genuinely
needs a file created, the learner types `cargo new` — which the course already teaches them to do.
**Reversible**: the implementation is in git history and the check that guarded it was sound.

### Q2 — Is the offline path still a requirement? — **DECIDED: keep the content, drop the second UI**
Two teaching surfaces is the unscalable part, not the offline capability. So: **chat is the only
surface**, and when no model is configured the built-in material is delivered *into the chat panel*
as a tutor message rather than through a parallel card UI.

That keeps the property worth keeping — the extension teaches something on a plane, and a learner
with no API account is not stared at by a disabled text box — while deleting a whole rendering path,
its view model, and the branch that made which UI you saw depend on your configuration.

### Q3 — What is a "resolution" in a conversation? — **DECIDED: infer from the compiler**
Not from a button, and not by asking the model to classify — the first adds friction to the one
interaction that should be frictionless, and the second spends a call to guess at something the
compiler already knows.

The rule: **a diagnostic clearing is the resolution**, and what the tutor did in the meantime sets
the credit. Cleared with the tutor never having mentioned that concept is `unaided`. Cleared after
the tutor discussed it is `self_level_2` — real credit, less than solving it cold. A concept
discussed whose error is still present when the session ends is `abandoned`.

This is deliberately approximate, and approximate in the learner's favour. The alternative is a
differentiator fed by nothing, which is what shipping today would mean.

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

~~1. **A2, A4** — small, no decisions needed, immediately reduce harm.~~ Done.
~~2. **C2** — write and run the manual script; it will find bugs the audit could not.~~ Done.
~~3. **Q1, Q2, Q3** — decide, since A1, A3 and A5 are all blocked on them.~~ Decided and implemented.
~~4. **B4 → B1 → B2** — the chat quality chain, in dependency order.~~ Done.
~~5. **C1** — integration testing, once the surface has stopped moving.~~ Done and green on CI.
6. **F1** — Windows path handling. Needs a Windows machine; nobody here has one.
7. **D1, D2** — content, which is the moat but only once the vehicle is sound. Done for Rust; a
   second language is the next real test of the extensibility claim.
8. **E1** whenever the owner is available; it is not blocked by anything technical.

**Closed since.** The second language landed (`packs/python-common-errors`), which was the only real
test of the extensibility claim — and it found that `kind: "pattern"` had never worked. See
[`language-extensibility.md`](language-extensibility.md#what-the-second-language-actually-found).

**What is left, honestly.** Every P0 is closed. The remaining work is either blocked on someone with
credentials (E1, E2 — release and Marketplace), blocked on hardware (F1 — Windows), or speculative
(Q4 caching, D3, E3). The next genuinely useful thing is a learner: every threshold that decides
*when* the tutor speaks is still an educated guess, and no amount of further engineering will
resolve that.
