+++
id = "error-handling"
title = "The ? operator"
goal = "A function that can fail, propagating errors with ? instead of unwrap."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "Write a function returning `Result<T, E>` that parses something — a number from a &str, say."
hint = "fn parse_age(s: &str) -> Result<u32, std::num::ParseIntError>"
check = { kind = "file_contains", path = "src/main.rs", pattern = "->\\s*Result<" }

[[steps]]
instruction = "Inside it, use `?` on the fallible call instead of `.unwrap()`."
hint = "let n = s.trim().parse()?;  — the ? returns the error to your caller if there is one."
check = { kind = "file_contains", path = "src/main.rs", pattern = "\\?;" }

[[steps]]
instruction = "In `main`, handle both outcomes with `match` and print something for each."
check = { kind = "file_contains", path = "src/main.rs", pattern = "Err\\(" }

[[steps]]
instruction = "Run it once with valid input and once with nonsense, and read both outputs."
check = { kind = "command_run", command = "cargo run" }
+++

`?` is the operator that makes honest error handling shorter than dishonest error handling.

On a `Result`, `?` means: if this is `Ok`, unwrap it and carry on; if it is `Err`, return that error
from the enclosing function right now. What would otherwise be five lines of `match` becomes one
character, and the error still travels to whoever should decide what to do about it.

That is the design worth noticing. In languages with exceptions, ignoring errors is the shortest
path and handling them costs effort. Rust inverts it: `?` is shorter than `.unwrap()` in any
function that can propagate, so the lazy option is also the correct one.

`?` only works in a function that returns `Result` or `Option`, which is the compiler making you say
"this can fail" in the signature. That is a feature. A caller can see from the type alone whether
they need to think about failure.

Two things to reach for later, once this feels natural: `Box<dyn Error>` when you want to propagate
several error types without ceremony, and the `anyhow` crate when you want that plus good context
messages.
