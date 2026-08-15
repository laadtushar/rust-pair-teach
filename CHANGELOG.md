# Changelog

Written for learners, not for the compiler. "The tutor now stays quiet during rapid typo fixes"
beats "tuned `idleThresholdMs`".

## 0.14.0 — settings take effect when you change them

Every setting used to be read exactly once, when the extension started. Shortening the delay before
the tutor speaks did nothing — silently — until you happened to reload the window. And the setup
wizard had to *end* by telling you to reload, which is a strange first instruction from something
whose whole pitch is that it notices things for you.

All of it applies immediately now: the thresholds, ambient watching, the no-code rule, the daily
call cap, telemetry, and the model itself. Connect a model and it answers your next message. Paste
an API key and it is in use. Nothing to reload.

If you narrow the delay while staring at an error, it applies to *that* error — the tutor does not
forget how long you have been stuck just because you adjusted a number.

## 0.13.0 — it speaks Python too

Not a course — the sixteen lessons are still Rust only, and a Python course would be a second
curriculum rather than a translation. But the tutor now watches Python files, and when you hit one
of the traps that catches everyone, it notices and starts a conversation about it.

Five of them, chosen because they cost an afternoon rather than a minute:

Assignment is what creates a local (why reading a global on line 2 fails because you assigned to it
on line 5) · default arguments are evaluated once, so a `[]` default remembers · where the `None`
came from, which is almost never the line that crashed · changing a dict while looping over it, and
why the list version fails silently instead · and closures capturing the variable rather than its
value.

It works with whichever checker you already use — Pylance, Pylint or Ruff. All three describe the
same mistake in different words, and the tutor knows all three sets.

**Also**

- Adding a language is now a folder. The extension reads whatever packs it finds instead of a list
  written into the code, so teaching content and the code that runs it move independently.
- Fixed: pattern-matched errors could never reach a concept. Languages without error codes were
  supported on paper and silent in practice. Rust was unaffected — it has error codes.

## 0.12.0 — one tutor, not two

Until now the extension had two personalities. Connect a model and you got a conversation; connect
nothing and you got a card with three hint buttons. Which tutor you met depended on a setting you
had not made yet, and only one of them was the one described on the box.

There is one tutor now, and it talks. When no model is connected it still talks — the built-in
material arrives as something it says to you, in the same conversation, rather than as a different
panel with different buttons. Nothing about the teaching is lost; the second interface is.

**Also**

- The tutor now notices when you fix something. Clearing an error it never mentioned counts for more
  than clearing one it talked you through, because doing it alone is the stronger evidence — and it
  sees both, where before it only saw the times you clicked "I solved it".
- Closing the window on a problem you did not solve is recorded too. Giving up used to look
  identical to never having struggled.
- **Rust Pair Teacher: Show what gets sent to the model** opens the exact text that would leave your
  machine, before it leaves. The claim was in the README; now you can check it.
- Your telemetry — still off by default, still local — can tell you whether the tutor is holding a
  conversation or talking to itself.

## 0.9.0 — the course now goes somewhere

Sixteen lessons instead of eight, ending on a program you built rather than an exercise you
finished.

**New lessons**

Collections (Vec and HashMap, and the `entry` pattern) · Strings (why `String` and `&str` both
exist, and which to take in a parameter) · The `?` operator (honest error handling that is shorter
than the dishonest kind) · Traits · Generics and what a bound is actually for · Iterators · Splitting
a file into modules, including the privacy error everyone hits · and finally a small command-line
program of your own, with tests.

**Also**

- The tutor now understands twenty-three compiler errors rather than eleven — traits and missing
  methods, mutability, moves out of borrowed content, modules and visibility, exhaustive matching,
  and lifetime annotations. Fewer moments where it has nothing to say.
- Replies stream in as they are written instead of appearing all at once. You can stop one
  mid-sentence.
- A daily cap on model calls, so a bug cannot quietly run up a bill. The built-in material keeps
  teaching after the cap is reached.
- On a small local model, older conversation is trimmed before the code you are looking at, so the
  tutor keeps talking about the right thing.

## 0.4.0 — it talks to you now

The sidebar is a conversation. The tutor speaks first, keeps talking as you work, and you can type
back at any point.

**New**

- **A real back-and-forth.** Ask anything — "what does this error mean", "why does Rust do this",
  "I don't understand step 2" — and get an answer about *your* code, not a generic one.
- **It speaks first, and keeps noticing.** It greets you when you open the editor, says what you are
  about to build when you start a lesson, reacts when a step ticks, and points at what the compiler
  is complaining about when a new error appears. It will not say the same thing twice about the same
  event.
- It can see what you can see: the open lesson, which steps are done, the code around your cursor,
  and the current compiler errors — reassembled every turn, so it is never talking about a stale
  version of your file.
- **Shift+Enter** for a newline, **Enter** to send. A half-typed message survives the panel
  re-rendering.
- **Lessons** button when you want the checklist view; it is somewhere you go deliberately now, not
  where you get dumped.

**Still true**

It will not write your code. If it starts pasting something long enough to copy, that gets replaced
with an offer to talk through any single line of it instead. If you would rather see full examples,
turn off `rustPairTeacher.strictNoCode`.

**Needs a model**

Conversation requires one — there is no canned version of talking, and pretending otherwise would be
worse than saying so. Ollama is free and local: run *Set up a teaching model*.

## 0.3.0 — a course, not just a safety net

You no longer need to already be writing Rust for this to be useful. Open the sidebar and there is a
lesson waiting.

**New**

- **Learn Rust from scratch** — eight guided lessons, from getting a program to run through to
  writing tests, with ownership and borrowing in the middle where they belong. The sidebar opens on
  the course rather than on an empty panel.
- Every lesson is a **checklist you complete by writing code**. Steps tick themselves as you go —
  create the file, change the message, run the command. Nothing is written for you.
- Several lessons ask you to **break your code on purpose** and read the compiler error. That is not
  filler: reading Rust's errors is the skill, and the earlier it stops being frightening the better.
- Lessons are listed with your progress, and you can jump to any of them. Finished a lesson the
  checks did not notice? Continue anyway — the checks are hints, not a gate.
- **Start learning Rust** is available from the command palette too.

**Notes**

The course needs no AI at all. A model, if you connect one, personalises the hints you get when you
get stuck *inside* a lesson — the lessons themselves are written material.

## 0.2.0 — it actually teaches now

The first build you can use. Open a Rust file, get stuck, and the sidebar asks you a question.

**New**

- A **sidebar** that shows the lesson: a question first, then — only if you click — the compiler's
  complaint retold in terms of your own code, then a worked example on a *different* snippet.
  Every rung you've seen stays on screen, so you can re-read the question after the explanation.
- **Teaching content built in**, covering ownership and moves, shared versus mutable borrows, and
  lifetimes: E0382, E0499, E0502, E0505, E0515, E0597, E0716.
- **It works with no AI configured at all** — hints come from that built-in material. Add a model
  and they get personalized to your code instead. Point it at a local Ollama and nothing leaves
  your machine.
- **It remembers.** Solve something alone and it notices. Keep struggling and it stays close. Get
  good at a concept and it deliberately goes quiet on it — first starting further up the ladder,
  then not interrupting at all. Ask, though, and it always answers.
- Months later, a concept you have not touched resurfaces for review.
- **Explain what I'm stuck on** teaches on demand, ignoring every cooldown.
- **Show my learning telemetry** (off by default) reports how the tutor is doing, including whether
  its interruptions look helpful or noisy. Local only; no code, no file paths.
- API keys are stored in your OS keychain via **Set API key**, never in `settings.json`.

**Changed**

- If a model tries to hand you the answer at hint 1 or 2, that answer is discarded and you get a
  question instead. This now also holds when the answer arrives without code fences.

- **Set up a teaching model** walks you through the options, then makes one real call to prove the
  connection works — rather than letting you discover a bad key later, mid-struggle.

**About ChatGPT and Claude subscriptions**

They cannot be used here, and this build now says so clearly instead of failing with a bare 401.
A ChatGPT Plus/Pro or Claude Pro/Max subscription pays for those chat apps; API calls are billed
separately, with their own key and balance. Pointing the extension at `chatgpt.com`, or pasting a
browser session token, is detected on the spot and explained.

If you would rather not pay anything: Ollama is free, local, needs no key, and nothing leaves your
machine.

**Known limits**

Still guesses, not measurements: how long an error must linger, and how idle you must be, before it
speaks. That is the next thing to fix, and it needs real use rather than more code.

## 0.1.0 — first tagged build

Not yet usable as a tutor: there is no sidebar, so nothing is shown to you. This release exists so
the pipeline that builds and ships the extension is real and exercised rather than theoretical.

**What works**

- The extension watches your Rust files and rust-analyzer's diagnostics, and decides when you look
  stuck — a compile error you've been sitting with, or the same few lines rewritten over and over.
- Every decision is written to a log you can open with **Rust Pair Teacher: Open candidate log**,
  including the moments it decided to stay quiet and why. This is the whole point of this release:
  the log tells us whether the timing is any good before anything is built on top of it.
- It will not interrupt you twice about the same thing, and it will not interrupt at all while
  you're still typing.
- Teaching content for the borrow checker ships built in — ownership and moves, shared versus
  mutable borrows, and lifetimes — covering the seven errors that account for most of the pain:
  E0382, E0499, E0502, E0505, E0515, E0597, E0716.
- Hints work without any AI at all, drawn from that built-in content. With a model configured they
  get personalized to your code; without one, or if the model is down, you still get taught.
- If a model ever tries to hand you the answer at hint level 1 or 2, the extension throws that
  answer away and falls back to asking you a question instead.

**What it deliberately won't do**

Write your code. Not at level 1, not at level 2, and at level 3 only as a worked example on a
*different* snippet than yours.

**Known limits**

The thresholds that decide when to speak are educated guesses, not measured. They will change once
there are real logs to tune against.
