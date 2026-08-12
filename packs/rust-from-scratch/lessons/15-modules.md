+++
id = "modules"
title = "Splitting a file that got too big"
goal = "Code moved into its own module and used from main."
concepts = ["rust/modules.visibility"]

[[steps]]
instruction = "Create a new file `src/shapes.rs` (or any name) and move one struct plus its impl into it."
check = { kind = "file_exists", path = "src/shapes.rs" }

[[steps]]
instruction = "Declare it in `src/main.rs` with `mod shapes;`"
hint = "Creating the file is not enough — Rust only compiles modules you declare. This is the step everyone forgets."
check = { kind = "file_contains", path = "src/main.rs", pattern = "^\\s*mod\\s+shapes;" }

[[steps]]
instruction = "Run `cargo run` and read the error about privacy."
hint = "You are looking for E0603. Items are private by default, even to the parent module."
check = { kind = "command_run", command = "cargo run" }

[[steps]]
instruction = "Add `pub` to the struct, its fields you need, and the methods you call. Run it again."
check = { kind = "file_contains", path = "src/shapes.rs", pattern = "pub\\s+(struct|fn)" }
+++

Creating `src/shapes.rs` does not add it to your program. You must say `mod shapes;` — and this
catches nearly everyone at least once, because most languages treat files as modules automatically.

Once declared, everything inside is **private by default**. Not just to other crates: private to
your own `main.rs` too. You will hit E0603 in this lesson, on purpose.

That default is deliberate and worth appreciating. The public surface of a module is exactly what
you marked `pub`, so everything else can be changed freely without breaking any caller. In languages
where everything is public by default, you find out what was part of your interface when something
breaks.

`pub` is more granular than it first appears. A struct can be `pub` while its fields stay private,
which forces callers through your constructor and methods — often exactly what you want, since it
means you can change the representation later.

When you hit E0603, ask "should this be part of this module's interface?" rather than reaching for
`pub` reflexively. Sometimes the honest answer is that the calling code belongs inside the module.
