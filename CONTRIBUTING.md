# Contributing

This project is at the design stage — the most valuable contributions right now are arguments with
the design, not code.

## The bright line

**The teacher may build the classroom, never write the essay.**

Every contribution is reviewed against this. Concretely, a change is rejected if it:

- writes solution code into the learner's buffer (skeletons with `todo!()` markers are the only
  exception, and only behind an explicit per-action click with a preview);
- generates a function body the learner was supposed to write;
- reveals a hint level the learner did not click through to;
- adds an "just fix it for me" global mode.

Agentic editors have set the expectation that a tool will finish your code for you. Pressure toward
more agency will arrive in PRs. That pressure is the thing this project exists to resist.

Two of these are now enforced by tests rather than by review, because a rule defended only by
reviewers erodes one reasonable-sounding exception at a time:

- `checkHintRespectsLadder` rejects a level-1 or level-2 hint containing solution-shaped code,
  fenced or not, whatever model produced it.
- `generatedIsSkeletonOnly` proves a scaffolded file contains nothing but `todo!()` bodies.

If you find yourself needing to weaken either check to land a change, that is the signal to discuss
the change rather than the check.

## Other standing rules

- **Detection never calls an LLM.** Trigger heuristics stay local, cheap, and instant. If a
  heuristic needs a model to work, it is the wrong heuristic.
- **Chapter packs are data, never code.** No JS hooks, no shell commands in checks. If a lesson
  can't be expressed in the declarative check vocabulary, the vocabulary grows via a reviewed
  extension release — that's the pressure valve, by design.
- **Never degrade the editing experience.** Nothing may block typing or sit in front of the
  rust-analyzer pipeline. An LLM outage degrades to static concept text plus `rustc --explain`.
- **Ambient nudges share one interruption budget.** Any new card type ships with its own toggle and
  draws from the same cap. The lifecycle catalog is also a catalog of ways to be annoying.
- **The learner model stays local by default.** Only a short summary may travel with a prompt.

## Good first contributions

- Concept entries for the core borrow-checker error codes, in the chapter-pack format: a canonical
  mental-model explanation, 2–3 Socratic question templates, one worked example.
- Trigger-heuristic critiques — especially from anyone who has taught Rust to beginners.
- Real transcripts of getting stuck on the borrow checker, which are the ground truth the detector
  is tuned against.

## Discussing pedagogy

Open an issue rather than a PR for anything that changes *how* the tutor teaches. Content decisions
should be argued in the open before they're written down; the concept table is the defensible asset
here, and it should be argued over, not merged quietly.
