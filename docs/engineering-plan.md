# Engineering plan: design → build → verify → ship → learn

How this gets implemented end to end. The product design lives in
[system-design.md](system-design.md); this document is about *execution* — module boundaries,
how something this subjective gets tested, what CI enforces, how it ships, and what closes the loop
back to design.

## 0. The unusual engineering problem

Most of this system is ordinary TypeScript. Two things are not, and they shape every decision below:

1. **The core correctness question is subjective.** "Did the tutor interrupt at the right moment?"
   has no assertion. A detector that fires 40 times an hour and one that stays silent through a
   20-minute struggle are both broken, and no unit test written in advance knows the difference.
2. **A dependency is nondeterministic and user-chosen.** The LLM is swappable across providers of
   wildly varying quality, by configuration, at runtime. CI cannot call it, and "works on my model"
   is not a release criterion.

The answers, developed in §3: **record real sessions and replay them as fixtures** to make timing
regressions catchable, and **split LLM testing into a deterministic contract suite that runs in CI
and a manual conformance suite that runs against real providers.**

## 1. Phases and exit criteria

Each phase has an exit criterion that is a *fact about the world*, not a checklist of merged PRs.
Phases do not overlap; the point of the ordering is that each one can kill the project cheaply.

| Phase | Builds | Exit criterion |
|---|---|---|
| **P0 — Skeleton** | Repo, toolchain, CI, core/adapter boundary, clock injection | `npm ci && npm test && npm run package` is green on a clean checkout |
| **P1 — Watch** | Edit Stream, diagnostics reader, Moment Detector, candidate log. **No LLM, no UI.** | Author dogfoods 5+ hours of real Rust; the candidate log is reviewable and the thresholds have been tuned at least once from it |
| **P2 — Teach** | Chapter pack loader, pack zero (7 borrow-checker codes), Lesson Engine, provider adapter, sidebar | A hint renders in < 5s on OpenRouter *and* on local Ollama, and degrades to static text with the network off |
| **P3 — Remember** | Learner model, hint ladder buttons, resolution tracking, you-do-it action cards | Concept scores move correctly across a simulated 2-week history replay |
| **P4 — Ship** | Marketplace listing, opt-in telemetry export, docs | 20–50 recruited learners installed; the two validation questions are instrumented |
| **P5 — Learn** | Nothing new | A go/no-go decision, made from P4 data, on ambient-vs-on-demand |

**P1 is the real gate.** It is deliberately the cheapest phase to build and the most likely to
invalidate the product. Building P2 before P1's dogfooding is complete is the single most expensive
mistake available here, because every part of P2 is wasted if the trigger timing is wrong.

## 2. Module structure

```
src/
  core/          # editor-agnostic. MUST NOT import 'vscode'. This is the future sidecar.
    types.ts         DiagnosticSignature, EditEvent, Candidate, …
    clock.ts         injectable time — the reason any of this is testable
    config.ts        thresholds, all named and defaulted in one place
    signature.ts     diagnostic -> DiagnosticSignature normalization
    editStream.ts    snapshots, line-range diffs, churn buckets
    detector.ts      heuristics + cooldowns -> Candidate decisions
    log.ts           JSONL candidate-decision records
  vscode/        # thin adapter. The only place 'vscode' is imported.
    extension.ts     activate(): wires editor events into core
    diagnostics.ts   vscode.Diagnostic -> core observation
    logSink.ts       writes to globalStorageUri
test/
  *.test.ts
  fixtures/sessions/*.jsonl    recorded editing sessions, replayed
```

The `core`/`vscode` split is not stylistic. The design commits to a later editor-agnostic
extraction (Neovim, Zed, the Rust rewrite), and that promise rots silently unless enforced — so it
is enforced mechanically in CI, not by review discipline. See §4.

**Clock injection is the load-bearing decision.** Every heuristic in this product is temporal:
diagnostic age, idle time, churn windows, cooldowns, score decay over days. If any of them calls
`Date.now()` directly, that behaviour becomes untestable, and a two-week decay curve becomes
literally untestable. With time as a parameter, a 45-minute recorded session replays in
milliseconds, and spaced-review logic can be verified across simulated months.

## 3. Testing strategy

Four layers, each answering a different question.

### 3.1 Unit — "is the arithmetic right?"

Pure functions, no I/O, no clock: signature normalization, diff line-ranges, churn bucketing, EWMA
scoring, cooldown arithmetic. Fast, boring, high coverage. Vitest.

### 3.2 Session replay — "does it fire at the right moment?"

This is the one that matters, and the technique is the answer to §0.1.

A recorded session is a JSONL file of timestamped events — edits and diagnostic transitions —
captured from real usage by the same logging built for P1. Replayed through the pure detector with
a fake clock, it produces a deterministic list of candidate decisions, asserted against a golden
file.

```
test/fixtures/sessions/
  borrow-struggle-8min.jsonl      learner fights E0502, solves it alone at 6:40
  quick-typo.jsonl                error appears and is fixed in 4s — must NOT fire
  churn-rewrite.jsonl             same region rewritten 5x — must fire on churn, not diagnostic age
  idle-lunch.jsonl                error left open for 40 minutes of no activity — must fire once, not 13 times
```

What this buys:

- **Subjective judgement gets captured once, then defended forever.** You decide by hand that
  `quick-typo` should stay silent. From then on, any threshold change that breaks that judgement
  fails CI.
- **Tuning becomes safe.** Changing the idle threshold from 8s to 12s re-runs every session in
  milliseconds and shows exactly which decisions flipped. Without this, every tuning change is a
  gamble re-litigated by hand.
- **The corpus is the spec.** By P4, recruited learners can contribute anonymized sessions, and the
  fixture set becomes the accumulated definition of good timing — the genuinely hard-to-copy asset,
  more so than the concept table.

Golden files are reviewed as diffs. A PR that changes a golden file must say why in the description;
that diff *is* the pedagogy review.

### 3.3 Contract — "is the LLM boundary honoured?"

Runs in CI, never touches a network:

- **Schema validation.** Every hint response is validated against the strict JSON contract. Malformed
  fixtures exercise the one-repair-retry path and the static fallback.
- **Prompt snapshots.** The prompt builder is a pure function; its output is snapshot-tested. This
  is how privacy (N3) becomes a *test* rather than an intention: a snapshot review shows exactly
  what leaves the machine, and any change that widens the context window from "enclosing function"
  to "whole file" shows up as a reviewable diff.
- **Refusal invariants.** Given a hint response that contains a fenced code block at level 1, the
  engine must reject it. The product's central promise — never writes your code — is asserted, not
  trusted. This is the test that stops the bright line eroding one PR at a time.
- **Degradation.** Provider throws / times out / returns prose → static concept text plus
  `rustc --explain`, never a blocking spinner.

### 3.4 Model conformance — "does it work on a weak local model?"

**Manually triggered, never in PR CI**, because it costs money and is nondeterministic. A matrix of
(provider × model × prompt-suite) reporting pass rate per model on: valid JSON, correct level
discipline, no leaked solution code. Output is a compatibility table published in the README.

This exists because provider-agnostic is a *product* promise. "Level 1–2 work on small local models,
level 3 wants a stronger one" is currently a claim in the design doc; this job is what turns it into
a measured fact, and what catches the day a 7B model starts emitting solution code at level 1.

### 3.5 Manual — "does it feel right?"

Irreducible, and the reason P1 has a dogfooding exit criterion rather than a coverage target. Author
writes real Rust with the extension running. No amount of the above substitutes for it; the point of
the above is to make sure a feel-driven fix stays fixed.

## 4. CI

On every PR, in this order (fail fast, cheapest first):

| Gate | Enforces |
|---|---|
| `typecheck` | `tsc --noEmit`, strict |
| `boundary` | ESLint `no-restricted-imports`: **`src/core/**` may not import `vscode`** |
| `lint` | formatting, unused code |
| `test` | unit + replay + contract |
| `package` | `vsce package` succeeds — catches manifest breakage before release, not during it |

The boundary gate is worth its own line because it is the only guard on an architectural promise
that nothing else would notice breaking. One convenient `import * as vscode` inside `core/` and the
sidecar extraction quietly becomes a rewrite. A lint rule catches it in seconds; code review catches
it in about six months.

Not in PR CI, deliberately: model conformance (costs money, flaky), Marketplace publish
(tag-triggered only).

## 5. Release

- **SemVer on the extension.** Independently, **`schemaVersion` on chapter packs** — content and code
  version separately, which is the entire point of packs, and the loader must reject unknown
  `schemaVersion` noisily rather than half-parsing it.
- **Tag-triggered publish.** `v*` tag → CI builds, tests, packages, publishes to the VS Code
  Marketplace and attaches the `.vsix` to a GitHub release.
- **Pre-release channel** for dogfooding builds, so the author and early testers run ahead of the
  stable listing without a separate distribution mechanism.
- **`CHANGELOG.md`**, written for learners rather than developers — "the tutor now stays quiet
  during rapid typo fixes" beats "tuned `idleThresholdMs`."

## 6. Observability, which is also the product research

There is no server in v1, so "monitoring" means one thing: **opt-in local telemetry that the learner
can read, export, and delete.** Moment counts, hint-level distribution, resolution rates, ambient
toggle state, per-card-type dismissal rates.

This is not incidental instrumentation — it is the measurement apparatus for the two Stage-1
validation questions, and it is what makes P5's go/no-go a data decision rather than a vibe. Design
it in P1 alongside the candidate log, because retrofitting telemetry after P4 means the first cohort
of learners generates no evidence.

Privacy constraints are the same as the prompt path: local by default, explicit export, never code
contents — only signatures, scores, and counts.

One caveat that Phase 1 makes concrete: the candidate log records absolute file URIs, and
pattern-kind signatures embed a normalized diagnostic message. Identifiers and literals are stripped
by `normalizeMessage`, so code does not leak wholesale — but project structure does. Since Phase 1
actively invites sharing the log for threshold tuning, say so plainly in the docs before asking
anyone to send one.

## 7. Risks, and the engineering response to each

| Risk | Response |
|---|---|
| Ambient nudges feel like noise (the documented category killer) | P1 exists to find this out before P2 is built; on-demand mode is a first-class fallback, not a rescue plan |
| Thresholds tuned to one person's typing rhythm | The replay corpus generalizes from P4 onward with contributed sessions; until then, treat the numbers as provisional and say so in the README |
| Solution code leaks into hints via a weak model or a well-meaning PR | Refusal invariants in contract tests (§3.3), plus the conformance matrix (§3.4) |
| Core/adapter boundary erodes | Mechanically enforced in CI (§4) |
| Pack ecosystem becomes an attack surface | Packs stay pure data with a fixed vocabulary; schema-validated on install; the vocabulary only grows through reviewed extension releases |
| Solo-dev bandwidth | Phase gates are cheap-to-expensive in order; each phase's exit criterion is a stopping point where abandoning costs nothing further |

## 8. The loop back to design

Every phase feeds the design docs rather than diverging from them silently:

- P1's candidate log → the real threshold numbers replace the placeholders in system-design §3.4.
- P2's conformance matrix → the honest model-quality note in §3.3b.
- P3's replay of simulated histories → validates or corrects the EWMA constants in §3.2.
- P4's telemetry → answers the two Stage-1 questions and settles the ambient-vs-on-demand trade-off
  in §5, which is currently a decision made on prior reasoning rather than evidence.

When a phase contradicts the design, the design doc changes in the same PR as the code. A design
document that quietly stops describing the system is worse than none, and this one is currently the
project's main asset.
