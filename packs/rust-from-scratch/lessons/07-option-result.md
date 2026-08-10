+++
id = "option-result"
title = "Absence and failure, in the type system"
goal = "A function returning Option or Result, handled with match rather than unwrap."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "Write a function returning `Option<T>` — something that might find nothing, like looking up an item in a Vec."
hint = "fn find_long(books: &[Book]) -> Option<&Book>  — return Some(x) when found, None when not."
check = { kind = "file_contains", path = "src/main.rs", pattern = "->\\s*Option<" }

[[steps]]
instruction = "Handle the result with `match`, printing something different for each case. Do not use `.unwrap()`."
hint = "match value { Some(x) => ..., None => ... }  — the compiler will not let you forget a case."
check = { kind = "file_contains", path = "src/main.rs", pattern = "match\\s+[^{]+\\{[\\s\\S]*None\\s*=>" }

[[steps]]
instruction = "Run it, then change your input so the other branch is taken, and run again."
check = { kind = "command_run", command = "cargo run" }
+++

Rust has no `null`. A value that might be missing has type `Option<T>`, which is either `Some(value)`
or `None` — and the compiler will not let you use it without deciding what happens in both cases.

This is Tony Hoare's "billion-dollar mistake" designed out of the language. You cannot forget the
empty case, because forgetting it does not compile.

Failure works the same way: `Result<T, E>` is `Ok(value)` or `Err(error)`. Rust has no exceptions,
so a function that can fail says so in its return type, visible at every call site.

You will discover `.unwrap()`, which extracts the value and crashes if there isn't one. It is fine in
a quick experiment and a bad habit in real code — it is precisely the "assume it worked" that Option
exists to prevent. Use `match` in this lesson even though it is longer. Later you will learn `?`,
which makes the honest path the short one too.
