+++
id = "variables"
title = "Names that hold still"
goal = "A program that computes something and prints the result."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "In `main`, bind a number to a name with `let`. Pick anything: `let apples = 3;`"
check = { kind = "file_contains", path = "src/main.rs", pattern = "let\\s+\\w+\\s*=" }

[[steps]]
instruction = "Add a second binding that is computed from the first — a total, a double, a sum."
hint = "Something like: let total = apples * 4;"
check = { kind = "file_contains", path = "src/main.rs", pattern = "let\\s+\\w+\\s*=[^;]*[\\+\\-\\*/][^;]*;" }

[[steps]]
instruction = "Print both values in one line using `{}` placeholders."
hint = "println! takes the format string first, then the values: println!(\"{} and {}\", a, b);"
check = { kind = "file_contains", path = "src/main.rs", pattern = "println!\\([^)]*\\{\\}[^)]*\\{\\}" }

[[steps]]
instruction = "Now try to break it: add a line reassigning your first binding, like `apples = 10;`. Run `cargo run` and read the error."
hint = "You are looking for E0384. The error message names the fix — read it before applying it."
check = { kind = "command_run", command = "cargo run" }

[[steps]]
instruction = "Make it compile by adding `mut` to that first binding."
check = { kind = "file_contains", path = "src/main.rs", pattern = "let\\s+mut\\s+\\w+" }
+++

`let x = 5;` gives a value a name. What surprises people coming from other languages is that the
name **cannot be reassigned** unless you say `let mut`.

That looks like the language being difficult. It is closer to the opposite. In a language where any
variable might change anywhere, understanding unfamiliar code means keeping track of all of them. In
Rust, a name without `mut` is a promise that it will not change — so most names can be read once and
then trusted.

You are going to deliberately trigger an error in this lesson. Do it. Reading compiler errors is a
skill, and Rust's are unusually good: this one will tell you exactly which line broke the promise
and what to change. Getting comfortable with red text now will save you a great deal of frustration
when the errors get harder.
