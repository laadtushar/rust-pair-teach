# rust-pair-teacher

**The anti-Copilot for learning Rust — it refuses to write your code.**

An open source, editor-native AI tutor (VS Code extension) that watches free-form Rust code as you
write it, detects teachable moments, and teaches with tiered hints instead of autocompleting.
Working name: **BorrowSensei** (placeholder).

> Status: **design stage.** This repository currently holds the market research and system design.
> No extension code has been written yet. See [Build order](#build-order).

## What it does

- **Watches** `.rs` edits in real time via VS Code editor APIs (`onDidChangeTextDocument`,
  `languages.getDiagnostics`) and rust-analyzer diagnostics — no screen capture.
- **Detects teachable moments** locally: a lingering diagnostic, repeated rewrite churn in one
  region, idle-after-error, or the first time you ever hit a given error code. Detection never
  calls an LLM.
- **Teaches with a hint ladder** — Level 1 Socratic question → Level 2 the error reframed in your
  own code's terms → Level 3 worked example. Never skips a level without a click, never writes
  solution code into your buffer.
- **Tracks concept mastery** over time (ownership, borrows, lifetimes, traits, error handling) and
  gets quieter on concepts you've mastered — a teacher whose goal is its own obsolescence.

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
6. **Privacy by default.** The learner model stays local; only a two-line summary ever travels.

## Build order

1. Edit Stream + snapshot/diff.
2. Diagnostics reader + Moment Detector with logging, no LLM yet — dogfood how the triggers *feel*.
3. Concept content for the seven core borrow-checker codes (E0382, E0499, E0502, E0505, E0515,
   E0597, E0716), authored in the chapter-pack format from day one, plus a minimal loader,
   Lesson Engine, and sidebar.
4. Learner model + hint-ladder buttons + resolution tracking + "you do it" action cards.
5. Marketplace listing; recruit 20–50 Rust learners and instrument the two validation questions:
   do ambient interruptions feel helpful or noisy, and does concept tracking change what people
   study?

## Documentation

| Document | What's in it |
|---|---|
| [`docs/system-design.md`](docs/system-design.md) | Requirements, architecture, data model, prompting contract, trade-off analysis |
| [`docs/market-research.md`](docs/market-research.md) | Competitive landscape, market signals, gap analysis, staged recommendations |
| [`docs/language-extensibility.md`](docs/language-extensibility.md) | Which seams keep a second language additive, and which to actually build in v1 |
| [`docs/handout.md`](docs/handout.md) | Condensed research summary + design in a single handout |

## Open questions

- Interruption budget numbers, cooldown windows, and idle thresholds are placeholders pending
  dogfooding.
- JSON vs SQLite cutover point for the learner model.
- Chapter registry hosting beyond GitHub Releases.
- Licensing conversation with Brown University's Cognitive Engineering Lab before leaning harder on
  their conceptual model.
- The name. "BorrowSensei" is a placeholder.

## License

MIT — see [LICENSE](LICENSE).
