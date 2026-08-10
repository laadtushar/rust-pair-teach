# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install              # deps (a SessionStart hook does this automatically on web sessions)
npm run verify           # typecheck + lint + test — run this before committing
npm test                 # vitest, all suites
npm run build            # esbuild bundle -> dist/extension.js

npx vitest run test/detector.test.ts          # one file
npx vitest run -t 'fires once the diagnostic'  # one test by name
npx vitest                                     # watch mode
npx eslint src/core/detector.ts --config eslint.config.mjs
```

## What this project is

A VS Code extension that watches a learner write Rust and teaches with tiered hints — it
deliberately **never writes solution code**. The product thesis is in `README.md`; the full design
is in `docs/system-design.md`. Current state: Phase 1 (watch + detect + log). There is no LLM
integration, no UI, and no chapter-pack loader yet.

## Architecture

**`src/core/` is editor-agnostic and must never import `vscode`.** This is enforced by a
`no-restricted-imports` ESLint rule scoped to that directory, and it is not stylistic: the design
commits to extracting this core into a sidecar for Neovim/Zed and an eventual Rust rewrite. One
convenient `vscode` import there turns that extraction from a refactor into a rewrite. `npm run lint`
is the only thing guarding it.

**`src/vscode/extension.ts` is the only file that may import `vscode`.** It does no thinking — it
translates editor events into core calls, runs the tick loop, and writes decisions out.

Data flow: editor events → `EditStream` (snapshots, line-range diffs, churn buckets) →
`MomentDetector` (heuristics + cooldowns) → `CandidateDecision[]` → JSONL log.

### Time is always injected

Every heuristic here is temporal — diagnostic age, idle windows, churn windows, cooldowns, and later
multi-day score decay. **Nothing in `src/core` may call `Date.now()`**; `now` is a parameter on
`tick()`, `onEdit()`, and `onDiagnostics()`. This is what lets a 40-minute recorded session replay in
milliseconds, and it is the foundation of the whole test strategy. Breaking it silently makes the
timing behaviour untestable.

### Diagnostic identity is a signature, never a raw code

`DiagnosticSignature` is either `{kind: 'code'}` (rustc's `E0382`, a clippy lint, `TS2345`) or
`{kind: 'pattern'}` (a normalized message, for languages like Python and Go that have no stable
codes). Concept lookup, novelty detection, and cache keys all key on `signatureKey()`. Do not
reintroduce bare error-code strings — see `docs/language-extensibility.md` for why this shape exists.

### Suppressed decisions are recorded, not discarded

`MomentDetector.tick()` returns decisions that did *not* fire, with a `suppressedBy` reason. A
detector that stays silent through a genuine 20-minute struggle is as broken as one that chirps
constantly, and only the suppression record distinguishes "correctly quiet" from "asleep".

## Testing

Four layers, described fully in `docs/engineering-plan.md` §3. The one that matters most:

**Session replay (`test/sessions.test.ts`).** Recorded sessions in
`test/fixtures/sessions/*.jsonl` are replayed through the pure detector with a synthetic clock. Each
fixture encodes a hand-made judgement about *when the tutor should speak* — `quick-typo` must stay
silent, `idle-lunch` must fire exactly once across 40 minutes. This turns a subjective question into
a regression test, and makes retuning thresholds a reviewable diff rather than a gamble.

When changing a threshold in `src/core/config.ts`, expect replay assertions to shift. Investigate
which judgement flipped and why before updating the expectation — that diff *is* the pedagogy review.
The `no_activity_since_last_nudge` suppression rule exists because a replay fixture caught a double
nudge that reasoning had missed.

All threshold values in `config.ts` are provisional placeholders, to be replaced by numbers tuned
from real dogfooding logs.

## The bright line

`CONTRIBUTING.md` states it: **the teacher may build the classroom, never write the essay.** No
change should make the extension emit solution code, reveal a hint level the learner did not click
through to, or add a global "just fix it" mode. Skeletons with `todo!()` markers behind an explicit
per-action click are the only exception.

Related: chapter packs are **data, never code** — no JS hooks, no shell commands in checks. The check
vocabulary grows through reviewed extension releases instead.
