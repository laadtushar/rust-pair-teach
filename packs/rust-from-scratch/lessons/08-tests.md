+++
id = "tests"
title = "Proving it works"
goal = "A passing test you wrote, and one you deliberately made fail."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "At the bottom of `src/main.rs`, add a test module: `#[cfg(test)] mod tests { ... }`"
hint = "#[cfg(test)] means this code is compiled only when testing — it adds nothing to your real binary."
check = { kind = "file_contains", path = "src/main.rs", pattern = "#\\[cfg\\(test\\)\\]" }

[[steps]]
instruction = "Inside it, write a `#[test]` function that asserts something about a function you wrote earlier."
hint = "use super::*; brings your functions into scope. Then assert_eq!(double(4), 8);"
check = { kind = "file_contains", path = "src/main.rs", pattern = "#\\[test\\]" }

[[steps]]
instruction = "Run `cargo test` and watch it pass."
check = { kind = "command_run", command = "cargo test" }

[[steps]]
instruction = "Now change the expected value so the test is wrong, and run `cargo test` again. Read the failure output carefully — it shows you both sides."
check = { kind = "command_run", command = "cargo test" }

[[steps]]
instruction = "Put it back so it passes. Then think of one edge case your function does not handle, and write a test for that too."
hint = "What about zero? A negative number? An empty collection? Edge cases are where bugs live."
check = { kind = "command_run", command = "cargo test" }
+++

Tests live next to the code they test in Rust, usually at the bottom of the same file, inside a
module marked `#[cfg(test)]` — meaning it is compiled only when testing and adds nothing to your
shipped binary.

`cargo test` finds and runs every `#[test]` function.

Deliberately breaking a test is not busywork. A test you have never seen fail is a test you do not
know works — plenty of tests pass because they assert nothing meaningful, and the only way to find
out is to watch one fail on purpose. Read the failure output while you are there: Rust shows you what
it expected and what it got, side by side, and that format is what you will be reading for years.

The last step is the real skill. Writing the test for the happy path is easy. Asking "what input
would break this?" is the habit that separates code that works from code that keeps working.
