# rust-pair-teacher

**The anti-Copilot for learning Rust — it refuses to write your code.**

An open source, editor-native AI tutor (VS Code extension) that watches free-form Rust code as you
write it, notices when you are stuck, and talks with you about it instead of autocompleting.
Working name: **BorrowSensei** (placeholder).

> Status: **working, unproven.** It talks, teaches a sixteen-lesson course, and remembers what you
> struggled with — but the thresholds that decide *when* it speaks are educated guesses, and it has
> never been used by anyone learning Rust for real. That, not more features, is what it needs next.

## What it does

- **Talks, and speaks first.** It greets you, says what you are about to build when a lesson opens,
  reacts when a step ticks, and raises a new compiler error in conversation. You type back at any
  point. Replies stream as they are written.
- **Teaches a course from scratch** — sixteen lessons from your first program to a small CLI tool
  you built, with ownership and borrowing in the middle where the real difficulty is. Steps tick
  themselves as you work.
- **Watches** edits and diagnostics via editor APIs — no screen capture — and decides locally when
  you look stuck. Detection never calls a model.
- **Understands 23 Rust compiler errors** through built-in teaching content, so it rarely has
  nothing to say.
- **Teaches Python too**, ambiently — five traps that cost beginners an afternoon each, keyed on
  what Pylance, Pylint and Ruff actually emit rather than on what Python prints at runtime. No
  Python course; the sixteen lessons are Rust. Adding a language is a folder in `packs/`, not a code
  change: see [`docs/language-extensibility.md`](docs/language-extensibility.md), which includes an
  honest account of what the second language broke.
- **Tracks concept mastery** over time and gets quieter on what you have mastered — a teacher whose
  goal is its own obsolescence.
- **Refuses to write your code.** Enforced in the persona and again on the way out: a block long
  enough to paste is replaced with an offer to talk through any line of it.

## Why it doesn't exist yet

The research found no tool combining all four of: editor-native watching of free-form code,
teach-not-autocomplete pedagogy, Rust-first content, and longitudinal concept tracking.
The closest neighbours miss on at least one axis:

| Tool | Philosophy | Editor-native | Rust-first |
|---|---|---|---|
| CodeTrain | Socratic, anti-autocomplete | Browser / localhost agent | No |
| Sayagen Coding Tutor AI | Watch loop + hint ladder | Browser only | No (Python) |
| Exercism Rust track | Hints not answers, human mentors | Async / submission-based | Yes |
| Rustlings | `watch` mode prior art | CLI | Yes (fixed exercises) |
| JetBrains RustRover | Lesson-structured, in-IDE | Yes | Yes |
| GitHub Copilot / Cursor | Autocomplete-first | Yes | Language-agnostic |

Full competitive analysis in [`docs/market-research.md`](docs/market-research.md).

## Architecture at a glance

```
Learner typing .rs  ──▶  Edit Stream ──┐
rust-analyzer diagnostics ─────────────┴──▶  Moment Detector  (local heuristics, no LLM)
                                                    │
                                       Chapter Packs (concepts, lessons, templates)
                                       Learner Model (local JSON/SQLite)
                                                    │
                                             Lesson Engine  ──▶  Provider Adapter
                                                    │              (OpenRouter / OpenAI /
                                              Sidebar webview       Anthropic / Ollama)
                                                    │
                                             Action Engine ──▶ workspace files
                                                (skeletons + todo!() only, always previewed)
```

Everything left of the Provider Adapter is local and free. The only network egress is a fired
teachable moment — and with a local Ollama model, even that stays on your machine.
The full diagram, data model, prompting contract, and heuristics live in
[`docs/system-design.md`](docs/system-design.md).

## Design principles

1. **The teacher may build the classroom, never write the essay.** File actions are limited to
   commented skeletons with `todo!()` markers, always previewed, always opt-in per action.
2. **Detection is free, teaching costs.** Heuristics run locally; only a fired moment calls an LLM.
   Target < $0.02 per teachable moment.
3. **Provider-agnostic, bring your own key.** Any OpenAI-compatible endpoint, an Anthropic key, or
   a free local model via Ollama/LM Studio. No piggybacking on Claude Pro/Max or ChatGPT
   subscriptions — both vendors restrict subscription auth to their own products.
4. **Interruptions are a budget, not a feature.** Hard cap on ambient nudges, per-card-type
   toggles, and a fully on-demand mode — "noisy autocomplete" is this category's documented
   failure mode.
5. **Content is data, never code.** Teaching ships as versioned chapter packs (declarative, schema
   validated, no executable hooks) so new pedagogy never requires a new extension release.
6. **Privacy by default.** The learner model stays local; only a two-line summary ever travels, and
   **Show what gets sent to the model** prints the exact payload so the claim is checkable rather
   than trusted.

## Try it

```bash
npm install
npm run verify     # typecheck, lint, 293 tests
npm run build      # bundle
npm run package    # .vsix you can install
```

Then press <kbd>F5</kbd> in VS Code to launch an Extension Development Host, open a Rust project,
and click the sensei icon.

**Conversation needs a model; the course does not.** Run **Rust Pair Teacher: Set up a teaching
model** and pick Ollama — free, local, no key, and nothing leaves your machine. Keys go to the OS
keychain, never to `settings.json`. A ChatGPT or Claude subscription is *not* API access and the
extension will tell you so rather than failing with a bare 401. Settings and keys take effect
immediately; there is nothing to reload.

**Conversation without a model.** With nothing configured the tutor still teaches — the chapter
packs' own material arrives as tutor messages in the same conversation. There is no second panel
and no separate mode; what changes is who is writing, not where you look.

Useful commands: **Start learning Rust**, **Explain what I'm stuck on** (bypasses every cooldown),
**Show what gets sent to the model** (the exact text, before it leaves), **Open candidate log**
(every decision it made, including the ones to stay quiet), **Show my learning telemetry**.

To check a model actually follows the teaching persona:

```bash
CONFORMANCE_BASE_URL=http://localhost:11434/v1 \
CONFORMANCE_MODEL=qwen2.5-coder:7b \
npm run conformance
```

## Build order

1. ~~Edit Stream + snapshot/diff.~~
2. ~~Diagnostics reader + Moment Detector with logging, no LLM yet.~~
3. ~~Chapter-pack format, concept content for the seven core borrow-checker codes, Lesson Engine,
   provider adapter, sidebar.~~
4. ~~Learner model, resolution tracking, scaffold fading.~~
5. ~~Conversational tutor, sixteen-lesson course, streaming, spend cap.~~
6. ~~One teaching surface: the hint card and the ladder engine behind it are gone, and the built-in
   material is delivered into the conversation instead.~~
7. **← here.** Use it. Tune the thresholds against a real candidate log, then recruit 20–50 Rust
   learners and answer the validation questions: do ambient interruptions feel helpful or noisy,
   does concept tracking change what people study, and does anyone talk back?
8. Whatever the answers demand. Remaining engineering is tracked in
   [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Documentation

| Document | What's in it |
|---|---|
| [`docs/system-design.md`](docs/system-design.md) | Requirements, architecture, data model, prompting contract, trade-off analysis |
| [`docs/market-research.md`](docs/market-research.md) | Competitive landscape, market signals, gap analysis, staged recommendations |
| [`docs/engineering-plan.md`](docs/engineering-plan.md) | Phases, module boundaries, the four testing layers, CI gates, release |
| [`docs/language-extensibility.md`](docs/language-extensibility.md) | Which seams keep a second language additive, and which to actually build in v1 |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Evidence-based tickets, and the open questions blocking them |
| [`docs/manual-test.md`](docs/manual-test.md) | What to check by hand before a release, and what has never been checked |
| [`docs/handout.md`](docs/handout.md) | Condensed research summary + design in a single handout |

## Open questions

- **Every threshold is a guess.** How long an error must linger, how idle you must be. Everything
  else is built and none of it matters if the timing is wrong. The instrument to settle this is the
  candidate log, and it has never been run against real use.
- **Nothing has ever run in real VS Code.** The suite covers the logic; the UI is unexercised.
- Whether the tutor should ever write files, and whether the model-free path is still a requirement
  now that conversation needs one — see Q1 and Q2 in [`docs/BACKLOG.md`](docs/BACKLOG.md).
- Licensing conversation with Brown University's Cognitive Engineering Lab before leaning harder on
  their conceptual model.
- The name. "BorrowSensei" is a placeholder, and the repo, the extension and the docs currently
  disagree with each other.

## License

MIT — see [LICENSE](LICENSE).
