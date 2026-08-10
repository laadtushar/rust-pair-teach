+++
id = "basics.first-program"
title = "Getting a Rust program to run"
codes = ["E0601", "E0425"]
socraticTemplates = [
  "What is the one function every Rust program starts from, and is it there?",
  "The compiler is looking for something it cannot find — what name is it asking about?",
]
checkForUnderstanding = "You can say what cargo run actually does: compile, then execute."
+++

A Rust program starts at `fn main()`. Cargo — Rust's build tool and package manager — expects to
find it in `src/main.rs`, and `cargo run` compiles the project and then runs the resulting binary.

Two things surprise newcomers. First, `println!` has an exclamation mark because it is a *macro*,
not a function: it does work at compile time, checking your format string against the arguments you
passed. That is why a mismatched `{}` is a compile error rather than a runtime surprise.

Second, Rust compiles ahead of time. There is no interpreter reading your file line by line — by the
time anything runs, the whole program has been checked. That is the trade: slower to get to a
running program, far fewer things that can go wrong once it runs.
