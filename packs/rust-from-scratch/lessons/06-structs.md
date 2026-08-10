+++
id = "structs"
title = "Making your own types"
goal = "A struct you designed, with a method you wrote."
concepts = ["rust/basics.types-and-mutability"]

[[steps]]
instruction = "Define a struct with at least two fields — something real, like `Book { title: String, pages: u32 }`."
check = { kind = "file_contains", path = "src/main.rs", pattern = "struct\\s+\\w+\\s*\\{" }

[[steps]]
instruction = "Add an `impl` block for it with one method that takes `&self` and returns something useful."
hint = "impl Book { fn is_long(&self) -> bool { ... } }  — &self borrows the struct rather than consuming it."
check = { kind = "file_contains", path = "src/main.rs", pattern = "impl\\s+\\w+\\s*\\{" }

[[steps]]
instruction = "Create one in `main`, call the method, print the result, and run it."
check = { kind = "command_run", command = "cargo run" }
+++

A `struct` groups related data under a name you chose. An `impl` block is where that type's
behaviour lives — Rust keeps data and methods in separate blocks, unlike most object-oriented
languages.

The important detail is the first parameter of a method:

- `&self` borrows the struct. The caller keeps it. Use this unless you have a reason not to.
- `&mut self` borrows it mutably, to change a field.
- `self` **consumes** it — the caller cannot use the value afterwards. Real, but rare, and usually
  for methods that transform a value into something else.

That is the ownership lesson again, in the place you will meet it most often. If a method only needs
to read, `&self` is right, and choosing it correctly is most of what writing idiomatic Rust means
early on.
