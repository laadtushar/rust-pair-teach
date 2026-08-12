+++
id = "iterators"
title = "Describing what you want, not how to loop"
goal = "A chain of iterator adapters replacing a hand-written loop."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "Write a `for` loop that filters and transforms a Vec into another Vec, the manual way."
check = { kind = "file_contains", path = "src/main.rs", pattern = "for\\s+\\w+\\s+in" }

[[steps]]
instruction = "Now write the same thing as a chain: `.iter().filter(...).map(...).collect()`."
hint = "collect() needs to know what to build, so annotate: let evens: Vec<i32> = ..."
check = { kind = "file_contains", path = "src/main.rs", pattern = "\\.iter\\(\\)[\\s\\S]{0,200}\\.collect\\(\\)" }

[[steps]]
instruction = "Print both results, confirm they match, and run it."
check = { kind = "command_run", command = "cargo run" }
+++

Iterators are where Rust starts to feel expressive rather than strict.

`.iter().filter(|n| **n % 2 == 0).map(|n| n * 3).collect()` says what you want. The loop version
says how to get it. Both compile to essentially the same machine code — iterator chains are a
zero-cost abstraction, and the optimiser removes the layers entirely.

Two things to understand.

**Iterators are lazy.** `.filter()` and `.map()` do nothing on their own; they build a description.
Nothing runs until something consumes it — `.collect()`, `.sum()`, `.for_each()`, a `for` loop. If
your chain seems to do nothing, you probably forgot to consume it, and the compiler will warn you.

**`collect()` needs a target type.** It can build a `Vec`, a `HashMap`, a `String`, even a
`Result<Vec<_>, E>` that short-circuits on the first error. Since it cannot guess, you annotate the
binding or write `collect::<Vec<_>>()`.

The closure argument taking `&&i32` in a `filter` after `iter()` is a common early stumble. `iter()`
yields references, and `filter` hands the closure a reference to that — hence `**n`. `into_iter()`
yields values instead when you no longer need the original.
