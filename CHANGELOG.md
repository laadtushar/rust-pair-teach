# Changelog

Written for learners, not for the compiler. "The tutor now stays quiet during rapid typo fixes"
beats "tuned `idleThresholdMs`".

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
