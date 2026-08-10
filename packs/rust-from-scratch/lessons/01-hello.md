+++
id = "hello"
title = "Get something running"
goal = "A Rust program you wrote that prints something you chose."
concepts = ["rust/basics.first-program"]

[[steps]]
instruction = "Make a new project: run `cargo new rust-practice` in the terminal, then open that folder."
hint = "Cargo creates the folder, a Cargo.toml, and a src/main.rs with a hello world already in it."
check = { kind = "file_exists", path = "Cargo.toml" }

[[steps]]
instruction = "Open `src/main.rs`. Change the message it prints to something that is yours — your name, today's date, anything but 'Hello, world!'."
hint = "The line looks like println!(\"Hello, world!\"); — edit the text inside the quotes."
check = { kind = "file_contains", path = "src/main.rs", pattern = "println!\\(\\s*\"(?!Hello, world!)[^\"]+\"" }

[[steps]]
instruction = "Run it with `cargo run` and read the output. You should see your message."
check = { kind = "command_run", command = "cargo run" }
+++

Every Rust program starts in one place: a function called `main`.

Cargo is Rust's build tool. `cargo new` sets up a project, `cargo run` compiles it and then runs it.
You will use those two commands more than any others.

The line that prints is `println!("...")`. That exclamation mark is not decoration — it means
`println!` is a **macro**, which does work while your program is being compiled rather than while it
runs. One consequence you will meet soon: if your format string does not match the arguments you
gave it, that is a compile error, not a crash later.

Change the message to something of your own before running it. Typing it yourself is the point; a
program you edited is a program you own.
