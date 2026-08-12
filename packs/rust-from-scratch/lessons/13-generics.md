+++
id = "generics"
title = "Writing it once for many types"
goal = "A generic function that works on more than one type."
concepts = ["rust/traits.bounds"]

[[steps]]
instruction = "Write a generic function — `fn largest<T: PartialOrd>(items: &[T]) -> &T`, or your own."
hint = "The <T: PartialOrd> says: any type T, as long as it can be compared."
check = { kind = "file_contains", path = "src/main.rs", pattern = "fn\\s+\\w+\\s*<\\s*\\w+\\s*:" }

[[steps]]
instruction = "Call it with a slice of numbers."
check = { kind = "file_contains", path = "src/main.rs", pattern = "\\[\\s*\\d+\\s*,|vec!\\[" }

[[steps]]
instruction = "Call the same function with a slice of &str, and run it."
hint = "If it does not compile, read the bound in the error — it is telling you what your T cannot do."
check = { kind = "command_run", command = "cargo run" }
+++

Generics let you write a function once and use it for many types, with no loss of speed and no loss
of type checking.

The important half is the **bound**. `<T>` alone means "any type at all", and a type you know nothing
about can do nothing — you cannot compare it, print it, or copy it. `<T: PartialOrd>` says "any type
that can be ordered", and now `>` is available inside the function.

So a bound is not a restriction the compiler imposes on you. It is you telling the compiler what you
need, and the compiler holding callers to it. If you have ever tried to use a generic in another
language and hit a mysterious runtime failure for one type, this is the design that prevents it.

Rust monomorphises generics: a separate machine-code copy per concrete type, decided at compile
time. `largest::<i32>` and `largest::<&str>` are different functions by the time the program runs.
That is why generic Rust is exactly as fast as hand-writing each version, and why compile times grow
when you use a lot of it.
