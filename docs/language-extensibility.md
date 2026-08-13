# Designing for more languages later

Rust is the wedge, not the ceiling. This document defined the seams that make a second language an
additive change rather than a rewrite, and stated which of them to actually build in v1.

**A second language has now arrived**, so the parts of this page that were predictions are marked
with what actually happened. The short version: the persisted formats were right, the code seams
were roughly right, and the one thing that mattered most — `kind: "pattern"` — was decoration that
had never worked. See [What the second language actually found](#what-the-second-language-actually-found).

## The governing rule

> **Make the persisted formats language-neutral now. Leave the code interfaces Rust-only until a
> second language actually arrives.**

Code is cheap to refactor: a `LanguageProvider` interface with one implementation can be extracted
in an afternoon, by one person, with the compiler pointing at every call site. Persisted data is
expensive: chapter packs are versioned artifacts already downloaded by users, and learner models
accumulate months of history on machines you cannot reach. A schema mistake there costs a migration
path forever.

So the v1 discipline is asymmetric, and deliberately so:

| Layer | v1 posture |
|---|---|
| Chapter pack schema (`chapter.toml`, `checks.toml`, concept front-matter) | Language-neutral **now** |
| Learner model keys and episode records | Language-neutral **now** |
| Cache keys, telemetry event shapes | Language-neutral **now** |
| Detector, Lesson Engine, Action Engine internals | Rust-only, seams noted in comments |
| `LanguageProvider` interface | **Not built in v1** — one language does not justify an abstraction |

Premature generalization here is a real risk: a plugin architecture for languages, written before a
second language exists, will be wrong in ways only the second language reveals. The formats are the
exception because they are the only thing that can't be fixed unilaterally later.

## What is already language-agnostic

Most of the system, which is the encouraging part. None of the following contain a Rust assumption:

- **Edit Stream** — snapshots and debounced diffs over any text document.
- **Churn / idle / diagnostic-age heuristics** — these reason about *timing and edit shape*, not
  about syntax. "Same five-line region rewritten three times in two minutes" is a fact about a
  struggling human, not about a borrow checker.
- **Interruption budget, cooldowns, snooze** — pure scheduling.
- **The conversation** — persona, proactive reasons, context assembly and the no-code rule are
  pedagogy, not language features. (In v1 this said "hint ladder"; the ladder was retired, and its
  successor turned out to be just as language-neutral.)
- **Provider Adapter** — LLM plumbing.
- **Learner model math** — EWMA scoring, decay, scaffold fading, `unresolvedStreak`.
- **Sidebar UI, action cards, step verification, the "what happened" trail.**

The lifecycle catalog (warm-ups, success recognition, spaced review, graduation) is likewise
language-independent; only the *content* it schedules is language-specific.

## The seven Rust assumptions to remove

Located in the current design:

| # | Assumption | Where | Why it breaks |
|---|---|---|---|
| 1 | `cargo_test_passes` as a check verb | `checks.toml` vocabulary | Bakes a build tool into a *versioned data schema* — the expensive kind of mistake |
| 2 | ~~`todo!()` as the skeleton marker~~ | ~~F7, Action Engine, `scaffold/`~~ | **Moot** — the tutor no longer writes files at all (Q1), so there is no marker to generalize |
| 3 | Unnamespaced concept ids (`mutable_borrows`) | Learner model | Collides the moment a second language has a concept named `generics` or `traits` |
| 4 | `errorCodes: ["E0502"]` as concept identity | Concept front-matter, episodes | Python, Go, Ruby, and JS have **no stable error codes** — only message text |
| 5 | Cache keyed on "error code" | §3.5 | Same as 4; unkeyable for codeless languages |
| 6 | `rustc --explain` as the offline fallback | N4 | The graceful-degradation path is Rust-only |
| 7 | rust-analyzer as *the* diagnostic source | F2, §2, §3.6 | Correct per-language, wrong as a global assumption |

Items 1, 3, 4, and 5 touch persisted formats. **Those are the four to fix in v1.** Items 2, 6, and 7
are code-level and can wait.

## Fix 1 — a diagnostic identity that survives codeless languages

The deepest assumption is that a compiler error has a *stable identifier*. Rust's `E0382` is a gift
that most languages do not give you. Python raises `BorrowError`-free prose; Go says
`cannot use x (variable of type T) as U value`; TypeScript does have codes (`TS2345`) but few people
think in them.

So concept identity must accept either shape:

```jsonc
// a DiagnosticSignature — one of two forms, never a bare string
{ "kind": "code",    "language": "rust",   "value": "E0382" }
{ "kind": "pattern", "language": "python", "value": "^local variable '\\w+' referenced before assignment$" }
```

The detector normalizes every incoming diagnostic to a signature before anything else touches it.
Everything downstream — concept lookup, novelty detection ("first time this learner has seen this"),
cache keys, episode records — keys on the signature, never on a raw code string.

This costs almost nothing in a Rust-only v1 (every signature is `kind: "code"`) and is the single
change that makes a codeless language possible at all.

## Fix 2 — namespace every concept id

```
rust/ownership.moves
rust/borrows.mutable
python/scope.closures
ts/types.structural
```

Two rules that follow: the learner model stores namespaced keys from the first write, and a chapter
pack declares `language = "rust"` in `chapter.toml`, with concept ids resolved relative to it so
pack authors still write `ownership.moves` and never type the prefix.

The payoff is not just collision avoidance. It makes "you understand ownership in Rust, and that is
*why* Python's mutable-default-argument trap will feel familiar" a representable idea — cross-
language concept links are the interesting long-term pedagogy, and unnamespaced keys foreclose it.

## Fix 3 — a check vocabulary phrased in intent

Replace tool names with outcomes, and let a language definition map the outcome to a command:

| Instead of | Use | Rust binds it to |
|---|---|---|
| `cargo_test_passes` | `test_passes` | `cargo test` |
| `cargo_check_passes` | `compiles` | `cargo check` |
| — | `lint_clean` | `cargo clippy` |
| `diagnostic_cleared = "E0382"` | `diagnostic_cleared = <signature>` | unchanged in spirit |
| `file_exists`, `no_pattern` | unchanged | already neutral |

`file_exists = "src/lib.rs"` stays language-neutral as a *verb* while its argument is inherently
project-shaped — that's fine and needs no abstraction.

This keeps the security stance exactly as designed: packs remain pure data with a fixed vocabulary,
and the set of executable commands stays a property of reviewed extension code, not of downloadable
content. Generalizing the vocabulary does **not** mean letting packs specify shell commands. It means
the opposite — the pack says `test_passes`, and only the extension decides what that runs.

## Fix 4 — skeleton markers as a language property — *withdrawn*

This proposed a per-language table of skeleton bodies (`todo!()`, `raise NotImplementedError`,
`panic("TODO")`). It is moot: the tutor no longer writes files, so there are no skeletons to mark.
Recorded rather than deleted because "the generalization we did not need" is the more useful half
of a design note like this one.

## The eventual interface (v2, not v1)

When language two is real, the seams above collapse into roughly this shape:

```ts
interface LanguageProvider {
  id: 'rust' | 'python' | 'typescript'
  fileExtensions: string[]

  // Diagnostics
  normalize(d: vscode.Diagnostic): DiagnosticSignature
  explainOffline(sig: DiagnosticSignature): Promise<string | null>   // rustc --explain, or null

  // Project actions
  skeleton: { body: string; lineComment: string; docComment: [string, string] }
  commands: { compiles: string; test_passes: string; lint_clean: string }

  // Idiom detection — the least portable part, and the last to be abstracted
  idioms: IdiomDetector[]
}
```

Note what is *not* in it: no hint-ladder logic, no scoring, no scheduling, no UI. If a future
language needs to change any of those, that's the signal the abstraction was drawn in the wrong
place.

## Honest costs

- **Namespaced ids and signatures make v1 slightly more verbose** for zero v1 benefit. That's the
  premium being paid, knowingly, for optionality on persisted data.
- **Idiom detection will not generalize.** "Reflexive `.clone()` to dodge the borrow checker" has no
  analogue elsewhere, and every language's idiom set is bespoke expert knowledge. Expect to write
  it fresh each time; the interface only spares you the plumbing.
- **The pedagogy does not transfer even when the architecture does.** The concept table is the moat
  precisely because it is hard-won and language-specific. A second language means a second table,
  which is most of the real work — the architecture is the easy part.
- **The wedge argument still holds.** Rust is the right first language because its errors are
  unusually *teachable*: precise, code-identified, and clustered around one famously hard concept.
  A language whose errors are vague prose is a materially harder product, not just a port.

---

## What the second language actually found

Python landed as `packs/python-common-errors` — five concepts, twelve message patterns, no course.
Here is the honest scorecard against the predictions above.

### The thing that was broken

**`kind: "pattern"` had never worked, and nothing would have told us.** The type existed, the schema
accepted `patterns = [...]`, the tests passed, and the design doc described it confidently. But
`indexBySignature` builds an exact-match `Map`, and the two sides of that map could never meet:

```
pack declares : python/pattern:^local variable '\w+' referenced before assignment$
detector makes: python/pattern:local variable <id> referenced before assignment
```

A pack author would have written correct-looking patterns, installed the pack, watched the tutor say
nothing, and had no way to find out why — the failure mode of a lookup that misses is silence.

The fix is `SignatureResolver` (`src/core/signature.ts`): resolve *before* keying rather than match
at lookup time. A message a pack claims takes that pack's own pattern string as its signature, so it
stays one stable value for concept lookup, cooldowns, novelty and episode records alike. A message
nobody claims still gets a normalized-message signature, so the detector's timing heuristics keep
working on errors we cannot teach.

The guard against a repeat is `test/multilingual.test.ts`: every declared pattern must be reached by
a real, verbatim compiler or linter message held as a fixture. Writing it immediately deleted two
patterns that had been invented rather than observed.

### The predictions that held

- **Namespaced concept ids.** `python/scope.assignment` sits beside `rust/ownership.moves` with no
  collision and no migration. Paid for in v1, collected in v2, exactly as argued.
- **`DiagnosticSignature` as a two-shape union.** The shape was right; only the plumbing was missing.
- **The pack schema needed no change at all.** `language = "python"` in `chapter.toml`, `patterns`
  instead of `codes`, and the loader, validator and index took it without a line of new code.
- **Everything hard stayed language-neutral.** Detector, learner model, interruption budget,
  conversation: untouched. That is the load-bearing claim of this document and it survived.

### The predictions that were wrong

- **"Leave the code interfaces Rust-only until a second language arrives"** was right in spirit and
  slightly too relaxed in practice. `const LANGUAGE = 'rust'` in `extension.ts` was cheap to remove,
  but `explainCommandFor` had hard-coded `rustc --explain` *inside* `staticHint`, where a Python
  concept would have suggested a Rust command. One line, easy to miss, learner-visible.
- **The `LanguageProvider` interface was not built, and should not be.** What Python actually needed
  was two fields — which editor ids to watch, and whether the compiler explains itself. That is
  `src/core/language.ts`, about forty lines, and it deliberately contains no hint logic, no scoring,
  no scheduling and no UI. The v2 interface sketched above is still speculative; the third language
  gets to say whether it is right.
- **Pack loading was a hard-coded array of three ids**, directly beneath a comment claiming that
  adding content never means editing that file. Discovery (`src/core/pack/discover.ts`) makes the
  comment true.

### What Python does not get

No course. Sixteen guided lessons are the single most expensive artifact in the project, and a
Python course would be a second one, not a port — the architecture generalizes, the pedagogy does
not. Python gets the ambient tutor: it notices the error, names the concept, and talks about it.

That is the honest boundary, and it matches the prediction this document opened with: *the concept
table is the moat precisely because it is hard-won and language-specific.*
