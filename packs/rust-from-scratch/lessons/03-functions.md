+++
id = "functions"
title = "Moving work into a function"
goal = "A function you wrote, called from main, returning a value."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "Below `main`, write a function that takes a number and returns a number. Give it a real name — `double`, `area`, `celsius_to_f`."
hint = "The shape is: fn double(n: i32) -> i32 { ... }  — parameter types and the return type are both required."
check = { kind = "file_contains", path = "src/main.rs", pattern = "fn\\s+\\w+\\s*\\([^)]*:\\s*\\w+[^)]*\\)\\s*->" }

[[steps]]
instruction = "Call it from `main` and print the result."
check = { kind = "file_contains", path = "src/main.rs", pattern = "println!" }

[[steps]]
instruction = "Run `cargo run` and confirm the number is what you expected."
check = { kind = "command_run", command = "cargo run" }
+++

Functions in Rust must declare the type of every parameter and of what they return. There is no
inference across a function boundary, and that is deliberate: it means you can understand any
function by reading its signature, without chasing callers.

One piece of syntax that catches everyone. The last expression in a function is its return value,
**with no semicolon**:

```
fn double(n: i32) -> i32 {
    n * 2
}
```

Add a semicolon to that line and it stops being a value and becomes a statement — and the function
now returns nothing, which is a type error. If you see "expected i32, found ()", a stray semicolon is
the first thing to check. `()` is Rust's word for "no value at all".
