+++
id = "strings"
title = "String and &str, and why there are two"
goal = "A function taking &str, called with both a literal and an owned String."
concepts = ["rust/ownership.moves"]

[[steps]]
instruction = "Write a function that takes `&str` and returns something — a length, a shout, a first word."
check = { kind = "file_contains", path = "src/main.rs", pattern = "fn\\s+\\w+\\s*\\([^)]*:\\s*&str" }

[[steps]]
instruction = "Call it with a plain literal: `shout(\"hello\")`."
check = { kind = "file_contains", path = "src/main.rs", pattern = "\\w+\\(\\s*\"" }

[[steps]]
instruction = "Now make a `String` with `String::from(...)` and call the same function with `&` in front of it."
hint = "&owned works where &str is wanted. That conversion is called a deref coercion — it happens for you."
check = { kind = "file_contains", path = "src/main.rs", pattern = "\\w+\\(&\\w+\\)" }

[[steps]]
instruction = "Run it and confirm both calls work."
check = { kind = "command_run", command = "cargo run" }
+++

Rust has two string types and this confuses everyone at first.

`String` is owned and growable — it has a heap allocation it is responsible for. `&str` is a
borrowed view into text someone else owns. A string literal in your source is a `&'static str`: a
view into the program binary itself.

The rule that resolves most confusion: **take `&str` in function parameters, return `String` when
you build something new.** A `&str` parameter accepts both a literal and a borrowed `String`, so it
is strictly more useful than a `String` parameter — and taking `String` by value forces the caller
to give up ownership for no reason.

The conversion from `&String` to `&str` happens automatically. That is deref coercion, and it is why
`&owned` just works where `&str` was wanted.

One thing worth knowing early: you cannot index a string with `s[0]`. Rust strings are UTF-8, and
byte 0 of a multi-byte character is not a character. Use `.chars()` when you mean characters and
`.bytes()` when you genuinely mean bytes — the distinction is real and Rust refuses to let you blur
it.
