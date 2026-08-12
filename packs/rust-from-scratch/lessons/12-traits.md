+++
id = "traits"
title = "Shared behaviour"
goal = "A trait you defined, implemented for two of your own types."
concepts = ["rust/traits.bounds"]

[[steps]]
instruction = "Define a trait with one method — `trait Describe { fn describe(&self) -> String; }`"
check = { kind = "file_contains", path = "src/main.rs", pattern = "trait\\s+\\w+\\s*\\{" }

[[steps]]
instruction = "Implement it for two different structs of yours."
hint = "impl Describe for Book { ... }  — you need one impl block per type."
check = { kind = "file_contains", path = "src/main.rs", pattern = "impl\\s+\\w+\\s+for\\s+\\w+" }

[[steps]]
instruction = "Write a function taking `&impl Describe` and call it with both types."
hint = "fn announce(item: &impl Describe) — one function, both types, no duplication."
check = { kind = "file_contains", path = "src/main.rs", pattern = "&\\s*impl\\s+\\w+|&dyn\\s+\\w+" }

[[steps]]
instruction = "Run it and see one function serve both."
check = { kind = "command_run", command = "cargo run" }
+++

A trait is a promise about what a type can do. If a type implements `Describe`, it has a `describe`
method, and anything wanting a `Describe` will accept it.

This is how Rust does polymorphism, and it is worth noticing what it is *not*. There is no
inheritance. A type does not extend another type; it implements a set of capabilities. That avoids
the deep fragile hierarchies that inheritance tends to grow, at the cost of writing an `impl` block
per type — which is usually a fair trade, and always an explicit one.

`&impl Describe` in a parameter means "any type implementing this trait". The compiler generates a
separate specialised version per type, so there is no runtime cost. The alternative, `&dyn
Describe`, decides at runtime instead, which costs a pointer indirection but lets one collection
hold several different types.

Start with `impl Trait`. Reach for `dyn Trait` when you actually need a `Vec` of mixed types — the
compiler error will tell you when that moment arrives.
