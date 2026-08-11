# Manual test script

Nothing in this project has ever run inside real VS Code. Until [C1](BACKLOG.md#c1--integration-test-in-real-vs-code)
exists, this script is the only answer to "did we break it".

Run it against a fresh install before every release. Record the result — **including failures** — in
the log at the bottom. A run with no recorded failures and no recorded date is not a run.

**Legend:** ✅ passed · ❌ failed · ⚠️ passed with a caveat · ⬜ not yet executed

---

## Setup

**S0. Prerequisites**
- VS Code ≥ 1.85
- `rust-analyzer` extension installed and working (open a `.rs` file, confirm you get red squiggles
  on a deliberate typo — if rust-analyzer is not running, nothing below will behave)
- A Rust toolchain (`cargo --version` succeeds)
- Optionally Ollama running with a model pulled, for the chat sections

**S1. Install**
1. `code --install-extension rust-pair-teacher-<version>.vsix`
2. Reload VS Code.
3. **Expect:** a sensei icon in the activity bar.
4. **Expect:** Output → *Rust Pair Teacher* contains `[packs] loaded rust-borrow-basics with 3 concepts`
   and `[course] 8 lessons available`.
5. **Expect:** the `[provider]` line appears **exactly once** (regression guard for A2).

---

## First run, no model configured

**M1. Empty state**
1. Open a folder with no Rust in it.
2. Click the sensei icon.
3. **Expect:** the chat panel, with a message saying a model is needed and a *Connect a model* button.
4. **Expect:** the composer is disabled — you cannot type into a tutor that cannot answer.

**M2. Lessons are reachable without a model**
1. Click *Lessons*.
2. **Expect:** eight lessons listed, all unticked, progress bar at 0.
3. Click any lesson.
4. **Expect:** you return to chat with the lesson title in the header.

---

## Setup wizard

**W1. Ollama path**
1. Command palette → *Rust Pair Teacher: Set up a teaching model*.
2. Pick **Ollama**. Accept the suggested model.
3. **Expect:** no key is requested.
4. **Expect:** a progress notification, then *Connected. The model replied: …*
5. **Expect:** settings now show `baseUrl: http://localhost:11434/v1`.

**W2. Ollama not running**
1. Stop Ollama. Re-run the wizard.
2. **Expect:** a failure message naming both `ollama serve` and `ollama pull`.

**W3. The subscription trap**
1. Set `rustPairTeacher.baseUrl` to `https://chatgpt.com/backend-api` manually.
2. Reload the window.
3. **Expect:** a warning explaining that subscriptions are not API access, with a *Set up a model* button.

**W4. Session token**
1. Set a valid `baseUrl`, then run *Set API key* and paste `eyJhbGciOiJIUzI1NiJ9.abc.def`.
2. **Expect:** rejected as a browser session token, naming what a real key looks like.

---

## Conversation

**C1. It speaks first**
1. With a model connected, reload the window and open the panel.
2. **Expect:** a greeting appears unprompted within a few seconds.

**C2. Talking back**
1. Type "what is ownership?" and press **Enter**.
2. **Expect:** your message appears immediately, then a reply.
3. **Expect:** Enter sends; **Shift+Enter** inserts a newline.

**C3. It sees your code**
1. Open a `.rs` file with a deliberate `E0382` (move then use).
2. Ask "what am I doing wrong here?"
3. **Expect:** the reply refers to *your* variable names, not a generic example.

**C4. It will not write your code**
1. Ask "just write the fix for me".
2. **Expect:** it declines and asks something instead, or gives at most a two-to-three line snippet
   of a *different* example.
3. **Expect:** no block long enough to paste. If one appears, that is a **P0 failure** — the product's
   central promise.

**C5. Draft survives a re-render**
1. Type half a sentence into the composer, do not send.
2. Save a `.rs` file in the editor.
3. **Expect:** your half-typed text is still there.

**C6. History survives a reload** *(regression guard for A4)*
1. Have a short conversation.
2. Reload the window; reopen the panel.
3. **Expect:** the conversation is still there.

**C7. History is per project** *(regression guard for A4)*
1. Open a different folder.
2. **Expect:** a fresh conversation, not the previous project's.

**C8. Clear**
1. Press *Clear*. **Expect:** empty thread. Reload. **Expect:** still empty.

---

## Course

**L1. Starting**
1. *Lessons* → *Start learning Rust*.
2. **Expect:** lesson 1 in the header, and the tutor says unprompted what you are about to build.

**L2. Steps tick**
1. Run `cargo new rust-practice` in the terminal and open that folder.
2. **Expect:** step 1 ticks (may require a save or file event).
3. Change the `println!` message to something of your own and save.
4. **Expect:** step 2 ticks, and the tutor notices out loud.

**L3. The default does not count**
1. Revert the message to exactly `Hello, world!` and save.
2. **Expect:** step 2 unticks. Leaving the default is not doing the step.

**L4. Command steps** *(known risk)*
1. Run `cargo run` in the VS Code integrated terminal.
2. **Expect:** the `cargo run` step ticks.
3. ⚠️ This depends on terminal shell integration. If it does not tick, record which shell and OS —
   this is the most likely thing on this page to be broken.

**L5. Progress persists**
1. Complete a lesson. Reload the window.
2. **Expect:** progress retained, next lesson current.

---

## Ambient watching

**A1. It stays quiet for a typo**
1. Introduce an error and fix it within ~5 seconds.
2. **Expect:** no interruption.

**A2. It speaks for a real struggle**
1. Introduce an `E0502` and leave it, not typing, for ~30 seconds.
2. **Expect:** the tutor raises it in conversation.
3. **Expect:** it does **not** raise the same error again while nothing changes.

**A3. The candidate log**
1. Command palette → *Open candidate log*.
2. **Expect:** JSONL with fired *and* suppressed decisions, each with a reason.

---

## Diagnostics and privacy

**P1. What is sent**
1. Put a distinctive string (e.g. `const SECRET_MARKER: &str = "zzz";`) in a function far from your
   cursor, in the same file.
2. Ask the tutor a question.
3. **Expect:** it does not know about `SECRET_MARKER`. Only the region around the cursor travels.

**P2. Telemetry is off by default**
1. Run *Show my learning telemetry* without enabling it.
2. **Expect:** told it is off, not an empty report.

---

## Result log

| Date | Version | Env | Result | Notes |
|---|---|---|---|---|
| 2026-08-11 | 0.5.0 | CI container, no VS Code | ⚠️ partial | Only S1.4 could be executed here: the packaged `.vsix` does contain `extension/packs/{rust-from-scratch,rust-borrow-basics}/chapter.toml`, so pack loading will resolve at runtime. Everything requiring a running editor is still ⬜. |

### Known-unverified, highest risk first

1. **L4 command steps** — terminal shell integration is not universal; unproven on any shell.
2. **Everything in C** — the chat UI has never rendered in a real webview.
3. ~~**S1.4 pack loading**~~ — verified 2026-08-11: the paths are present in the `.vsix` at the
   location `loadPackFromDisk` expects. Runtime resolution itself is still untested, but the files
   are demonstrably where the code looks for them.
4. **Windows entirely** — see [F1](BACKLOG.md#f1--verify-windows-path-handling).
