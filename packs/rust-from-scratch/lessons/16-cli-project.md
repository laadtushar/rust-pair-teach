+++
id = "cli-project"
title = "Build something end to end"
goal = "A working command-line program of your own, with tests."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "Decide what it does and write it as a comment at the top of main.rs. One sentence."
hint = "Small and finishable: a word counter, a todo list in a text file, a unit converter, a dice roller."
check = { kind = "file_contains", path = "src/main.rs", pattern = "^//" }

[[steps]]
instruction = "Read a command-line argument with `std::env::args()`."
hint = "args() yields the program name first, so the one you want is nth(1)."
check = { kind = "file_contains", path = "src/main.rs", pattern = "env::args\\(\\)" }

[[steps]]
instruction = "Handle the case where the argument is missing, without panicking."
hint = "nth(1) gives an Option. Print usage and return early rather than unwrapping."
check = { kind = "file_contains", path = "src/main.rs", pattern = "None\\s*=>|unwrap_or|is_none\\(\\)" }

[[steps]]
instruction = "Split the real work into a function that takes plain values and returns a value — no printing inside it."
hint = "A function that returns rather than prints is a function you can test."
check = { kind = "file_contains", path = "src/main.rs", pattern = "fn\\s+\\w+\\s*\\([^)]+\\)\\s*->" }

[[steps]]
instruction = "Write at least two tests for that function, including one edge case."
check = { kind = "file_contains", path = "src/main.rs", pattern = "#\\[test\\]" }

[[steps]]
instruction = "Run `cargo test`, then `cargo run` with a real argument."
check = { kind = "command_run", command = "cargo test" }
+++

Everything so far has been exercises. This is a program.

Pick something small enough to finish today. The value is in completing something end to end, not in
scope — a word counter you finished teaches more than an ambitious thing you abandoned.

One piece of structure matters more than the rest: **keep the work separate from the printing.** A
function that takes values and returns a value can be tested; a function that prints can only be
tested by reading the output by eye. This is why the steps ask for a function returning a result and
a `main` that handles the input and output around it. It is the same instinct behind `Result` — push
the decisions about presentation outward, keep the logic in the middle honest.

When it works, notice what the last fifteen lessons bought you. Ownership stopped the double frees.
Borrowing stopped the dangling references. `Option` and `Result` stopped the null and the silent
failure. `match` stopped the forgotten case. None of that is ceremony — it is a language refusing to
let you ship the bugs that dominate other languages' bug trackers.

From here: the Rust Book for depth, `rustlings` for drills, Exercism for feedback from real people.
Or keep going with your own program and let the errors teach you. That is what this tutor is for.
